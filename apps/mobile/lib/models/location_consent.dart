class LocationConsentScope {
  const LocationConsentScope({
    required this.familyId,
    required this.familyName,
    required this.enabled,
    this.needsReview = false,
    this.grantedAt,
    this.grantedPolicyVersion,
  });

  final String familyId;
  final String familyName;
  final bool enabled;
  final bool needsReview;
  final String? grantedAt;
  final String? grantedPolicyVersion;

  factory LocationConsentScope.fromJson(Map<String, dynamic> json) =>
      LocationConsentScope(
        familyId: json['familyId'] as String,
        familyName: json['familyName'] as String,
        enabled: json['enabled'] as bool,
        needsReview: json['needsReview'] as bool? ?? false,
        grantedAt: json['grantedAt'] as String?,
        grantedPolicyVersion: json['grantedPolicyVersion'] as String?,
      );
}

class LocationConsentState {
  const LocationConsentState({
    required this.policyVersion,
    required this.scopes,
  });

  final String policyVersion;
  final List<LocationConsentScope> scopes;

  factory LocationConsentState.fromJson(Map<String, dynamic> json) =>
      LocationConsentState(
        policyVersion: json['policyVersion'] as String,
        scopes: (json['scopes'] as List<dynamic>)
            .map(
              (scope) =>
                  LocationConsentScope.fromJson(scope as Map<String, dynamic>),
            )
            .toList(),
      );
}

class LocationConsentHistoryEntry {
  const LocationConsentHistoryEntry({
    required this.id,
    required this.status,
    required this.grantedAt,
    required this.revokedAt,
    required this.policyVersion,
    required this.recordedAt,
    this.familyId,
  });

  final String id;
  final String? familyId;
  final String status;
  final String? grantedAt;
  final String? revokedAt;
  final String policyVersion;
  final String recordedAt;

  factory LocationConsentHistoryEntry.fromJson(Map<String, dynamic> json) =>
      LocationConsentHistoryEntry(
        id: json['id'] as String,
        familyId: json['familyId'] as String?,
        status: json['status'] as String,
        grantedAt: json['grantedAt'] as String?,
        revokedAt: json['revokedAt'] as String?,
        policyVersion: json['policyVersion'] as String,
        recordedAt: json['recordedAt'] as String,
      );
}
