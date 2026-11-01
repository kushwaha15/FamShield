import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/app_router.dart';
import 'core/app_theme.dart';
import 'features/location/location_lifecycle_guard.dart';

void main() {
  runApp(const ProviderScope(child: FamShieldApp()));
}

class FamShieldApp extends ConsumerWidget {
  const FamShieldApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(appRouterProvider);
    return MaterialApp.router(
      title: 'FamShield',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light,
      routerConfig: router,
      builder: (context, child) => LocationLifecycleGuard(
        child: child ?? const SizedBox.shrink(),
      ),
    );
  }
}
