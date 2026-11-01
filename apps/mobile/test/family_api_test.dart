import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:famshield_mobile/core/session_store.dart';
import 'package:famshield_mobile/models/family.dart';
import 'package:famshield_mobile/services/auth_api.dart';
import 'package:famshield_mobile/services/family_api.dart';
import 'package:flutter_test/flutter_test.dart';

class _MemoryStore implements SessionStore {
  @override
  Future<String?> readAccessToken() async => 'test-access-token';

  @override
  Future<String?> readRefreshToken() async => 'test-refresh-token';

  @override
  Future<void> writeTokens({
    required String accessToken,
    required String refreshToken,
  }) async {}

  @override
  Future<void> clear() async {}
}

class _RecordingAdapter implements HttpClientAdapter {
  final requests = <RequestOptions>[];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests.add(options);
    final path = options.uri.path;
    final body = switch (path) {
      '/api/families' when options.method == 'GET' => {
        'families': [_family],
      },
      '/api/families' when options.method == 'POST' => {'family': _family},
      '/api/families/family-id' => {'family': _family},
      '/api/families/family-id/members' => {
        'members': [_member],
      },
      '/api/families/family-id/invitations' when options.method == 'GET' => {
        'invitations': [_invitation],
      },
      '/api/families/family-id/invitations' when options.method == 'POST' => {
        'invitation': _invitation,
        'token': 'one-time-test-token-12345678901234567890',
      },
      '/api/invitations' => {
        'invitations': [_myInvitation],
      },
      '/api/invitations/accept' => {'family': _family},
      _ => {'message': 'Completed.'},
    };
    return ResponseBody.fromString(
      jsonEncode({'data': body}),
      200,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

const _family = {
  'id': 'family-id',
  'name': 'Northstar',
  'createdBy': 'owner-id',
  'createdAt': '2026-03-01T00:00:00.000Z',
  'updatedAt': '2026-03-01T00:00:00.000Z',
  'role': 'owner',
};

const _member = {
  'familyId': 'family-id',
  'userId': 'owner-id',
  'fullName': 'Avery Example',
  'role': 'owner',
  'status': 'active',
  'joinedAt': '2026-03-01T00:00:00.000Z',
};

const _invitation = {
  'id': 'invitation-id',
  'familyId': 'family-id',
  'inviteeEmail': 'member@example.test',
  'status': 'pending',
  'expiresAt': '2026-03-08T00:00:00.000Z',
};

const _myInvitation = {
  'id': 'invitation-id',
  'family': {'id': 'family-id', 'name': 'Northstar'},
  'inviterName': 'Avery Example',
  'expiresAt': '2026-03-08T00:00:00.000Z',
};

void main() {
  test(
    'family API uses authenticated paths and parses family contracts',
    () async {
      final adapter = _RecordingAdapter();
      final dio = Dio(BaseOptions(baseUrl: 'https://famshield.test/api/'));
      dio.httpClientAdapter = adapter;
      final authApi = AuthApi(dio: dio, sessionStore: _MemoryStore());
      final familyApi = FamilyApi(authApi);

      final families = await familyApi.getFamilies();
      final created = await familyApi.createFamily('Northstar');
      final family = await familyApi.getFamily('family-id');
      final members = await familyApi.getFamilyMembers('family-id');
      final invitations = await familyApi.getFamilyInvitations('family-id');
      final myInvitations = await familyApi.getMyInvitations();

      expect(families.single.name, 'Northstar');
      expect(created.role, 'owner');
      expect(family.id, 'family-id');
      expect(members.single.fullName, 'Avery Example');
      expect(invitations.single.inviteeEmail, 'member@example.test');
      expect(myInvitations.single.familyName, 'Northstar');
      expect(adapter.requests.map((request) => request.uri.path), [
        '/api/families',
        '/api/families',
        '/api/families/family-id',
        '/api/families/family-id/members',
        '/api/families/family-id/invitations',
        '/api/invitations',
      ]);
      expect(
        adapter.requests.every(
          (request) =>
              request.headers['Authorization'] == 'Bearer test-access-token',
        ),
        isTrue,
      );
    },
  );

  test('invitation and membership actions use the existing routes and body contracts', () async {
    final adapter = _RecordingAdapter();
    final dio = Dio(BaseOptions(baseUrl: 'https://famshield.test/api/'));
    dio.httpClientAdapter = adapter;
    final familyApi = FamilyApi(
      AuthApi(dio: dio, sessionStore: _MemoryStore()),
    );

    final invitation = await familyApi.createInvitation(
      'family-id',
      email: 'member@example.test',
    );
    await familyApi.acceptInvitation(invitation.token);
    await familyApi.declineInvitation(invitation.token);
    await familyApi.revokeInvitation('family-id', 'invitation-id');
    await familyApi.removeMember('family-id', 'member-id');
    await familyApi.leaveFamily('family-id');
    await familyApi.transferOwnership('family-id', 'member-id');

    expect(invitation.token, startsWith('one-time-test-token'));
    expect(adapter.requests.map((request) => request.uri.path), [
      '/api/families/family-id/invitations',
      '/api/invitations/accept',
      '/api/invitations/decline',
      '/api/families/family-id/invitations/invitation-id',
      '/api/families/family-id/members/member-id',
      '/api/families/family-id/leave',
      '/api/families/family-id/transfer-ownership',
    ]);
    expect(adapter.requests[0].data, {'email': 'member@example.test'});
    expect(adapter.requests[1].data, {'token': invitation.token});
    expect(adapter.requests[1].uri.queryParameters, isEmpty);
    expect(adapter.requests[6].data, {'targetUserId': 'member-id'});
  });

  test('family models keep invitation details separate from memberships', () {
    final member = FamilyMember.fromJson(_member);
    final invite = FamilyInvitation.fromJson(_myInvitation);

    expect(member.userId, 'owner-id');
    expect(invite.familyName, 'Northstar');
    expect(invite.inviteeEmail, isNull);
  });
}
