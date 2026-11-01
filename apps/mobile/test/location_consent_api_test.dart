import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:famshield_mobile/core/session_store.dart';
import 'package:famshield_mobile/services/auth_api.dart';
import 'package:famshield_mobile/services/location_consent_api.dart';
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
    final body = switch (options.uri.path) {
      '/api/consents/location-sharing' => {
        'policyVersion': 'location-sharing-v1',
        'scopes': [
          {
            'familyId': 'family-id',
            'familyName': 'Northstar',
            'enabled': false,
          },
        ],
      },
      '/api/consents/location-sharing/history' => {'history': []},
      _ => {'message': 'ok'},
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

void main() {
  test(
    'uses the consent API contracts and requires explicit confirmation',
    () async {
      final adapter = _RecordingAdapter();
      final dio = Dio(BaseOptions(baseUrl: 'https://famshield.test/api/'));
      dio.httpClientAdapter = adapter;
      final api = LocationConsentApi(
        AuthApi(dio: dio, sessionStore: _MemoryStore()),
      );

      final consent = await api.getConsent();
      final history = await api.getHistory();
      expect(consent.policyVersion, 'location-sharing-v1');
      expect(consent.scopes.single.familyName, 'Northstar');
      expect(consent.scopes.single.enabled, isFalse);
      expect(history, isEmpty);

      await expectLater(
        api.grant(
          familyId: 'family-id',
          policyVersion: consent.policyVersion,
          confirmed: false,
        ),
        throwsA(isA<Exception>()),
      );
      await api.grant(
        familyId: 'family-id',
        policyVersion: consent.policyVersion,
        confirmed: true,
      );
      await api.revoke('family-id');

      final grant = adapter.requests.singleWhere(
        (request) =>
            request.method == 'POST' &&
            request.uri.path == '/api/consents/location-sharing',
      );
      expect(grant.data, {
        'familyId': 'family-id',
        'policyVersion': 'location-sharing-v1',
        'confirmed': true,
      });
      expect(grant.headers['Authorization'], 'Bearer test-access-token');
      expect(
        adapter.requests.any(
          (request) =>
              request.method == 'DELETE' &&
              request.uri.path == '/api/consents/location-sharing/family-id',
        ),
        isTrue,
      );
    },
  );
}
