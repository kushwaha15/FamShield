// This is a basic Flutter widget test.
//
// To perform an interaction with a widget in your test, use the WidgetTester
// utility in the flutter_test package. For example, you can send tap and scroll
// gestures. You can also use WidgetTester to find child widgets in the widget
// tree, read text, and verify that the values of widget properties are correct.

import 'package:flutter_test/flutter_test.dart';

import 'package:famshield_mobile/main.dart';

void main() {
  testWidgets('welcome explains consent without requesting location', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(const FamShieldApp());

    expect(find.text('Stay close.\nFeel secure.'), findsOneWidget);
    expect(find.text('Your privacy is part of your safety'), findsOneWidget);
    expect(
      find.textContaining('does not request location permission.'),
      findsOneWidget,
    );
  });

  testWidgets('welcome navigates to account sign-in and registration', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(const FamShieldApp());
    await tester.ensureVisible(find.text('Sign in or create an account'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Sign in or create an account'));
    await tester.pumpAndSettle();

    expect(find.text('Sign in'), findsWidgets);
    await tester.ensureVisible(find.text('Create a FamShield account'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Create a FamShield account'));
    await tester.pumpAndSettle();
    expect(find.text('Create your account'), findsOneWidget);
    expect(find.text('I accept the Terms of Service.'), findsOneWidget);
    expect(find.text('I acknowledge the Privacy Policy.'), findsOneWidget);
  });
}
