class FamilySummary {
  const FamilySummary({
    required this.id,
    required this.name,
    required this.createdBy,
    required this.createdAt,
    required this.updatedAt,
    this.role,
  });

  final String id;
  final String name;
  final String createdBy;
  final String createdAt;
  final String updatedAt;
  final String? role;

  factory FamilySummary.fromJson(Map<String, dynamic> json) => FamilySummary(
    id: json['id'] as String,
    name: json['name'] as String,
    createdBy: json['createdBy'] as String,
    createdAt: json['createdAt'] as String,
    updatedAt: json['updatedAt'] as String,
    role: json['role'] as String?,
  );
}

class FamilyMember {
  const FamilyMember({
    required this.familyId,
    required this.userId,
    required this.fullName,
    required this.role,
    required this.status,
    required this.joinedAt,
    this.profileImageUrl,
  });

  final String familyId;
  final String userId;
  final String fullName;
  final String role;
  final String status;
  final String joinedAt;
  final String? profileImageUrl;

  factory FamilyMember.fromJson(Map<String, dynamic> json) => FamilyMember(
    familyId: json['familyId'] as String,
    userId: json['userId'] as String,
    fullName: json['fullName'] as String,
    role: json['role'] as String,
    status: json['status'] as String,
    joinedAt: json['joinedAt'] as String,
    profileImageUrl: json['profileImageUrl'] as String?,
  );
}

class FamilyInvitation {
  const FamilyInvitation({
    required this.id,
    required this.expiresAt,
    this.familyId,
    this.inviteeEmail,
    this.inviteePhone,
    this.status,
    this.familyName,
    this.inviterName,
    this.createdAt,
  });

  final String id;
  final String? familyId;
  final String? inviteeEmail;
  final String? inviteePhone;
  final String? status;
  final String? familyName;
  final String? inviterName;
  final String expiresAt;
  final String? createdAt;

  factory FamilyInvitation.fromJson(Map<String, dynamic> json) {
    final family = json['family'];
    return FamilyInvitation(
      id: json['id'] as String,
      familyId: json['familyId'] as String?,
      inviteeEmail: json['inviteeEmail'] as String?,
      inviteePhone: json['inviteePhone'] as String?,
      status: json['status'] as String?,
      familyName: family is Map<String, dynamic>
          ? family['name'] as String?
          : null,
      inviterName: json['inviterName'] as String?,
      expiresAt: json['expiresAt'] as String,
      createdAt: json['createdAt'] as String?,
    );
  }
}

class CreatedFamilyInvitation {
  const CreatedFamilyInvitation({
    required this.invitation,
    required this.token,
  });

  final FamilyInvitation invitation;
  final String token;

  factory CreatedFamilyInvitation.fromJson(Map<String, dynamic> json) =>
      CreatedFamilyInvitation(
        invitation: FamilyInvitation.fromJson(
          json['invitation'] as Map<String, dynamic>,
        ),
        token: json['token'] as String,
      );
}
