import 'dart:async';

import 'package:dio/dio.dart';
import 'package:famshield_mobile/core/app_error.dart';
import 'package:famshield_mobile/core/session_store.dart';
import 'package:famshield_mobile/features/auth/auth_state.dart';
import 'package:famshield_mobile/features/families/family_providers.dart';
import 'package:famshield_mobile/features/location/location_providers.dart';
import 'package:famshield_mobile/features/location/screens/family_location_screen.dart';
import 'package:famshield_mobile/features/privacy/privacy_providers.dart';
import 'package:famshield_mobile/models/family.dart';
import 'package:famshield_mobile/models/family_location.dart';
import 'package:famshield_mobile/models/location_consent.dart';
import 'package:famshield_mobile/services/auth_api.dart';
import 'package:famshield_mobile/services/location_consent_api.dart';
import 'package:famshield_mobile/services/location_realtime_client.dart';
import 'package:famshield_mobile/services/location_sharing_api.dart';
import 'package:famshield_mobile/services/foreground_location_source.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'helpers/fakes.dart';

class _MemoryStore implements SessionStore {
  @override
  Future<String?> readAccessToken() async => null;

  @override
  Future<String?> readRefreshToken() async => null;

  @override
  Future<void> writeTokens({
    required String accessToken,
    required String refreshToken,
  }) async {}

  @override
  Future<void> clear() async {}
}

class _FakeConsentApi extends LocationConsentApi {
  _FakeConsentApi({this.enabled = true})
    : super(
        AuthApi(
          dio: Dio(BaseOptions(baseUrl: 'https://famshield.test/api/')),
          sessionStore: _MemoryStore(),
        ),
      );

  bool enabled;
  int revokeCalls = 0;

  @override
  Future<LocationConsentState> getConsent() async => LocationConsentState(
    policyVersion: 'location-sharing-v1',
    scopes: [
      LocationConsentScope(
        familyId: 'family-id',
        familyName: 'Northstar',
        enabled: enabled,
      ),
    ],
  );

  @override
  Future<void> revoke(String familyId) async {
    revokeCalls++;
    enabled = false;
  }
}

class _FakeLocationApi extends LocationSharingApi {
  _FakeLocationApi({
    this.sessionLifetime = const Duration(minutes: 10),
    this.positionSessionLifetime = const Duration(minutes: 10),
  }) : super(
         AuthApi(
           dio: Dio(BaseOptions(baseUrl: 'https://famshield.test/api/')),
           sessionStore: _MemoryStore(),
         ),
       );

  final Duration sessionLifetime;
  final Duration positionSessionLifetime;
  int starts = 0;
  int pauses = 0;
  int resumes = 0;
  int stops = 0;
  int positions = 0;
  Object? submitError;
  Completer<Map<String, dynamic>>? startGate;
  Completer<void>? startEntered;
  Completer<void>? resumeGate;
  Completer<void>? resumeEntered;

  @override
  Future<Map<String, dynamic>> start(String familyId) async {
    starts++;
    final entered = startEntered;
    if (entered != null && !entered.isCompleted) entered.complete();
    return startGate?.future ?? _sessionResponse();
  }

  @override
  Future<void> pause(String familyId, String sessionId) async {
    pauses++;
  }

  @override
  Future<void> resume(String familyId, String sessionId) async {
    resumes++;
    final entered = resumeEntered;
    if (entered != null && !entered.isCompleted) entered.complete();
    await resumeGate?.future;
  }

  @override
  Future<void> stop(String familyId, String sessionId) async {
    stops++;
  }

  @override
  Future<DateTime> submitPosition({
    required String familyId,
    required String sessionId,
    required int sequence,
    required LocationFixPayload position,
  }) async {
    positions++;
    if (submitError case final error?) throw error;
    return DateTime.now().add(positionSessionLifetime);
  }

  @override
  bool isAuthorizationOrSessionFailure(Object _) => false;

  Map<String, dynamic> _sessionResponse() => {
    'id': 'session-id',
    'expiresAt': DateTime.now().add(sessionLifetime).toUtc().toIso8601String(),
  };
}

class _FakeLocationSource implements ForegroundLocationSource {
  ForegroundPermissionResult result = const ForegroundPermissionResult(
    status: ForegroundPermissionStatus.granted,
    approximate: false,
  );
  int permissionRequests = 0;
  int activeStreams = 0;
  final controller = StreamController<LocationFix>.broadcast();

  @override
  Future<ForegroundPermissionResult> requestForegroundPermission() async {
    permissionRequests++;
    return result;
  }

  @override
  Stream<LocationFix> getPositionStream() => Stream<LocationFix>.multi((sink) {
    activeStreams++;
    final subscription = controller.stream.listen(
      sink.add,
      onError: sink.addError,
      onDone: sink.close,
    );
    sink.onCancel = () async {
      activeStreams--;
      await subscription.cancel();
    };
  });
}

class _FakeRealtimeClient implements LocationRealtimeClient {
  void Function()? onChanged;
  void Function()? onInvalidated;
  int subscriptions = 0;
  Completer<LocationRealtimeSubscription>? subscribeGate;
  Completer<void>? subscribeEntered;

  @override
  Future<LocationRealtimeSubscription> subscribe({
    required String familyId,
    required void Function() onChanged,
    required void Function() onInvalidated,
  }) async {
    subscriptions++;
    this.onChanged = onChanged;
    this.onInvalidated = onInvalidated;
    final entered = subscribeEntered;
    if (entered != null && !entered.isCompleted) entered.complete();
    return await subscribeGate?.future ?? _FakeRealtimeSubscription();
  }
}

class _FakeRealtimeSubscription implements LocationRealtimeSubscription {
  @override
  void dispose() {}
}

const _family = FamilySummary(
  id: 'family-id',
  name: 'Northstar',
  createdBy: 'owner-id',
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
  role: 'member',
);

final _familyLocation = FamilyLocation(
  userId: 'sharer-id',
  fullName: 'Avery Example',
  latitude: 37.4219,
  longitude: -122.0840,
  accuracyMeters: 12,
  recordedAt: DateTime.utc(2025, 1, 1),
  status: 'fresh',
);

ProviderContainer _container({
  bool consent = true,
  ForegroundPermissionResult? permission,
  _FakeLocationApi? api,
  _FakeLocationSource? source,
  _FakeRealtimeClient? realtime,
}) {
  final actualSource = source ?? _FakeLocationSource();
  if (permission != null) actualSource.result = permission;
  return ProviderContainer(
    overrides: [
      locationConsentApiProvider.overrideWithValue(
        _FakeConsentApi(enabled: consent),
      ),
      locationSharingApiProvider.overrideWithValue(api ?? _FakeLocationApi()),
      foregroundLocationSourceProvider.overrideWithValue(actualSource),
      locationRealtimeClientProvider.overrideWithValue(
        realtime ?? _FakeRealtimeClient(),
      ),
    ],
  );
}

Future<void> _start(LocationSharingController controller) =>
    controller.startSharing(familyId: 'family-id', familyName: 'Northstar');

void main() {
  test('starts only after active consent and an explicit start call', () async {
    final api = _FakeLocationApi();
    final source = _FakeLocationSource();
    final container = _container(api: api, source: source);
    addTearDown(container.dispose);

    expect(api.starts, 0);
    expect(source.permissionRequests, 0);
    await _start(container.read(locationSharingProvider.notifier));

    expect(container.read(locationSharingProvider).isSharing, isTrue);
    expect(source.permissionRequests, 1);
    expect(api.starts, 1);
  });

  test('does not request device permission without active consent', () async {
    final api = _FakeLocationApi();
    final source = _FakeLocationSource();
    final container = _container(consent: false, api: api, source: source);
    addTearDown(container.dispose);

    await _start(container.read(locationSharingProvider.notifier));

    expect(source.permissionRequests, 0);
    expect(api.starts, 0);
    expect(container.read(locationSharingProvider).isSharing, isFalse);
    expect(container.read(locationSharingProvider).error, contains('consent'));
  });

  test(
    'does not start a session when foreground permission is denied',
    () async {
      final api = _FakeLocationApi();
      final source = _FakeLocationSource()
        ..result = const ForegroundPermissionResult(
          status: ForegroundPermissionStatus.denied,
          approximate: false,
        );
      final container = _container(api: api, source: source);
      addTearDown(container.dispose);

      await _start(container.read(locationSharingProvider.notifier));

      expect(source.permissionRequests, 1);
      expect(api.starts, 0);
      expect(container.read(locationSharingProvider).isSharing, isFalse);
    },
  );

  test('supports approximate foreground permission', () async {
    final api = _FakeLocationApi();
    final source = _FakeLocationSource()
      ..result = const ForegroundPermissionResult(
        status: ForegroundPermissionStatus.granted,
        approximate: true,
      );
    final container = _container(api: api, source: source);
    addTearDown(container.dispose);

    await _start(container.read(locationSharingProvider.notifier));

    expect(api.starts, 1);
    expect(container.read(locationSharingProvider).isSharing, isTrue);
    expect(
      container.read(locationSharingProvider).approximatePermission,
      isTrue,
    );
  });

  test('permanently denied permission explains how to recover', () async {
    final api = _FakeLocationApi();
    final source = _FakeLocationSource()
      ..result = const ForegroundPermissionResult(
        status: ForegroundPermissionStatus.deniedForever,
        approximate: false,
      );
    final container = _container(api: api, source: source);
    addTearDown(container.dispose);

    await _start(container.read(locationSharingProvider.notifier));

    expect(api.starts, 0);
    expect(source.activeStreams, 0);
    expect(
      container.read(locationSharingProvider).error,
      contains('Android settings'),
    );
  });

  test(
    'a server invalidation stops sharing after consent is revoked',
    () async {
      final consent = _FakeConsentApi();
      final source = _FakeLocationSource();
      final realtime = _FakeRealtimeClient();
      final container = ProviderContainer(
        overrides: [
          locationConsentApiProvider.overrideWithValue(consent),
          locationSharingApiProvider.overrideWithValue(_FakeLocationApi()),
          foregroundLocationSourceProvider.overrideWithValue(source),
          locationRealtimeClientProvider.overrideWithValue(realtime),
        ],
      );
      addTearDown(container.dispose);
      final controller = container.read(locationSharingProvider.notifier);

      await _start(controller);
      consent.enabled = false;
      realtime.onInvalidated?.call();
      await Future<void>.delayed(const Duration(milliseconds: 10));

      expect(container.read(locationSharingProvider).hasSession, isFalse);
      expect(source.activeStreams, 0);
    },
  );

  test('pause, explicit resume, and stop control the same session', () async {
    final api = _FakeLocationApi();
    final source = _FakeLocationSource();
    final container = _container(api: api, source: source);
    addTearDown(container.dispose);
    final controller = container.read(locationSharingProvider.notifier);

    await _start(controller);
    expect(source.activeStreams, 1);
    await controller.pauseSharing();
    expect(source.activeStreams, 0);
    expect(
      container.read(locationSharingProvider).status,
      LocationSharingStatus.paused,
    );
    expect(api.pauses, 1);

    await controller.resumeSharing();
    expect(source.activeStreams, 1);
    expect(container.read(locationSharingProvider).isSharing, isTrue);
    expect(api.resumes, 1);
    expect(api.starts, 1);

    await controller.stopSharing();
    expect(source.activeStreams, 0);
    expect(
      container.read(locationSharingProvider).status,
      LocationSharingStatus.idle,
    );
    expect(api.stops, 1);
    source.controller.add(
      LocationFix(
        latitude: 37.4219,
        longitude: -122.084,
        accuracyMeters: 12,
        recordedAt: DateTime.now(),
      ),
    );
    await Future<void>.delayed(Duration.zero);
    expect(api.positions, 0);
  });

  test(
    'revoking consent stops local sharing before revoking the grant',
    () async {
      final consent = _FakeConsentApi();
      final api = _FakeLocationApi();
      final container = ProviderContainer(
        overrides: [
          locationConsentApiProvider.overrideWithValue(consent),
          locationSharingApiProvider.overrideWithValue(api),
          foregroundLocationSourceProvider.overrideWithValue(
            _FakeLocationSource(),
          ),
          locationRealtimeClientProvider.overrideWithValue(
            _FakeRealtimeClient(),
          ),
        ],
      );
      addTearDown(container.dispose);
      final controller = container.read(locationSharingProvider.notifier);

      await _start(controller);
      await controller.revokeConsent('family-id');

      expect(api.stops, 1);
      expect(consent.revokeCalls, 1);
      expect(container.read(locationSharingProvider).hasSession, isFalse);
    },
  );

  test(
    'app becoming inactive pauses collection and requires explicit resume',
    () async {
      final api = _FakeLocationApi();
      final container = _container(api: api);
      addTearDown(container.dispose);
      final controller = container.read(locationSharingProvider.notifier);

      await _start(controller);
      controller.onLifecycleChanged(isResumed: false);
      await Future<void>.delayed(Duration.zero);

      expect(api.pauses, 1);
      expect(
        container.read(locationSharingProvider).status,
        LocationSharingStatus.paused,
      );
      controller.onLifecycleChanged(isResumed: true);
      expect(
        container.read(locationSharingProvider).status,
        LocationSharingStatus.paused,
      );
      await controller.resumeSharing();
      expect(container.read(locationSharingProvider).isSharing, isTrue);
    },
  );

  test(
    'start finishing after an app background round trip stays paused',
    () async {
      final api = _FakeLocationApi()
        ..startGate = Completer<Map<String, dynamic>>()
        ..startEntered = Completer<void>();
      final source = _FakeLocationSource();
      final container = _container(api: api, source: source);
      addTearDown(container.dispose);
      final controller = container.read(locationSharingProvider.notifier);

      final starting = _start(controller);
      await api.startEntered!.future;
      controller.onLifecycleChanged(isResumed: false);
      controller.onLifecycleChanged(isResumed: true);
      api.startGate!.complete(api._sessionResponse());
      await starting;

      expect(api.pauses, 1);
      expect(source.activeStreams, 0);
      expect(
        container.read(locationSharingProvider).status,
        LocationSharingStatus.paused,
      );
    },
  );

  test(
    'lifecycle change during realtime subscription after start stays paused',
    () async {
      final api = _FakeLocationApi();
      final realtime = _FakeRealtimeClient()
        ..subscribeGate = Completer<LocationRealtimeSubscription>()
        ..subscribeEntered = Completer<void>();
      final source = _FakeLocationSource();
      final container = _container(
        api: api,
        source: source,
        realtime: realtime,
      );
      addTearDown(container.dispose);
      final controller = container.read(locationSharingProvider.notifier);

      final starting = _start(controller);
      await realtime.subscribeEntered!.future;
      controller.onLifecycleChanged(isResumed: false);
      controller.onLifecycleChanged(isResumed: true);
      realtime.subscribeGate!.complete(_FakeRealtimeSubscription());
      await starting;

      expect(api.pauses, 1);
      expect(source.activeStreams, 0);
      expect(
        container.read(locationSharingProvider).status,
        LocationSharingStatus.paused,
      );
    },
  );

  test(
    'resume finishing after an app background round trip stays paused',
    () async {
      final api = _FakeLocationApi();
      final source = _FakeLocationSource();
      final container = _container(api: api, source: source);
      addTearDown(container.dispose);
      final controller = container.read(locationSharingProvider.notifier);
      await _start(controller);
      await controller.pauseSharing();
      api
        ..resumeGate = Completer<void>()
        ..resumeEntered = Completer<void>();

      final resuming = controller.resumeSharing();
      await api.resumeEntered!.future;
      controller.onLifecycleChanged(isResumed: false);
      controller.onLifecycleChanged(isResumed: true);
      api.resumeGate!.complete();
      await resuming;

      expect(api.resumes, 1);
      expect(api.pauses, 2);
      expect(source.activeStreams, 0);
      expect(
        container.read(locationSharingProvider).status,
        LocationSharingStatus.paused,
      );
    },
  );

  test(
    'lifecycle change during realtime subscription after resume stays paused',
    () async {
      final api = _FakeLocationApi();
      final realtime = _FakeRealtimeClient();
      final source = _FakeLocationSource();
      final container = _container(
        api: api,
        source: source,
        realtime: realtime,
      );
      addTearDown(container.dispose);
      final controller = container.read(locationSharingProvider.notifier);
      await _start(controller);
      await controller.pauseSharing();
      realtime
        ..subscribeGate = Completer<LocationRealtimeSubscription>()
        ..subscribeEntered = Completer<void>();

      final resuming = controller.resumeSharing();
      await realtime.subscribeEntered!.future;
      controller.onLifecycleChanged(isResumed: false);
      controller.onLifecycleChanged(isResumed: true);
      realtime.subscribeGate!.complete(_FakeRealtimeSubscription());
      await resuming;

      expect(api.pauses, 2);
      expect(source.activeStreams, 0);
      expect(
        container.read(locationSharingProvider).status,
        LocationSharingStatus.paused,
      );
    },
  );

  test('network failure stops local collection and pauses sharing', () async {
    final api = _FakeLocationApi()..submitError = const AppError('offline');
    final source = _FakeLocationSource();
    final container = _container(api: api, source: source);
    addTearDown(container.dispose);
    final controller = container.read(locationSharingProvider.notifier);

    await _start(controller);
    source.controller.add(
      LocationFix(
        latitude: 37.4219,
        longitude: -122.084,
        accuracyMeters: 12,
        recordedAt: DateTime.now(),
      ),
    );
    await Future<void>.delayed(const Duration(milliseconds: 10));

    final state = container.read(locationSharingProvider);
    expect(state.status, LocationSharingStatus.paused);
    expect(state.message, contains('paused'));
    expect(source.activeStreams, 0);
    expect(api.pauses, 1);
    expect(api.positions, 1);
    expect(state.error, isNot(contains('37.4219')));
    expect(state.error, isNot(contains('-122.084')));
  });

  test('logout and session expiry stop active collection', () async {
    final api = _FakeLocationApi();
    final container = _container(api: api);
    addTearDown(container.dispose);
    final controller = container.read(locationSharingProvider.notifier);

    await _start(controller);
    await controller.stopForLogout();
    expect(api.stops, 1);
    expect(container.read(locationSharingProvider).hasSession, isFalse);
  });

  test('the sharing session expiry stops collection', () async {
    final api = _FakeLocationApi(
      sessionLifetime: const Duration(milliseconds: 20),
      positionSessionLifetime: const Duration(milliseconds: 100),
    );
    final source = _FakeLocationSource();
    final container = _container(api: api, source: source);
    addTearDown(container.dispose);

    await _start(container.read(locationSharingProvider.notifier));
    source.controller.add(
      LocationFix(
        latitude: 37.4219,
        longitude: -122.084,
        accuracyMeters: 12,
        recordedAt: DateTime.now(),
      ),
    );
    await Future<void>.delayed(const Duration(milliseconds: 10));
    expect(api.positions, 1);
    await Future<void>.delayed(const Duration(milliseconds: 40));

    expect(container.read(locationSharingProvider).hasSession, isTrue);
    await Future<void>.delayed(const Duration(milliseconds: 80));
    expect(container.read(locationSharingProvider).hasSession, isFalse);
    expect(
      container.read(locationSharingProvider).message,
      contains('expired'),
    );
    expect(api.stops, 1);
    expect(source.activeStreams, 0);
  });

  test(
    'auth logout and session expiry stop an active sharing session',
    () async {
      final api = _FakeLocationApi();
      final authApi = FakeAuthApi(restoredUser: testUser);
      final container = ProviderContainer(
        overrides: [
          authApiProvider.overrideWithValue(authApi),
          locationConsentApiProvider.overrideWithValue(_FakeConsentApi()),
          locationSharingApiProvider.overrideWithValue(api),
          foregroundLocationSourceProvider.overrideWithValue(
            _FakeLocationSource(),
          ),
          locationRealtimeClientProvider.overrideWithValue(
            _FakeRealtimeClient(),
          ),
        ],
      );
      addTearDown(container.dispose);
      await container.read(authProvider.future);
      final controller = container.read(locationSharingProvider.notifier);

      await _start(controller);
      await container.read(authProvider.notifier).signOut(everywhere: true);
      expect(authApi.logoutAllCalls, 1);
      expect(api.stops, 1);
      expect(container.read(locationSharingProvider).hasSession, isFalse);

      await container.read(authProvider.notifier).signIn('user', 'password');
      await _start(controller);
      container.read(authProvider.notifier).sessionExpired();
      await Future<void>.delayed(const Duration(milliseconds: 10));
      expect(api.stops, 2);
      expect(container.read(locationSharingProvider).hasSession, isFalse);
    },
  );

  testWidgets('socket metadata triggers an authorized HTTP refresh', (
    tester,
  ) async {
    final realtime = _FakeRealtimeClient();
    var reads = 0;
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          familyDetailsProvider.overrideWith((ref, familyId) async => _family),
          locationConsentProvider.overrideWith(
            (ref) async => const LocationConsentState(
              policyVersion: 'location-sharing-v1',
              scopes: [
                LocationConsentScope(
                  familyId: 'family-id',
                  familyName: 'Northstar',
                  enabled: false,
                ),
              ],
            ),
          ),
          familyLocationsProvider.overrideWith((ref, familyId) async {
            reads++;
            return [_familyLocation];
          }),
          locationRealtimeClientProvider.overrideWithValue(realtime),
          locationSharingApiProvider.overrideWithValue(_FakeLocationApi()),
          foregroundLocationSourceProvider.overrideWithValue(
            _FakeLocationSource(),
          ),
          locationConsentApiProvider.overrideWithValue(_FakeConsentApi()),
        ],
        child: const MaterialApp(
          home: FamilyLocationScreen(familyId: 'family-id'),
        ),
      ),
    );
    await tester.pumpAndSettle();
    final initialReads = reads;
    expect(initialReads, greaterThan(0));
    await tester.scrollUntilVisible(
      find.textContaining('37.4219'),
      300,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.textContaining('37.4219'), findsOneWidget);

    realtime.onChanged?.call();
    await tester.pumpAndSettle();

    expect(reads, greaterThan(initialReads));
    await tester.pumpWidget(const SizedBox.shrink());
  });
}
