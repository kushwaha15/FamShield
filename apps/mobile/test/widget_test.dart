// This is a basic Flutter widget test.
//
// To perform an interaction with a widget in your test, use the WidgetTester
// utility in the flutter_test package. For example, you can send tap and scroll
// gestures. You can also use WidgetTester to find child widgets in the widget
// tree, read text, and verify that the values of widget properties are correct.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:famshield_mobile/core/app_router.dart';
import 'package:famshield_mobile/core/app_error.dart';
import 'package:famshield_mobile/features/auth/auth_state.dart';
import 'package:famshield_mobile/main.dart';

import 'helpers/fakes.dart';

Future<void> _pumpApp(WidgetTester tester, {FakeAuthApi? api}) {
  return tester.pumpWidget(
    ProviderScope(
      overrides: [authApiProvider.overrideWithValue(api ?? FakeAuthApi())],
      child: const FamShieldApp(),
    ),
  );
}

void main() {
  testWidgets('a failed saved-session check shows a recoverable login error', (
    WidgetTester tester,
  ) async {
    final api = FakeAuthApi(
      restoreError: const AppError('Network unavailable.'),
    );
    await _pumpApp(tester, api: api);
    await tester.pumpAndSettle();

    expect(find.text('Welcome back'), findsOneWidget);
    expect(find.text('Network unavailable.'), findsOneWidget);
    expect(find.text('Retry session check'), findsOneWidget);
  });

  testWidgets('unauthenticated users cannot open the dashboard route', (
    WidgetTester tester,
  ) async {
    await _pumpApp(tester);
    await tester.pumpAndSettle();
    final context = tester.element(find.byType(FamShieldApp));
    ProviderScope.containerOf(context).read(appRouterProvider).go('/dashboard');
    await tester.pumpAndSettle();
    expect(find.text('Welcome back'), findsOneWidget);
    expect(find.text('Account information'), findsNothing);
  });

  testWidgets('registration sends the API contract and opens verification', (
    WidgetTester tester,
  ) async {
    final api = FakeAuthApi();
    await _pumpApp(tester, api: api);
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Sign in or create an account'));
    await tester.tap(find.text('Sign in or create an account'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Create a FamShield account'));
    await tester.tap(find.text('Create a FamShield account'));
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextFormField).at(0), 'Avery Example');
    await tester.enterText(
      find.byType(TextFormField).at(1),
      'avery@example.test',
    );
    await tester.enterText(find.byType(TextFormField).at(2), '+14155550123');
    await tester.enterText(find.byType(TextFormField).at(3), 'StrongPass!234');
    await tester.enterText(find.byType(TextFormField).at(4), 'StrongPass!234');
    await tester.ensureVisible(find.text('I accept the Terms of Service.'));
    await tester.tap(find.text('I accept the Terms of Service.'));
    await tester.ensureVisible(find.text('I acknowledge the Privacy Policy.'));
    await tester.tap(find.text('I acknowledge the Privacy Policy.'));
    await tester.ensureVisible(find.text('Create account'));
    await tester.tap(find.text('Create account'));
    await tester.pumpAndSettle();

    expect(api.registeredEmail, 'avery@example.test');
    expect(api.registeredPhone, '+14155550123');
    expect(find.text('Verify your contacts'), findsOneWidget);
  });

  testWidgets('login authenticates and logout returns to sign in', (
    WidgetTester tester,
  ) async {
    final api = FakeAuthApi();
    await _pumpApp(tester, api: api);
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Sign in or create an account'));
    await tester.tap(find.text('Sign in or create an account'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('login-identifier')),
      'avery@example.test',
    );
    await tester.enterText(
      find.byKey(const ValueKey('login-password')),
      'StrongPass!234',
    );
    await tester.tap(find.text('Sign in'));
    await tester.pumpAndSettle();

    expect(find.text('Welcome, Avery Example'), findsOneWidget);
    await tester.ensureVisible(find.text('Sign out'));
    await tester.tap(find.text('Sign out'));
    await tester.pumpAndSettle();
    expect(find.text('Welcome back'), findsOneWidget);
    expect(api.logoutCalls, 1);
  });

  testWidgets('verification submits email and phone codes to the API', (
    WidgetTester tester,
  ) async {
    final api = FakeAuthApi();
    await _pumpApp(tester, api: api);
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Sign in or create an account'));
    await tester.tap(find.text('Sign in or create an account'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Create a FamShield account'));
    await tester.tap(find.text('Create a FamShield account'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextFormField).at(0), 'Avery Example');
    await tester.enterText(
      find.byType(TextFormField).at(1),
      'avery@example.test',
    );
    await tester.enterText(find.byType(TextFormField).at(2), '+14155550123');
    await tester.enterText(find.byType(TextFormField).at(3), 'StrongPass!234');
    await tester.enterText(find.byType(TextFormField).at(4), 'StrongPass!234');
    await tester.ensureVisible(find.text('I accept the Terms of Service.'));
    await tester.tap(find.text('I accept the Terms of Service.'));
    await tester.ensureVisible(find.text('I acknowledge the Privacy Policy.'));
    await tester.tap(find.text('I acknowledge the Privacy Policy.'));
    await tester.ensureVisible(find.text('Create account'));
    await tester.tap(find.text('Create account'));
    await tester.pumpAndSettle();

    await tester.pump(const Duration(seconds: 30));
    await tester.tap(find.text('Resend code').first);
    await tester.pumpAndSettle();
    expect(api.resendCalls, 1);
    expect(find.text('Resend available in 30s'), findsNWidgets(2));

    await tester.enterText(find.byType(TextFormField).at(0), '123456');
    await tester.tap(find.text('Verify').first);
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextFormField).at(0), '654321');
    await tester.tap(find.text('Verify').first);
    await tester.pumpAndSettle();

    expect(api.verifyEmailCalls, 1);
    expect(api.verifyPhoneCalls, 1);
    expect(find.text('Continue to sign in'), findsOneWidget);
  });

  testWidgets('welcome explains consent without requesting location', (
    WidgetTester tester,
  ) async {
    await _pumpApp(tester);
    await tester.pumpAndSettle();

    expect(find.text('Stay close.\nFeel secure.'), findsOneWidget);
    expect(find.text('Your privacy is part of your safety'), findsOneWidget);
    expect(
      find.textContaining('does not request location permission.'),
      findsOneWidget,
    );
  });

  testWidgets('welcome navigates to sign-in and registration', (
    WidgetTester tester,
  ) async {
    await _pumpApp(tester);
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Sign in or create an account'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Sign in or create an account'));
    await tester.pumpAndSettle();

    expect(find.text('Welcome back'), findsOneWidget);
    await tester.tap(find.text('Create a FamShield account'));
    await tester.pumpAndSettle();
    expect(find.text('Create your account'), findsOneWidget);
    expect(find.text('I accept the Terms of Service.'), findsOneWidget);
    expect(find.text('I acknowledge the Privacy Policy.'), findsOneWidget);
  });
}
