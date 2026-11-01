import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:famshield_mobile/core/app_error.dart';
import 'package:famshield_mobile/core/session_store.dart';
import 'package:famshield_mobile/services/auth_api.dart';

class _HandlerAdapter implements HttpClientAdapter {
  _HandlerAdapter(this.handle);

  final Future<ResponseBody> Function(RequestOptions options) handle;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) {
    return handle(options);
  }

  @override
  void close({bool force = false}) {}
}

class _MemoryStore implements SessionStore {
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

ResponseBody _jsonResponse(Object body, {int status = 200}) =>
    ResponseBody.fromString(
      jsonEncode(body),
      status,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );

Map<String, dynamic> get _user => {
  'id': 'user-id',
  'fullName': 'Avery Example',
  'email': 'avery@example.test',
  'phone': '+14155550123',
  'emailVerified': true,
  'phoneVerified': true,
  'status': 'active',
};

void main() {
  test(
    'registration, OTP, and password reset use the existing API contracts',
    () async {
      final requests = <RequestOptions>[];
      final dio = Dio(BaseOptions(baseUrl: 'https://famshield.test/api/'));
      dio.httpClientAdapter = _HandlerAdapter((options) async {
        requests.add(options);
        return _jsonResponse({
          'data': {'message': 'If eligible, instructions have been sent.'},
        });
      });
      final api = AuthApi(dio: dio, sessionStore: _MemoryStore());

      await api.register(
        fullName: 'Avery Example',
        email: 'avery@example.test',
        phone: '+14155550123',
        password: 'StrongPass!234',
        passwordConfirmation: 'StrongPass!234',
        acceptTerms: true,
        acceptPrivacy: true,
      );
      await api.verifyEmail('avery@example.test', '123456');
      await api.verifyPhone('+14155550123', '654321');
      await api.resendOtp(
        identifier: 'avery@example.test',
        purpose: 'verify_email',
      );
      await api.forgotPassword(
        identifier: 'avery@example.test',
        channel: 'email',
      );
      await api.resetPassword(
        identifier: 'avery@example.test',
        code: '123456',
        password: 'NewStrongPass!234',
        passwordConfirmation: 'NewStrongPass!234',
      );

      expect(
        requests.map((request) => request.uri.path.split('/').last).toList(),
        [
          'register',
          'verify-email',
          'verify-phone',
          'resend-otp',
          'forgot-password',
          'reset-password',
        ],
      );
      expect(requests.first.data, {
        'fullName': 'Avery Example',
        'email': 'avery@example.test',
        'phone': '+14155550123',
        'password': 'StrongPass!234',
        'passwordConfirmation': 'StrongPass!234',
        'acceptTerms': true,
        'acceptPrivacy': true,
      });
      expect(requests[1].data, {
        'email': 'avery@example.test',
        'code': '123456',
      });
      expect(requests[2].data, {'phone': '+14155550123', 'code': '654321'});
      expect(requests[3].data, {
        'identifier': 'avery@example.test',
        'purpose': 'verify_email',
      });
      expect(requests[4].data, {
        'identifier': 'avery@example.test',
        'channel': 'email',
      });
      expect(requests[5].data, {
        'identifier': 'avery@example.test',
        'code': '123456',
        'password': 'NewStrongPass!234',
        'passwordConfirmation': 'NewStrongPass!234',
      });
    },
  );

  test('login sends the mobile contract and stores tokens securely', () async {
    final store = _MemoryStore();
    RequestOptions? loginRequest;
    final dio = Dio(BaseOptions(baseUrl: 'https://famshield.test/api/'));
    dio.httpClientAdapter = _HandlerAdapter((options) async {
      loginRequest = options;
      return _jsonResponse({
        'data': {
          'user': _user,
          'accessToken': 'access-token-value',
          'refreshToken': 'refresh-token-value',
          'sessionId': 'session-id',
        },
      });
    });
    final api = AuthApi(dio: dio, sessionStore: store);

    final user = await api.login('avery@example.test', 'StrongPass!234');

    expect(user.email, 'avery@example.test');
    expect(loginRequest!.data, {
      'identifier': 'avery@example.test',
      'password': 'StrongPass!234',
      'clientType': 'mobile',
      'deviceInfo': 'FamShield mobile',
    });
    expect(store.accessToken, 'access-token-value');
    expect(store.refreshToken, 'refresh-token-value');
  });

  test(
    '401 refresh rotates tokens and retries profile with the new bearer token',
    () async {
      final store = _MemoryStore()
        ..accessToken = 'expired-access'
        ..refreshToken = 'valid-refresh-token';
      final authorizations = <String?>[];
      var refreshCalls = 0;
      final dio = Dio(BaseOptions(baseUrl: 'https://famshield.test/api/'));
      dio.httpClientAdapter = _HandlerAdapter((options) async {
        if (options.uri.path.endsWith('/auth/refresh')) {
          refreshCalls++;
          expect(options.data, {'refreshToken': 'valid-refresh-token'});
          return _jsonResponse({
            'data': {
              'user': _user,
              'accessToken': 'fresh-access',
              'refreshToken': 'rotated-refresh',
              'sessionId': 'session-id',
            },
          });
        }
        authorizations.add(options.headers['Authorization'] as String?);
        if (options.headers['Authorization'] == 'Bearer expired-access') {
          return _jsonResponse({
            'error': {'message': 'Unauthorized'},
          }, status: 401);
        }
        return _jsonResponse({
          'data': {'user': _user},
        });
      });
      final api = AuthApi(dio: dio, sessionStore: store);

      dynamic user;
      try {
        user = await api.currentUser();
      } catch (_) {
        expect(
          refreshCalls,
          1,
          reason: 'the configured refresh endpoint must run',
        );
        expect(authorizations, [
          'Bearer expired-access',
          'Bearer fresh-access',
        ], reason: 'the retried request must carry the rotated access token');
        rethrow;
      }

      expect(user.id, 'user-id');
      expect(refreshCalls, 1);
      expect(authorizations, ['Bearer expired-access', 'Bearer fresh-access']);
      expect(store.accessToken, 'fresh-access');
      expect(store.refreshToken, 'rotated-refresh');
    },
  );

  test(
    'expired refresh credentials are cleared and restore as signed out',
    () async {
      final store = _MemoryStore()
        ..accessToken = 'expired-access'
        ..refreshToken = 'expired-refresh';
      final dio = Dio(BaseOptions(baseUrl: 'https://famshield.test/api/'));
      dio.httpClientAdapter = _HandlerAdapter((options) async {
        if (options.uri.path.endsWith('/auth/refresh')) {
          return _jsonResponse({
            'error': {'message': 'Session expired'},
          }, status: 401);
        }
        return _jsonResponse({
          'error': {'message': 'Unauthorized'},
        }, status: 401);
      });
      final api = AuthApi(dio: dio, sessionStore: store);

      expect(await api.restoreSession(), isNull);
      expect(store.accessToken, isNull);
      expect(store.refreshToken, isNull);
    },
  );

  test(
    'an expired refresh session clears credentials and notifies shared state',
    () async {
      final store = _MemoryStore()
        ..accessToken = 'expired-access'
        ..refreshToken = 'expired-refresh';
      var sessionExpiredCalls = 0;
      final dio = Dio(BaseOptions(baseUrl: 'https://famshield.test/api/'));
      dio.httpClientAdapter = _HandlerAdapter((options) async {
        return _jsonResponse({
          'error': {'message': 'Unauthorized'},
        }, status: 401);
      });
      final api = AuthApi(
        dio: dio,
        sessionStore: store,
        onSessionExpired: () => sessionExpiredCalls++,
      );

      await expectLater(api.currentUser(), throwsA(isA<AppError>()));
      expect(store.accessToken, isNull);
      expect(store.refreshToken, isNull);
      expect(sessionExpiredCalls, 1);
    },
  );

  test('API errors are surfaced without dumping request credentials', () async {
    final dio = Dio(BaseOptions(baseUrl: 'https://famshield.test/api/'));
    dio.httpClientAdapter = _HandlerAdapter((_) async {
      return _jsonResponse({
        'error': {'message': 'Invalid credentials.'},
      }, status: 401);
    });
    final api = AuthApi(dio: dio, sessionStore: _MemoryStore());

    await expectLater(
      api.login('avery@example.test', 'not-a-real-password'),
      throwsA(
        isA<AppError>().having(
          (error) => error.message,
          'message',
          'Invalid credentials.',
        ),
      ),
    );
  });
}
