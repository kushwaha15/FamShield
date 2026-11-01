import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

import 'package:famshield_mobile/features/families/family_providers.dart';
import 'package:famshield_mobile/features/families/screens/family_detail_screen.dart';
import 'package:famshield_mobile/features/families/screens/family_list_screen.dart';
import 'package:famshield_mobile/models/family.dart';

const _family = FamilySummary(
  id: 'family-id',
  name: 'Northstar',
  createdBy: 'owner-id',
  createdAt: '2026-03-01T00:00:00.000Z',
  updatedAt: '2026-03-01T00:00:00.000Z',
  role: 'owner',
);

const _member = FamilyMember(
  familyId: 'family-id',
  userId: 'owner-id',
  fullName: 'Avery Example',
  role: 'owner',
  status: 'active',
  joinedAt: '2026-03-01T00:00:00.000Z',
);

Widget _listApp({
  required Future<List<FamilySummary>> Function(Ref ref) loadFamilies,
}) => ProviderScope(
  overrides: [
    familiesProvider.overrideWith(loadFamilies),
    myInvitationsProvider.overrideWith((ref) async => <FamilyInvitation>[]),
  ],
  child: const MaterialApp(home: FamilyListScreen()),
);

void main() {
  testWidgets('shows an empty state when the member has no families', (
    tester,
  ) async {
    await tester.pumpWidget(_listApp(loadFamilies: (ref) async => []));
    await tester.pumpAndSettle();

    expect(find.text('You have not joined a family yet.'), findsOneWidget);
    expect(find.text('Family groups'), findsOneWidget);
  });

  testWidgets('shows recoverable errors for a failed family list request', (
    tester,
  ) async {
    await tester.pumpWidget(
      _listApp(
        loadFamilies: (ref) async => throw Exception('Network unavailable.'),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.textContaining('Network unavailable.'), findsOneWidget);
    expect(find.text('Try again'), findsOneWidget);
  });

  testWidgets('shows loading state while family data is being fetched', (
    tester,
  ) async {
    final completer = Completer<List<FamilySummary>>();
    await tester.pumpWidget(_listApp(loadFamilies: (ref) => completer.future));
    await tester.pump();

    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    completer.complete([]);
    await tester.pumpAndSettle();
  });

  testWidgets('navigates from the family list to active member details', (
    tester,
  ) async {
    final router = GoRouter(
      initialLocation: '/families',
      routes: [
        GoRoute(
          path: '/families',
          builder: (context, state) => const FamilyListScreen(),
        ),
        GoRoute(
          path: '/families/:familyId',
          builder: (context, state) =>
              FamilyDetailScreen(familyId: state.pathParameters['familyId']!),
        ),
      ],
    );
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          familiesProvider.overrideWith((ref) async => [_family]),
          myInvitationsProvider.overrideWith(
            (ref) async => <FamilyInvitation>[],
          ),
          familyDetailsProvider.overrideWith((ref, familyId) async => _family),
          familyMembersProvider.overrideWith(
            (ref, familyId) async => [_member],
          ),
          familyInvitationsProvider.overrideWith(
            (ref, familyId) async => <FamilyInvitation>[],
          ),
        ],
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Northstar'));
    await tester.pumpAndSettle();

    expect(find.text('Active members'), findsOneWidget);
    expect(find.text('Avery Example'), findsOneWidget);
    router.dispose();
  });
}
