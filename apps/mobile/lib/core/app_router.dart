import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../features/auth/auth_state.dart';
import '../features/auth/screens/forgot_password_screen.dart';
import '../features/auth/screens/login_screen.dart';
import '../features/auth/screens/registration_screen.dart';
import '../features/auth/screens/reset_password_screen.dart';
import '../features/auth/screens/verification_screen.dart';
import '../features/dashboard/screens/dashboard_screen.dart';
import '../features/dashboard/screens/profile_screen.dart';
import '../features/dashboard/screens/security_screen.dart';
import '../features/families/screens/family_detail_screen.dart';
import '../features/families/screens/family_list_screen.dart';
import '../features/location/screens/family_location_screen.dart';
import '../features/privacy/screens/location_privacy_screen.dart';
import '../screens/welcome_screen.dart';

final appRouterProvider = Provider<GoRouter>((ref) {
  final refresh = _RouterRefresh();
  ref.listen(authProvider, (_, _) => refresh.notifyChanged());

  final router = GoRouter(
    initialLocation: '/',
    refreshListenable: refresh,
    redirect: (context, state) {
      final auth = ref.read(authProvider);
      final path = state.uri.path;
      final isLoadingRoute = path == '/loading';
      final isProtected =
          const {
            '/dashboard',
            '/profile',
            '/security',
            '/privacy',
          }.contains(path) ||
          path.startsWith('/families');
      final next = state.uri.queryParameters['next'];

      if (auth.isLoading) {
        if (isLoadingRoute) return null;
        return '/loading?next=${Uri.encodeComponent(state.uri.toString())}';
      }
      if (isLoadingRoute) {
        if (auth.hasError) return '/login';
        if (auth.asData?.value != null) {
          return _safeInternalPath(next) && !_isAuthEntry(next!)
              ? next
              : '/dashboard';
        }
        return _safeInternalPath(next) && !_isProtectedPath(next!)
            ? next
            : '/login';
      }
      if (isProtected && auth.asData?.value == null) {
        return '/login?next=${Uri.encodeComponent(state.uri.toString())}';
      }
      if (auth.asData?.value != null && _isAuthEntry(path)) {
        return '/dashboard';
      }
      return null;
    },
    routes: [
      GoRoute(
        path: '/loading',
        builder: (context, state) => const _StartupScreen(),
      ),
      GoRoute(path: '/', builder: (context, state) => const WelcomeScreen()),
      GoRoute(path: '/login', builder: (context, state) => const LoginScreen()),
      GoRoute(
        path: '/signup',
        builder: (context, state) => const RegistrationScreen(),
      ),
      GoRoute(
        path: '/verify',
        builder: (context, state) => VerificationScreen(
          email: state.uri.queryParameters['email'] ?? '',
          phone: state.uri.queryParameters['phone'] ?? '',
          developmentOtp: state.extra is Map<String, dynamic>
              ? state.extra! as Map<String, dynamic>
              : null,
        ),
      ),
      GoRoute(
        path: '/forgot-password',
        builder: (context, state) => const ForgotPasswordScreen(),
      ),
      GoRoute(
        path: '/reset-password',
        builder: (context, state) => ResetPasswordScreen(
          identifier: state.uri.queryParameters['identifier'] ?? '',
        ),
      ),
      GoRoute(
        path: '/dashboard',
        builder: (context, state) => const DashboardScreen(),
      ),
      GoRoute(
        path: '/profile',
        builder: (context, state) => const ProfileScreen(),
      ),
      GoRoute(
        path: '/security',
        builder: (context, state) => const SecurityScreen(),
      ),
      GoRoute(
        path: '/privacy',
        builder: (context, state) => const LocationPrivacyScreen(),
      ),
      GoRoute(
        path: '/families',
        builder: (context, state) => FamilyListScreen(
          invitationToken: state.uri.queryParameters['token'],
        ),
      ),
      GoRoute(
        path: '/families/:familyId',
        builder: (context, state) =>
            FamilyDetailScreen(familyId: state.pathParameters['familyId']!),
      ),
      GoRoute(
        path: '/families/:familyId/location',
        builder: (context, state) => FamilyLocationScreen(
          familyId: state.pathParameters['familyId']!,
        ),
      ),
      GoRoute(path: '/auth', redirect: (context, state) => '/login'),
    ],
  );
  ref.onDispose(() {
    router.dispose();
    refresh.dispose();
  });
  return router;
});

bool _safeInternalPath(String? path) => path != null && path.startsWith('/');

bool _isAuthEntry(String path) =>
    path == '/' || path == '/login' || path == '/signup';

bool _isProtectedPath(String path) =>
    path == '/dashboard' ||
    path == '/profile' ||
    path == '/security' ||
    path == '/privacy' ||
    path.startsWith('/families');

class _RouterRefresh extends ChangeNotifier {
  void notifyChanged() => notifyListeners();
}

class _StartupScreen extends StatelessWidget {
  const _StartupScreen();

  @override
  Widget build(BuildContext context) => Scaffold(
    body: Center(
      child: Semantics(
        label: 'Checking secure session',
        child: CircularProgressIndicator(),
      ),
    ),
  );
}
