import 'package:dio/dio.dart';

import '../core/app_error.dart';
import '../core/session_store.dart';
import '../models/auth_session.dart';
import '../models/auth_user.dart';

class AuthApi {
  AuthApi({Dio? dio, SessionStore? sessionStore, this.onSessionExpired})
    : _dio =
          dio ??
          Dio(
            BaseOptions(
              baseUrl: const String.fromEnvironment(
                'FAMSHIELD_API_URL',
                defaultValue: 'http://10.0.2.2:3000/api/',
              ),
              connectTimeout: const Duration(seconds: 8),
              receiveTimeout: const Duration(seconds: 8),
              headers: const {'Accept': 'application/json'},
            ),
          ),
      _sessionStore = sessionStore ?? SecureSessionStore() {
    _refreshDio = Dio(_dio.options)..httpClientAdapter = _dio.httpClientAdapter;
    _dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          final accessToken = await _sessionStore.readAccessToken();
          if (accessToken != null) {
            options.headers['Authorization'] = 'Bearer $accessToken';
          }
          handler.next(options);
        },
        onError: (error, handler) async {
          final request = error.requestOptions;
          final isAuthCall = _isPublicAuthCall(request.uri.path);
          if (error.response?.statusCode != 401 ||
              isAuthCall ||
              request.extra['famshieldRetried'] == true) {
            handler.next(error);
            return;
          }

          try {
            await _refreshSession();
            final accessToken = await _sessionStore.readAccessToken();
            if (accessToken == null) {
              throw const AppError(
                'Your session has expired. Please sign in again.',
              );
            }
            request
              ..extra['famshieldRetried'] = true
              ..headers['Authorization'] = 'Bearer $accessToken';
            handler.resolve(await _dio.fetch<dynamic>(request));
          } catch (refreshError) {
            if (_isUnauthorizedRefresh(refreshError)) {
              await _sessionStore.clear();
              onSessionExpired?.call();
            }
            handler.next(error);
          }
        },
      ),
    );
  }

  final Dio _dio;
  final SessionStore _sessionStore;
  final void Function()? onSessionExpired;
  late final Dio _refreshDio;
  Future<void>? _refreshInProgress;

  Uri get apiBaseUri => Uri.parse(_dio.options.baseUrl);

  Future<String?> readAccessToken() => _sessionStore.readAccessToken();

  Future<Map<String, dynamic>> register({
    required String fullName,
    required String email,
    required String phone,
    required String password,
    required String passwordConfirmation,
    required bool acceptTerms,
    required bool acceptPrivacy,
  }) async {
    final response = await _request(
      () => _dio.post<Map<String, dynamic>>(
        'auth/register',
        data: {
          'fullName': fullName,
          'email': email,
          'phone': phone,
          'password': password,
          'passwordConfirmation': passwordConfirmation,
          'acceptTerms': acceptTerms,
          'acceptPrivacy': acceptPrivacy,
        },
      ),
    );
    return _data(response);
  }

  Future<void> verifyEmail(String email, String code) async {
    await _request(
      () => _dio.post<dynamic>(
        'auth/verify-email',
        data: {'email': email, 'code': code},
      ),
    );
  }

  Future<void> verifyPhone(String phone, String code) async {
    await _request(
      () => _dio.post<dynamic>(
        'auth/verify-phone',
        data: {'phone': phone, 'code': code},
      ),
    );
  }

  Future<Map<String, dynamic>> resendOtp({
    required String identifier,
    required String purpose,
  }) async {
    final response = await _request(
      () => _dio.post<Map<String, dynamic>>(
        'auth/resend-otp',
        data: {'identifier': identifier, 'purpose': purpose},
      ),
    );
    return _data(response);
  }

  Future<AuthUser> login(String identifier, String password) async {
    final response = await _request(
      () => _dio.post<Map<String, dynamic>>(
        'auth/login',
        data: {
          'identifier': identifier,
          'password': password,
          'clientType': 'mobile',
          'deviceInfo': 'FamShield mobile',
        },
      ),
    );
    final data = _data(response);
    await _storeTokens(data);
    return AuthUser.fromJson(data['user'] as Map<String, dynamic>);
  }

  Future<AuthUser?> restoreSession() async {
    final accessToken = await _sessionStore.readAccessToken();
    final refreshToken = await _sessionStore.readRefreshToken();
    if (accessToken == null && refreshToken == null) return null;

    if (accessToken == null) {
      try {
        await _refreshSession();
      } on AppError catch (error) {
        if (_isUnauthorizedRefresh(error)) {
          await _sessionStore.clear();
        }
        if (await _sessionStore.readAccessToken() == null &&
            await _sessionStore.readRefreshToken() == null) {
          return null;
        }
        rethrow;
      }
    }

    try {
      return await currentUser();
    } on AppError {
      if (await _sessionStore.readAccessToken() == null &&
          await _sessionStore.readRefreshToken() == null) {
        return null;
      }
      rethrow;
    }
  }

  Future<AuthUser> currentUser() async {
    final response = await _request(
      () => _dio.get<Map<String, dynamic>>('users/me'),
    );
    return AuthUser.fromJson(_data(response)['user'] as Map<String, dynamic>);
  }

  Future<Map<String, dynamic>> getFamilyResource(String path) async {
    final response = await _request(() => _dio.get<Map<String, dynamic>>(path));
    return _data(response);
  }

  Future<Map<String, dynamic>> postFamilyResource(
    String path, {
    Map<String, dynamic> body = const {},
  }) async {
    final response = await _request(
      () => _dio.post<Map<String, dynamic>>(path, data: body),
    );
    return _data(response);
  }

  Future<Map<String, dynamic>> putFamilyResource(
    String path, {
    required Map<String, dynamic> body,
  }) async {
    final response = await _request(
      () => _dio.put<Map<String, dynamic>>(path, data: body),
    );
    return _data(response);
  }

  Future<void> deleteFamilyResource(String path) async {
    await _request(() => _dio.delete<dynamic>(path));
  }

  Future<AuthUser> updateProfile({
    required String fullName,
    String? profileImageUrl,
    bool removeProfileImage = false,
  }) async {
    final response = await _request(
      () => _dio.patch<Map<String, dynamic>>(
        'users/me',
        data: {
          'fullName': fullName,
          if (removeProfileImage) 'profileImageUrl': null,
          if (!removeProfileImage && profileImageUrl != null)
            'profileImageUrl': profileImageUrl,
        },
      ),
    );
    return AuthUser.fromJson(_data(response)['user'] as Map<String, dynamic>);
  }

  Future<List<AuthSession>> activeSessions() async {
    final response = await _request(
      () => _dio.get<Map<String, dynamic>>('auth/sessions'),
    );
    final sessions = _data(response)['sessions'];
    if (sessions is! List<dynamic>) {
      throw const AppError('The server returned an invalid session list.');
    }
    return sessions
        .map((session) => AuthSession.fromJson(session as Map<String, dynamic>))
        .toList();
  }

  Future<void> revokeSession(String sessionId) async {
    await _request(() => _dio.delete<dynamic>('auth/sessions/$sessionId'));
  }

  Future<void> forgotPassword({
    required String identifier,
    required String channel,
  }) async {
    await _request(
      () => _dio.post<dynamic>(
        'auth/forgot-password',
        data: {'identifier': identifier, 'channel': channel},
      ),
    );
  }

  Future<void> resetPassword({
    required String identifier,
    required String code,
    required String password,
    required String passwordConfirmation,
  }) async {
    await _request(
      () => _dio.post<dynamic>(
        'auth/reset-password',
        data: {
          'identifier': identifier,
          'code': code,
          'password': password,
          'passwordConfirmation': passwordConfirmation,
        },
      ),
    );
  }

  Future<void> logout() async {
    final refreshToken = await _sessionStore.readRefreshToken();
    try {
      if (refreshToken != null) {
        await _request(
          () => _dio.post<dynamic>(
            'auth/logout',
            data: {'refreshToken': refreshToken},
          ),
        );
      }
    } finally {
      await _sessionStore.clear();
    }
  }

  Future<void> logoutAll() async {
    try {
      await _request(() => _dio.post<dynamic>('auth/logout-all'));
    } finally {
      await _sessionStore.clear();
    }
  }

  Future<Response<T>> _request<T>(
    Future<Response<T>> Function() request,
  ) async {
    try {
      return await request();
    } on DioException catch (error) {
      final body = error.response?.data;
      final message =
          body is Map<String, dynamic> &&
              body['error'] is Map<String, dynamic> &&
              (body['error'] as Map<String, dynamic>)['message'] is String
          ? (body['error'] as Map<String, dynamic>)['message'] as String
          : 'Unable to reach FamShield. Check your connection and try again.';
      throw AppError(message, cause: error);
    }
  }

  Map<String, dynamic> _data(Response<Map<String, dynamic>> response) {
    final data = response.data?['data'];
    if (data is! Map<String, dynamic>) {
      throw const AppError('The server returned an invalid response.');
    }
    return data;
  }

  Future<void> _storeTokens(Map<String, dynamic> data) async {
    final accessToken = data['accessToken'];
    final refreshToken = data['refreshToken'];
    if (accessToken is! String || refreshToken is! String) {
      throw const AppError('The server did not return a valid session.');
    }
    await _sessionStore.writeTokens(
      accessToken: accessToken,
      refreshToken: refreshToken,
    );
  }

  Future<void> _refreshSession() async {
    final inProgress = _refreshInProgress;
    if (inProgress != null) return inProgress;

    final refresh = _performRefresh();
    _refreshInProgress = refresh;
    try {
      await refresh;
    } finally {
      _refreshInProgress = null;
    }
  }

  Future<void> _performRefresh() async {
    final refreshToken = await _sessionStore.readRefreshToken();
    if (refreshToken == null) {
      throw const AppError('Your session has expired. Please sign in again.');
    }
    try {
      final response = await _refreshDio.post<Map<String, dynamic>>(
        'auth/refresh',
        data: {'refreshToken': refreshToken},
      );
      await _storeTokens(_data(response));
    } on DioException catch (error) {
      throw AppError(
        'Your session has expired. Please sign in again.',
        cause: error,
      );
    }
  }
}

bool _isUnauthorizedRefresh(Object error) {
  if (error is! AppError) return false;
  final cause = error.cause;
  return cause is DioException && cause.response?.statusCode == 401;
}

bool _isPublicAuthCall(String path) {
  const endpoints = [
    'auth/login',
    'auth/register',
    'auth/verify-email',
    'auth/verify-phone',
    'auth/resend-otp',
    'auth/refresh',
    'auth/logout',
    'auth/forgot-password',
    'auth/reset-password',
  ];
  return endpoints.any(path.endsWith);
}
