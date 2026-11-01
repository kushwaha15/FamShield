import '../core/app_error.dart';
import '../models/family.dart';
import 'auth_api.dart';

class FamilyApi {
  const FamilyApi(this._authApi);

  final AuthApi _authApi;

  Future<List<FamilySummary>> getFamilies() async {
    final data = await _authApi.getFamilyResource('families');
    final values = data['families'];
    if (values is! List<dynamic>) {
      throw const AppError('The server returned an invalid family list.');
    }
    return values
        .map((value) => FamilySummary.fromJson(value as Map<String, dynamic>))
        .toList();
  }

  Future<FamilySummary> createFamily(String name) async {
    final data = await _authApi.postFamilyResource(
      'families',
      body: {'name': name.trim()},
    );
    return FamilySummary.fromJson(data['family'] as Map<String, dynamic>);
  }

  Future<FamilySummary> getFamily(String familyId) async {
    final data = await _authApi.getFamilyResource(
      'families/${Uri.encodeComponent(familyId)}',
    );
    return FamilySummary.fromJson(data['family'] as Map<String, dynamic>);
  }

  Future<List<FamilyMember>> getFamilyMembers(String familyId) async {
    final data = await _authApi.getFamilyResource(
      'families/${Uri.encodeComponent(familyId)}/members',
    );
    final values = data['members'];
    if (values is! List<dynamic>) {
      throw const AppError(
        'The server returned an invalid family member list.',
      );
    }
    return values
        .map((value) => FamilyMember.fromJson(value as Map<String, dynamic>))
        .toList();
  }

  Future<CreatedFamilyInvitation> createInvitation(
    String familyId, {
    String? email,
    String? phone,
  }) async {
    if ((email == null) == (phone == null)) {
      throw const AppError(
        'Provide exactly one email address or phone number.',
      );
    }
    final data = await _authApi.postFamilyResource(
      'families/${Uri.encodeComponent(familyId)}/invitations',
      body: {
        if (email != null) 'email': email.trim(),
        if (phone != null) 'phone': phone.trim(),
      },
    );
    return CreatedFamilyInvitation.fromJson(data);
  }

  Future<List<FamilyInvitation>> getFamilyInvitations(String familyId) async {
    final data = await _authApi.getFamilyResource(
      'families/${Uri.encodeComponent(familyId)}/invitations',
    );
    final values = data['invitations'];
    if (values is! List<dynamic>) {
      throw const AppError('The server returned an invalid invitation list.');
    }
    return values
        .map(
          (value) => FamilyInvitation.fromJson(value as Map<String, dynamic>),
        )
        .toList();
  }

  Future<List<FamilyInvitation>> getMyInvitations() async {
    final data = await _authApi.getFamilyResource('invitations');
    final values = data['invitations'];
    if (values is! List<dynamic>) {
      throw const AppError('The server returned an invalid invitation list.');
    }
    return values
        .map(
          (value) => FamilyInvitation.fromJson(value as Map<String, dynamic>),
        )
        .toList();
  }

  Future<FamilySummary> acceptInvitation(String token) async {
    final data = await _authApi.postFamilyResource(
      'invitations/accept',
      body: {'token': token},
    );
    return FamilySummary.fromJson(data['family'] as Map<String, dynamic>);
  }

  Future<void> declineInvitation(String token) async {
    await _authApi.postFamilyResource(
      'invitations/decline',
      body: {'token': token},
    );
  }

  Future<void> revokeInvitation(String familyId, String invitationId) =>
      _authApi.deleteFamilyResource(
        'families/${Uri.encodeComponent(familyId)}/invitations/'
        '${Uri.encodeComponent(invitationId)}',
      );

  Future<void> removeMember(String familyId, String userId) =>
      _authApi.deleteFamilyResource(
        'families/${Uri.encodeComponent(familyId)}/members/'
        '${Uri.encodeComponent(userId)}',
      );

  Future<void> leaveFamily(String familyId) async {
    await _authApi.postFamilyResource(
      'families/${Uri.encodeComponent(familyId)}/leave',
    );
  }

  Future<void> transferOwnership(String familyId, String targetUserId) async {
    await _authApi.postFamilyResource(
      'families/${Uri.encodeComponent(familyId)}/transfer-ownership',
      body: {'targetUserId': targetUserId},
    );
  }
}
