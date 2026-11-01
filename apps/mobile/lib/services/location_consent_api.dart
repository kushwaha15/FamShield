import '../core/app_error.dart';
import '../models/location_consent.dart';
import 'auth_api.dart';

class LocationConsentApi {
  const LocationConsentApi(this._authApi);

  final AuthApi _authApi;

  Future<LocationConsentState> getConsent() async {
    final data = await _authApi.getFamilyResource('consents/location-sharing');
    return LocationConsentState.fromJson(data);
  }

  Future<List<LocationConsentHistoryEntry>> getHistory() async {
    final data = await _authApi.getFamilyResource(
      'consents/location-sharing/history',
    );
    final values = data['history'];
    if (values is! List<dynamic>) {
      throw const AppError('The server returned an invalid consent history.');
    }
    return values
        .map(
          (entry) => LocationConsentHistoryEntry.fromJson(
            entry as Map<String, dynamic>,
          ),
        )
        .toList();
  }

  Future<void> grant({
    required String familyId,
    required String policyVersion,
    required bool confirmed,
  }) async {
    if (!confirmed) {
      throw const AppError('Confirm the consent information before enabling.');
    }
    await _authApi.postFamilyResource(
      'consents/location-sharing',
      body: {
        'familyId': familyId,
        'policyVersion': policyVersion,
        'confirmed': true,
      },
    );
  }

  Future<void> revoke(String familyId) => _authApi.deleteFamilyResource(
    'consents/location-sharing/${Uri.encodeComponent(familyId)}',
  );
}
