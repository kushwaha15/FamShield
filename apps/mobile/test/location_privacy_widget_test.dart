import 'dart:async';

import 'package:famshield_mobile/features/privacy/privacy_providers.dart';
import 'package:famshield_mobile/features/privacy/screens/location_privacy_screen.dart';
import 'package:famshield_mobile/models/location_consent.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('shows a loading state while consent status is fetched', (
    tester,
  ) async {
    final pendingConsent = Completer<LocationConsentState>();
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          locationConsentProvider.overrideWith((ref) => pendingConsent.future),
          locationConsentHistoryProvider.overrideWith((ref) async => const []),
        ],
        child: const MaterialApp(home: LocationPrivacyScreen()),
      ),
    );
    await tester.pump();

    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    pendingConsent.complete(
      const LocationConsentState(
        policyVersion: 'location-sharing-v1',
        scopes: [],
      ),
    );
    await tester.pumpAndSettle();
  });

  testWidgets('shows an explicit unchecked consent action for a family', (
    tester,
  ) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          locationConsentProvider.overrideWith(
            (ref) async => const LocationConsentState(
              policyVersion: 'location-sharing-v1',
              scopes: [
                LocationConsentScope(
                  familyId: 'family-id',
                  familyName: 'Northstar',
                  enabled: false,
                ),
              ],
            ),
          ),
          locationConsentHistoryProvider.overrideWith((ref) async => const []),
        ],
        child: const MaterialApp(home: LocationPrivacyScreen()),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Northstar'), findsWidgets);
    expect(
      find.textContaining('GPS permission is requested only after you press Start Sharing.'),
      findsOneWidget,
    );
    expect(
      tester.widget<CheckboxListTile>(find.byType(CheckboxListTile)).value,
      isFalse,
    );
    expect(
      tester
          .widget<FilledButton>(
            find.widgetWithText(
              FilledButton,
              'Enable location-sharing consent',
            ),
          )
          .onPressed,
      isNull,
    );
  });

  testWidgets('shows empty-family and empty-history states', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          locationConsentProvider.overrideWith(
            (ref) async => const LocationConsentState(
              policyVersion: 'location-sharing-v1',
              scopes: [],
            ),
          ),
          locationConsentHistoryProvider.overrideWith((ref) async => const []),
        ],
        child: const MaterialApp(home: LocationPrivacyScreen()),
      ),
    );
    await tester.pumpAndSettle();

    expect(
      find.textContaining('No active family memberships.'),
      findsOneWidget,
    );
    expect(
      find.text('No location-sharing consent changes yet.'),
      findsOneWidget,
    );
  });

  testWidgets(
    'shows recoverable error and retry for unavailable consent status',
    (tester) async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            locationConsentProvider.overrideWith(
              (ref) async => throw Exception('network unavailable'),
            ),
            locationConsentHistoryProvider.overrideWith(
              (ref) async => const [],
            ),
          ],
          child: const MaterialApp(home: LocationPrivacyScreen()),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.textContaining('network unavailable'), findsOneWidget);
      expect(find.text('Try again'), findsOneWidget);
    },
  );
}
