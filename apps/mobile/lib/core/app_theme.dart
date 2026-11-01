import 'package:flutter/material.dart';

abstract final class AppTheme {
  static const navy = Color(0xFF102A43);
  static const teal = Color(0xFF0F9D9A);

  static final light = ThemeData(
    useMaterial3: true,
    colorScheme: ColorScheme.fromSeed(
      seedColor: navy,
      primary: navy,
      secondary: teal,
      surface: const Color(0xFFFFFFFF),
    ),
    scaffoldBackgroundColor: const Color(0xFFF6F8FA),
    textTheme: const TextTheme(
      headlineMedium: TextStyle(
        color: navy,
        fontWeight: FontWeight.w700,
        letterSpacing: -0.5,
      ),
      bodyLarge: TextStyle(color: Color(0xFF486581), height: 1.6),
    ),
    cardTheme: CardThemeData(
      color: Colors.white,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(20),
        side: const BorderSide(color: Color(0xFFE6EBF0)),
      ),
    ),
  );
}
