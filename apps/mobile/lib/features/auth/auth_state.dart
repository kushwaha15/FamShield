import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../location/location_providers.dart';
import '../../models/auth_user.dart';
import '../../services/auth_api.dart';

final authApiProvider = Provider<AuthApi>(
  (ref) => AuthApi(
    onSessionExpired: () => ref.read(authProvider.notifier).sessionExpired(),
  ),
);

final authProvider = AsyncNotifierProvider<AuthController, AuthUser?>(
  AuthController.new,
);

class AuthController extends AsyncNotifier<AuthUser?> {
  AuthApi get _api => ref.read(authApiProvider);

  @override
  Future<AuthUser?> build() => _api.restoreSession();

  Future<void> retryRestore() async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(_api.restoreSession);
  }

  void sessionExpired() {
    unawaited(ref.read(locationSharingProvider.notifier).stopForLogout());
    state = const AsyncData(null);
  }

  Future<void> signIn(String identifier, String password) async {
    try {
      state = AsyncData(await _api.login(identifier, password));
    } catch (_) {
      state = const AsyncData(null);
      rethrow;
    }
  }

  Future<void> updateProfile({
    required String fullName,
    String? profileImageUrl,
    bool removeProfileImage = false,
  }) async {
    final user = await _api.updateProfile(
      fullName: fullName,
      profileImageUrl: profileImageUrl,
      removeProfileImage: removeProfileImage,
    );
    state = AsyncData(user);
  }

  Future<void> signOut({bool everywhere = false}) async {
    try {
      await ref.read(locationSharingProvider.notifier).stopForLogout();
      if (everywhere) {
        await _api.logoutAll();
      } else {
        await _api.logout();
      }
    } finally {
      state = const AsyncData(null);
    }
  }
}
