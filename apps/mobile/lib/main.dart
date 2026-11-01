import 'package:flutter/material.dart';

import 'core/app_theme.dart';
import 'screens/auth_screen.dart';
import 'screens/welcome_screen.dart';

void main() {
  runApp(const FamShieldApp());
}

class FamShieldApp extends StatelessWidget {
  const FamShieldApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'FamShield',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light,
      onUnknownRoute: (_) =>
          MaterialPageRoute<void>(builder: (_) => const WelcomeScreen()),
      routes: {'/auth': (_) => const AuthScreen()},
      home: const WelcomeScreen(),
    );
  }
}
