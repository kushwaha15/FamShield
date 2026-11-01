import 'package:dio/dio.dart';

import '../core/app_error.dart';
import '../models/family_location.dart';
import 'auth_api.dart';

class LocationSharingApi {
  const LocationSharingApi(this._authApi);

  final AuthApi _authApi;

  Future<Map<String, dynamic>> start(String familyId) async =>
      _authApi.postFamilyResource(
        'families/${Uri.encodeComponent(familyId)}/location-sharing/sessions',
      );

  Future<void> pause(String familyId, String sessionId) =>
      _changeSession(familyId, sessionId, 'pause');

  Future<void> resume(String familyId, String sessionId) =>
      _changeSession(familyId, sessionId, 'resume');

  Future<void> stop(String familyId, String sessionId) =>
      _changeSession(familyId, sessionId, 'stop');

  Future<void> _changeSession(
    String familyId,
    String sessionId,
    String action,
  ) async {
    await _authApi.postFamilyResource(
      'families/${Uri.encodeComponent(familyId)}/location-sharing/sessions/'
      '${Uri.encodeComponent(sessionId)}/$action',
    );
  }

  Future<DateTime> submitPosition({
    required String familyId,
    required String sessionId,
    required int sequence,
    required LocationFixPayload position,
  }) async {
    final data = await _authApi.putFamilyResource(
      'families/${Uri.encodeComponent(familyId)}/location-sharing/sessions/'
      '${Uri.encodeComponent(sessionId)}/position',
      body: {
        'latitude': position.latitude,
        'longitude': position.longitude,
        'accuracyMeters': position.accuracyMeters,
        'sequence': sequence,
        'clientRecordedAt': position.recordedAt.toUtc().toIso8601String(),
      },
    );
    final sessionExpiresAt = DateTime.tryParse(
      data['sessionExpiresAt'] as String? ?? '',
    );
    if (sessionExpiresAt == null) {
      throw const AppError(
        'The server returned an invalid location session expiry.',
      );
    }
    return sessionExpiresAt;
  }

  Future<List<FamilyLocation>> getFamilyLocations(String familyId) async {
    final data = await _authApi.getFamilyResource(
      'families/${Uri.encodeComponent(familyId)}/locations',
    );
    final locations = data['locations'];
    if (locations is! List<dynamic>) {
      throw const AppError('The server returned an invalid location list.');
    }
    return locations
        .map((entry) => FamilyLocation.fromJson(entry as Map<String, dynamic>))
        .toList();
  }

  bool isAuthorizationOrSessionFailure(Object error) =>
      error is AppError &&
      error.cause is DioException &&
      const {
        401,
        403,
        404,
        409,
      }.contains((error.cause! as DioException).response?.statusCode);
}

class LocationFixPayload {
  const LocationFixPayload({
    required this.latitude,
    required this.longitude,
    required this.accuracyMeters,
    required this.recordedAt,
  });

  final double latitude;
  final double longitude;
  final double accuracyMeters;
  final DateTime recordedAt;
}
