import 'package:dio/dio.dart';
import 'package:famshield_mobile/core/session_store.dart';
import 'package:famshield_mobile/models/auth_session.dart';
import 'package:famshield_mobile/models/auth_user.dart';
import 'package:famshield_mobile/services/auth_api.dart';

class MemorySessionStore implements SessionStore {
  String? accessToken;
  String? refreshToken;

  @override
  Future<String?> readAccessToken() async => accessToken;

  @override
  Future<String?> readRefreshToken() async => refreshToken;

  @override
  Future<void> writeTokens({
    required String accessToken,
    required String refreshToken,
  }) async {
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
  }

  @override
  Future<void> clear() async {
    accessToken = null;
    refreshToken = null;
  }
}

const testUser = AuthUser(
  id: 'user-id',
  fullName: 'Avery Example',
  email: 'avery@example.test',
  phone: '+14155550123',
  emailVerified: true,
  phoneVerified: true,
  status: 'active',
  profileImageUrl: 'https://images.example.test/avery.png',
);

class FakeAuthApi extends AuthApi {
  FakeAuthApi({
    this.restoredUser,
    this.sessions = const [],
    this.loginError,
    this.restoreError,
  }) : super(
         dio: Dio(BaseOptions(baseUrl: 'https://famshield.test/api/')),
         sessionStore: MemorySessionStore(),
       );

  AuthUser? restoredUser;
  List<AuthSession> sessions;
  Object? loginError;
  Object? restoreError;
  String? registeredEmail;
  String? registeredPhone;
  int verifyEmailCalls = 0;
  int verifyPhoneCalls = 0;
  int resendCalls = 0;
  int logoutCalls = 0;
  int logoutAllCalls = 0;
  int revokeCalls = 0;
  String? lastResetIdentifier;

  @override
  Future<AuthUser?> restoreSession() async {
    if (restoreError case final error?) throw error;
    return restoredUser;
  }

  @override
  Future<AuthUser> login(String identifier, String password) async {
    if (loginError case final error?) throw error;
    return restoredUser = testUser;
  }

  @override
  Future<Map<String, dynamic>> register({
    required String fullName,
    required String email,
    required String phone,
    required String password,
    required String passwordConfirmation,
    required bool acceptTerms,
    required bool acceptPrivacy,
  }) async {
    registeredEmail = email;
    registeredPhone = phone;
    return {'message': 'If eligible, verification codes have been sent.'};
  }

  @override
  Future<void> verifyEmail(String email, String code) async {
    verifyEmailCalls++;
  }

  @override
  Future<void> verifyPhone(String phone, String code) async {
    verifyPhoneCalls++;
  }

  @override
  Future<Map<String, dynamic>> resendOtp({
    required String identifier,
    required String purpose,
  }) async {
    resendCalls++;
    return {'message': 'If eligible, a code has been sent.'};
  }

  @override
  Future<void> forgotPassword({
    required String identifier,
    required String channel,
  }) async {}

  @override
  Future<void> resetPassword({
    required String identifier,
    required String code,
    required String password,
    required String passwordConfirmation,
  }) async {
    lastResetIdentifier = identifier;
  }

  @override
  Future<AuthUser> updateProfile({
    required String fullName,
    String? profileImageUrl,
    bool removeProfileImage = false,
  }) async => testUser;

  @override
  Future<List<AuthSession>> activeSessions() async => sessions;

  @override
  Future<void> revokeSession(String sessionId) async {
    revokeCalls++;
  }

  @override
  Future<void> logout() async {
    logoutCalls++;
    restoredUser = null;
  }

  @override
  Future<void> logoutAll() async {
    logoutAllCalls++;
    restoredUser = null;
  }
}
