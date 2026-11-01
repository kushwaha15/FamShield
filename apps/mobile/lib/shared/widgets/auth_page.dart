import 'package:flutter/material.dart';

class AuthPage extends StatelessWidget {
  const AuthPage({
    required this.title,
    required this.description,
    required this.children,
    super.key,
  });

  final String title;
  final String description;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('FamShield')),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 480),
              child: Card(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        title,
                        style: Theme.of(context).textTheme.headlineSmall,
                      ),
                      const SizedBox(height: 8),
                      Text(
                        description,
                        style: Theme.of(context).textTheme.bodyMedium,
                      ),
                      const SizedBox(height: 24),
                      ...children,
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

String? validatePassword(String? value) {
  if (value == null ||
      value.length < 12 ||
      !RegExp('[a-z]').hasMatch(value) ||
      !RegExp('[A-Z]').hasMatch(value) ||
      !RegExp(r'\d').hasMatch(value) ||
      !RegExp(r'[^A-Za-z0-9]').hasMatch(value)) {
    return 'Use 12+ characters with uppercase, lowercase, a number, and a symbol.';
  }
  return null;
}

String apiErrorText(Object error) {
  final text = error.toString();
  return text.startsWith('Exception: ') ? text.substring(11) : text;
}
