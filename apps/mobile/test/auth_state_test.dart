import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:famshield_mobile/features/auth/auth_state.dart';

import 'helpers/fakes.dart';

void main() {
  test('restores a previously authenticated user on startup', () async {
    final api = FakeAuthApi(restoredUser: testUser);
    final container = ProviderContainer(
      overrides: [authApiProvider.overrideWithValue(api)],
    );
    addTearDown(container.dispose);

    final user = await container.read(authProvider.future);

    expect(user?.id, testUser.id);
  });

  test('login and logout update shared authentication state', () async {
    final api = FakeAuthApi();
    final container = ProviderContainer(
      overrides: [authApiProvider.overrideWithValue(api)],
    );
    addTearDown(container.dispose);
    await container.read(authProvider.future);

    await container
        .read(authProvider.notifier)
        .signIn('avery@example.test', 'StrongPass!234');
    expect(container.read(authProvider).asData?.value?.email, testUser.email);

    await container.read(authProvider.notifier).signOut();
    expect(container.read(authProvider).asData?.value, isNull);
    expect(api.logoutCalls, 1);
  });
}
