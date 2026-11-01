import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../core/app_error.dart';
import '../models/auth_user.dart';

class AuthApi {
  AuthApi({Dio? dio, FlutterSecureStorage? secureStorage})
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
      _secureStorage = secureStorage ?? const FlutterSecureStorage() {
    _refreshDio = Dio(_dio.options);
    _dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          final accessToken = await _secureStorage.read(key: _accessTokenKey);
          if (accessToken != null) {
            options.headers['Authorization'] = 'Bearer $accessToken';
          }
          handler.next(options);
        },
        onError: (error, handler) async {
          final request = error.requestOptions;
          final isAuthCall = request.path.contains('auth/');
          if (error.response?.statusCode != 401 ||
              isAuthCall ||
              request.extra['famshieldRetried'] == true) {
            handler.next(error);
            return;
          }

          try {
            await _refreshSession();
            final accessToken = await _secureStorage.read(key: _accessTokenKey);
            request
              ..extra['famshieldRetried'] = true
              ..headers['Authorization'] = 'Bearer $accessToken';
            handler.resolve(await _dio.fetch<dynamic>(request));
          } catch (_) {
            await _clearTokens();
            handler.next(error);
          }
        },
      ),
    );
  }

  static const _accessTokenKey = 'famshield.access-token';
  static const _refreshTokenKey = 'famshield.refresh-token';

  final Dio _dio;
  final FlutterSecureStorage _secureStorage;
  late final Dio _refreshDio;
  Future<void>? _refreshInProgress;

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

  Future<AuthUser> currentUser() async {
    final response = await _request(
      () => _dio.get<Map<String, dynamic>>('users/me'),
    );
    return AuthUser.fromJson(_data(response)['user'] as Map<String, dynamic>);
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
    final refreshToken = await _secureStorage.read(key: _refreshTokenKey);
    try {
      await _request(
        () => _dio.post<dynamic>(
          'auth/logout',
          data: {'refreshToken': refreshToken},
        ),
      );
    } finally {
      await _clearTokens();
    }
  }

  Future<void> logoutAll() async {
    try {
      await _request(() => _dio.post<dynamic>('auth/logout-all'));
    } finally {
      await _clearTokens();
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
    final body = response.data;
    final data = body?['data'];
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
    await _secureStorage.write(key: _accessTokenKey, value: accessToken);
    await _secureStorage.write(key: _refreshTokenKey, value: refreshToken);
  }

  Future<void> _refreshSession() async {
    final inProgress = _refreshInProgress;
    if (inProgress != null) {
      return inProgress;
    }
    final refresh = _performRefresh();
    _refreshInProgress = refresh;
    try {
      await refresh;
    } finally {
      _refreshInProgress = null;
    }
  }

  Future<void> _performRefresh() async {
    final refreshToken = await _secureStorage.read(key: _refreshTokenKey);
    if (refreshToken == null) {
      throw const AppError('Your session has expired. Please sign in again.');
    }
    try {
      final response = await _refreshDio.post<Map<String, dynamic>>(
        'auth/refresh',
        data: {'refreshToken': refreshToken},
      );
      final data = _data(response);
      await _storeTokens(data);
    } on DioException catch (error) {
      throw AppError(
        'Your session has expired. Please sign in again.',
        cause: error,
      );
    }
  }

  Future<void> _clearTokens() async {
    await _secureStorage.delete(key: _accessTokenKey);
    await _secureStorage.delete(key: _refreshTokenKey);
  }
}
