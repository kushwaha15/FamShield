import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/app_error.dart';
import '../../features/auth/auth_state.dart';
import '../../features/families/family_providers.dart';
import '../../features/privacy/privacy_providers.dart';
import '../../models/family_location.dart';
import '../../services/foreground_location_source.dart';
import '../../services/location_realtime_client.dart';
import '../../services/location_sharing_api.dart';

final foregroundLocationSourceProvider = Provider<ForegroundLocationSource>(
  (ref) => GeolocatorForegroundLocationSource(),
);

final locationSharingApiProvider = Provider<LocationSharingApi>(
  (ref) => LocationSharingApi(ref.watch(authApiProvider)),
);

final locationRealtimeClientProvider = Provider<LocationRealtimeClient>(
  (ref) => SocketIoLocationRealtimeClient(ref.watch(authApiProvider)),
);

final locationSharingProvider =
    NotifierProvider<LocationSharingController, LocationSharingState>(
      LocationSharingController.new,
    );

final familyLocationsProvider =
    FutureProvider.family<List<FamilyLocation>, String>(
      (ref, familyId) =>
          ref.watch(locationSharingApiProvider).getFamilyLocations(familyId),
    );

enum LocationSharingStatus { idle, sharing, paused }

class LocationSharingState {
  const LocationSharingState({
    this.status = LocationSharingStatus.idle,
    this.familyId,
    this.familyName,
    this.sessionId,
    this.isBusy = false,
    this.approximatePermission = false,
    this.message,
    this.error,
  });

  final LocationSharingStatus status;
  final String? familyId;
  final String? familyName;
  final String? sessionId;
  final bool isBusy;
  final bool approximatePermission;
  final String? message;
  final String? error;

  bool get isSharing => status == LocationSharingStatus.sharing;
  bool get hasSession => sessionId != null;

  LocationSharingState copyWith({
    LocationSharingStatus? status,
    String? familyId,
    String? familyName,
    String? sessionId,
    bool? isBusy,
    bool? approximatePermission,
    String? message,
    String? error,
    bool clearSession = false,
    bool clearMessage = false,
    bool clearError = false,
  }) => LocationSharingState(
    status: status ?? this.status,
    familyId: familyId ?? this.familyId,
    familyName: familyName ?? this.familyName,
    sessionId: clearSession ? null : sessionId ?? this.sessionId,
    isBusy: isBusy ?? this.isBusy,
    approximatePermission: approximatePermission ?? this.approximatePermission,
    message: clearMessage ? null : message ?? this.message,
    error: clearError ? null : error ?? this.error,
  );
}

class LocationSharingController extends Notifier<LocationSharingState> {
  late LocationSharingApi _api;
  late ForegroundLocationSource _locationSource;
  late LocationRealtimeClient _realtimeClient;
  StreamSubscription<LocationFix>? _positionSubscription;
  LocationRealtimeSubscription? _realtimeSubscription;
  Future<void> _positionQueue = Future<void>.value();
  Timer? _sessionExpiryTimer;
  int _sequence = 0;
  int _lifecycleRevision = 0;
  bool _collecting = false;
  bool _operationInProgress = false;
  bool _appIsActive = true;

  @override
  LocationSharingState build() {
    _api = ref.read(locationSharingApiProvider);
    _locationSource = ref.read(foregroundLocationSourceProvider);
    _realtimeClient = ref.read(locationRealtimeClientProvider);
    ref.onDispose(() {
      _sessionExpiryTimer?.cancel();
      unawaited(_stopLocalCollection());
      _realtimeSubscription?.dispose();
    });
    return const LocationSharingState();
  }

  Future<void> startSharing({
    required String familyId,
    required String familyName,
  }) async {
    if (_operationInProgress || state.status != LocationSharingStatus.idle) {
      return;
    }
    _operationInProgress = true;
    final startLifecycleRevision = _lifecycleRevision;
    state = state.copyWith(isBusy: true, clearError: true, clearMessage: true);
    String? startedSessionId;
    try {
      if (!_appIsActive) return;
      final consent = await ref.read(locationConsentApiProvider).getConsent();
      final scope = consent.scopes.where((entry) => entry.familyId == familyId);
      if (scope.isEmpty || !scope.first.enabled) {
        state = state.copyWith(
          error:
              'Enable current location-sharing consent for this family first.',
        );
        return;
      }

      final permission = await _locationSource.requestForegroundPermission();
      if (permission.status != ForegroundPermissionStatus.granted) {
        state = state.copyWith(
          error: switch (permission.status) {
            ForegroundPermissionStatus.denied => 'Location permission was denied. Allow foreground location to start sharing.',
            ForegroundPermissionStatus.deniedForever => 'Location permission is disabled. Enable foreground location in Android settings.',
            ForegroundPermissionStatus.servicesDisabled =>
              'Turn on Android location services to start sharing.',
            ForegroundPermissionStatus.granted => null,
          },
        );
        return;
      }

      final session = await _api.start(familyId);
      final sessionId = session['id'];
      if (sessionId is! String || sessionId.isEmpty) {
        throw const AppError('The server returned an invalid sharing session.');
      }
      startedSessionId = sessionId;
      _sequence = 0;
      final expiresAt = DateTime.tryParse(
        session['expiresAt'] as String? ?? '',
      );
      if (expiresAt == null || !expiresAt.isAfter(DateTime.now())) {
        throw const AppError('The server returned an invalid sharing session.');
      }
      _scheduleSessionExpiry(expiresAt);
      if (!_appIsActive || startLifecycleRevision != _lifecycleRevision) {
        await _api.pause(familyId, sessionId);
        ref.invalidate(familyLocationsProvider(familyId));
        state = LocationSharingState(
          status: LocationSharingStatus.paused,
          familyId: familyId,
          familyName: familyName,
          sessionId: sessionId,
          message: 'Sharing remains paused while FamShield is inactive.',
        );
        return;
      }
      _collecting = true;
      state = LocationSharingState(
        status: LocationSharingStatus.sharing,
        familyId: familyId,
        familyName: familyName,
        sessionId: sessionId,
        isBusy: true,
        approximatePermission: permission.approximate,
        message: permission.approximate
            ? 'Sharing is active with approximate location permission.'
            : 'Sharing is active while FamShield is open.',
      );
      await _subscribeForLifecycleSignals(familyId);
      if (!_appIsActive || startLifecycleRevision != _lifecycleRevision) {
        await _pauseAfterLifecycleChange(familyId, sessionId);
        return;
      }
      _startPositionStream();
    } catch (error) {
      await _stopLocalCollection();
      if (startedSessionId != null) {
        try {
          await _api.stop(familyId, startedSessionId);
        } catch (_) {
          // Local collection is stopped; the server expires the session if unreachable.
        }
      }
      state = LocationSharingState(
        error: 'Unable to start sharing. Check your connection and try again.',
      );
    } finally {
      _operationInProgress = false;
      if (state.isBusy) state = state.copyWith(isBusy: false);
    }
  }

  Future<void> pauseSharing() async {
    if (_operationInProgress || state.status != LocationSharingStatus.sharing) {
      return;
    }
    await _pauseSession(
      message: 'Sharing paused. Location collection has stopped.',
    );
  }

  Future<void> pauseForLifecycle() async {
    if (state.status != LocationSharingStatus.sharing || _operationInProgress) {
      return;
    }
    await _pauseSession(
      message: 'Sharing paused because FamShield is no longer active.',
    );
  }

  void onLifecycleChanged({required bool isResumed}) {
    _appIsActive = isResumed;
    if (!isResumed) {
      _lifecycleRevision++;
      unawaited(pauseForLifecycle());
    }
  }

  Future<void> _pauseSession({required String message}) async {
    _operationInProgress = true;
    final familyId = state.familyId;
    final sessionId = state.sessionId;
    state = state.copyWith(
      status: LocationSharingStatus.paused,
      isBusy: true,
      clearError: true,
      message: message,
    );
    await _stopLocalCollection();
    try {
      if (familyId != null && sessionId != null) {
        await _api.pause(familyId, sessionId);
      }
    } catch (_) {
      state = state.copyWith(
        error: 'Location collection stopped on this device, but the server could not confirm the pause. Reconnect and stop or resume sharing explicitly.',
      );
    } finally {
      _operationInProgress = false;
      state = state.copyWith(isBusy: false);
    }
  }

  Future<void> _pauseAfterLifecycleChange(
    String familyId,
    String sessionId,
  ) async {
    _collecting = false;
    await _stopLocalCollection();
    ref.invalidate(familyLocationsProvider(familyId));
    try {
      await _api.pause(familyId, sessionId);
      state = state.copyWith(
        status: LocationSharingStatus.paused,
        isBusy: false,
        message: 'Sharing remains paused while FamShield is inactive.',
      );
    } catch (_) {
      state = state.copyWith(
        status: LocationSharingStatus.paused,
        isBusy: false,
        message:
            'Location collection stopped because FamShield became inactive.',
        error: 'The server could not confirm the pause. Location collection is stopped on this device.',
      );
    }
  }

  Future<void> resumeSharing() async {
    if (_operationInProgress ||
        state.status != LocationSharingStatus.paused ||
        state.familyId == null ||
        state.sessionId == null) {
      return;
    }
    _operationInProgress = true;
    final resumeLifecycleRevision = _lifecycleRevision;
    state = state.copyWith(isBusy: true, clearError: true);
    try {
      final consent = await ref.read(locationConsentApiProvider).getConsent();
      final scope = consent.scopes.where(
        (entry) => entry.familyId == state.familyId,
      );
      if (scope.isEmpty || !scope.first.enabled) {
        await _clearSession(
          message: 'Consent is no longer active. Sharing has stopped.',
        );
        return;
      }
      final permission = await _locationSource.requestForegroundPermission();
      if (permission.status != ForegroundPermissionStatus.granted) {
        state = state.copyWith(
          error: switch (permission.status) {
            ForegroundPermissionStatus.denied =>
              'Location permission was denied. Sharing remains paused.',
            ForegroundPermissionStatus.deniedForever =>
              'Enable foreground location in Android settings before resuming.',
            ForegroundPermissionStatus.servicesDisabled =>
              'Turn on Android location services before resuming.',
            ForegroundPermissionStatus.granted => null,
          },
        );
        return;
      }

      final familyId = state.familyId!;
      final sessionId = state.sessionId!;
      await _api.resume(familyId, sessionId);
      if (!_appIsActive || resumeLifecycleRevision != _lifecycleRevision) {
        await _api.pause(familyId, sessionId);
        state = state.copyWith(
          status: LocationSharingStatus.paused,
          message: 'Sharing remains paused. Resume explicitly while FamShield is active.',
        );
        return;
      }
      _collecting = true;
      state = state.copyWith(
        status: LocationSharingStatus.sharing,
        approximatePermission: permission.approximate,
        message: 'Sharing resumed while FamShield is open.',
      );
      await _subscribeForLifecycleSignals(familyId);
      if (!_appIsActive || resumeLifecycleRevision != _lifecycleRevision) {
        await _pauseAfterLifecycleChange(familyId, sessionId);
        return;
      }
      _startPositionStream();
    } catch (error) {
      if (_api.isAuthorizationOrSessionFailure(error)) {
        await _clearSession(
          message:
              'This sharing session is no longer valid. Start a new session.',
        );
      } else {
        state = state.copyWith(
          error:
              'Unable to resume sharing. Check your connection and try again.',
        );
      }
    } finally {
      _operationInProgress = false;
      if (state.isBusy) state = state.copyWith(isBusy: false);
    }
  }

  Future<void> stopSharing() async {
    if (_operationInProgress || !state.hasSession) return;
    _operationInProgress = true;
    final familyId = state.familyId;
    final sessionId = state.sessionId;
    await _stopLocalCollection();
    _sessionExpiryTimer?.cancel();
    _sessionExpiryTimer = null;
    if (familyId != null) {
      ref.invalidate(familyLocationsProvider(familyId));
    }
    _realtimeSubscription?.dispose();
    _realtimeSubscription = null;
    if (familyId != null) {
      ref.invalidate(familyLocationsProvider(familyId));
    }
    state = const LocationSharingState(message: 'Sharing stopped.');
    try {
      if (familyId != null && sessionId != null) {
        await _api.stop(familyId, sessionId);
      }
    } catch (_) {
      state = state.copyWith(
        error: 'Location collection stopped on this device, but the server could not confirm. Reconnect to verify sharing status.',
      );
    } finally {
      _operationInProgress = false;
    }
  }

  Future<void> stopForFamily(String familyId) async {
    if (state.familyId == familyId && state.hasSession) {
      await stopSharing();
    }
  }

  Future<void> stopForLogout() async {
    if (!state.hasSession) {
      await _stopLocalCollection();
      _realtimeSubscription?.dispose();
      _realtimeSubscription = null;
      ref.invalidate(familyLocationsProvider);
      return;
    }
    await stopSharing();
    ref.invalidate(familyLocationsProvider);
  }

  Future<void> revokeConsent(String familyId) async {
    await stopForFamily(familyId);
    await ref.read(locationConsentApiProvider).revoke(familyId);
    ref.invalidate(familyLocationsProvider(familyId));
    state = const LocationSharingState(message: 'Location consent revoked.');
  }

  void _startPositionStream() {
    _positionSubscription?.cancel();
    _positionSubscription = _locationSource.getPositionStream().listen(
      (fix) => unawaited(_queuePosition(fix)),
      onError: (Object _) {
        state = state.copyWith(
          error: 'Unable to read location. Sharing has been paused.',
        );
        unawaited(pauseForLifecycle());
      },
    );
  }

  Future<void> _queuePosition(LocationFix fix) async {
    if (!_collecting || state.status != LocationSharingStatus.sharing) return;
    final familyId = state.familyId;
    final sessionId = state.sessionId;
    if (familyId == null || sessionId == null) return;
    final sequence = ++_sequence;
    _positionQueue = _positionQueue.catchError((Object _) {}).then((_) async {
      if (!_collecting || state.status != LocationSharingStatus.sharing) return;
      final sessionExpiresAt = await _api.submitPosition(
        familyId: familyId,
        sessionId: sessionId,
        sequence: sequence,
        position: LocationFixPayload(
          latitude: fix.latitude,
          longitude: fix.longitude,
          accuracyMeters: fix.accuracyMeters,
          recordedAt: fix.recordedAt,
        ),
      );
      if (state.sessionId == sessionId &&
          state.status == LocationSharingStatus.sharing) {
        _scheduleSessionExpiry(sessionExpiresAt);
      }
    });
    try {
      await _positionQueue;
    } catch (error) {
      if (_api.isAuthorizationOrSessionFailure(error)) {
        await _clearSession(
          message: 'Consent, family membership, or the sharing session is no longer active.',
        );
      } else {
        await _pauseSession(
          message: 'Sharing paused because FamShield could not confirm the location update.',
        );
      }
    }
  }

  Future<void> _subscribeForLifecycleSignals(String familyId) async {
    _realtimeSubscription?.dispose();
    try {
      _realtimeSubscription = await _realtimeClient.subscribe(
        familyId: familyId,
        onChanged: () {},
        onInvalidated: () {
          ref.invalidate(familyLocationsProvider(familyId));
          unawaited(_revalidateAuthorization(familyId));
        },
      );
    } catch (_) {
      state = state.copyWith(
        message: 'Sharing is active. Realtime notifications are unavailable; authorization is still checked by the API.',
      );
    }
  }

  Future<void> _revalidateAuthorization(String familyId) async {
    if (!state.hasSession || state.familyId != familyId) {
      return;
    }
    try {
      final consent = await ref.read(locationConsentApiProvider).getConsent();
      final active = consent.scopes.any(
        (scope) => scope.familyId == familyId && scope.enabled,
      );
      if (!active) {
        await _clearSession(
          message: 'Location consent was revoked. Sharing has stopped.',
        );
        return;
      }
      await ref.read(familyApiProvider).getFamily(familyId);
    } catch (error) {
      if (_api.isAuthorizationOrSessionFailure(error)) {
        await _clearSession(
          message: 'Family access is no longer active. Sharing has stopped.',
        );
        return;
      }
      state = state.copyWith(
        error: 'Unable to verify sharing authorization. Location collection has been stopped.',
      );
      await _stopLocalCollection();
      state = state.copyWith(status: LocationSharingStatus.paused);
    }
  }

  void _scheduleSessionExpiry(DateTime expiresAt) {
    _sessionExpiryTimer?.cancel();
    final remaining = expiresAt.difference(DateTime.now());
    _sessionExpiryTimer = Timer(
      remaining.isNegative ? Duration.zero : remaining,
      () => unawaited(_expireSession()),
    );
  }

  Future<void> _expireSession() async {
    if (!state.hasSession) return;
    if (_operationInProgress) {
      _scheduleSessionExpiry(DateTime.now().add(const Duration(seconds: 1)));
      return;
    }
    await stopSharing();
    state = state.copyWith(
      message: 'The sharing session expired. Start a new session.',
    );
  }

  Future<void> _clearSession({required String message}) async {
    final familyId = state.familyId;
    await _stopLocalCollection();
    _sessionExpiryTimer?.cancel();
    _sessionExpiryTimer = null;
    _realtimeSubscription?.dispose();
    _realtimeSubscription = null;
    if (familyId != null) {
      ref.invalidate(familyLocationsProvider(familyId));
    }
    state = LocationSharingState(message: message);
  }

  Future<void> _stopLocalCollection() async {
    _collecting = false;
    final subscription = _positionSubscription;
    _positionSubscription = null;
    await subscription?.cancel();
    try {
      await _positionQueue;
    } catch (_) {
      // An update error is already surfaced without including its payload.
    }
  }
}
