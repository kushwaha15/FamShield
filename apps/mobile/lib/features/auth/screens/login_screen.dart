import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/app_error.dart';
import '../../../shared/widgets/auth_page.dart';
import '../auth_state.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _identifier = TextEditingController();
  final _password = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _identifier.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref
          .read(authProvider.notifier)
          .signIn(_identifier.text.trim(), _password.text);
      if (!mounted) return;
      final next = GoRouterState.of(context).uri.queryParameters['next'];
      final destination =
          next != null &&
              (next == '/dashboard' ||
                  next == '/profile' ||
                  next == '/security')
          ? next
          : '/dashboard';
      context.go(destination);
    } catch (error) {
      if (mounted) {
        setState(
          () => _error = error is AppError
              ? error.message
              : 'Unable to sign in. Please try again.',
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authProvider);
    final startupError = auth.error;
    return AuthPage(
      title: 'Welcome back',
      description: 'Sign in with your verified email address or mobile number.',
      children: [
        if (auth.hasError) ...[
          _ErrorBanner(
            message: startupError is AppError ? startupError.message : 'Your saved session could not be restored. Check your connection and retry.',
          ),
          TextButton(
            onPressed: () => ref.read(authProvider.notifier).retryRestore(),
            child: const Text('Retry session check'),
          ),
          const SizedBox(height: 8),
        ],
        Form(
          key: _formKey,
          child: Column(
            children: [
              TextFormField(
                controller: _identifier,
                key: const ValueKey('login-identifier'),
                decoration: const InputDecoration(
                  labelText: 'Email or mobile number',
                  hintText: 'you@example.com or +14155550123',
                ),
                keyboardType: TextInputType.emailAddress,
                textInputAction: TextInputAction.next,
                validator: (value) {
                  final input = value?.trim() ?? '';
                  if (RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$').hasMatch(input) ||
                      RegExp(r'^\+[1-9]\d{7,14}$').hasMatch(input)) {
                    return null;
                  }
                  return 'Enter a valid email address or E.164 mobile number.';
                },
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _password,
                key: const ValueKey('login-password'),
                decoration: const InputDecoration(labelText: 'Password'),
                obscureText: true,
                textInputAction: TextInputAction.done,
                onFieldSubmitted: (_) => _busy ? null : _submit(),
                validator: (value) => value == null || value.isEmpty
                    ? 'Enter your password.'
                    : null,
              ),
              if (_error != null) ...[
                const SizedBox(height: 16),
                _ErrorBanner(message: _error!),
              ],
              const SizedBox(height: 20),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: _busy ? null : _submit,
                  child: _busy
                      ? const SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Text('Sign in'),
                ),
              ),
            ],
          ),
        ),
        Align(
          alignment: Alignment.centerRight,
          child: TextButton(
            onPressed: () => context.go('/forgot-password'),
            child: const Text('Forgot password?'),
          ),
        ),
        Center(
          child: TextButton(
            onPressed: () => context.go('/signup'),
            child: const Text('Create a FamShield account'),
          ),
        ),
      ],
    );
  }
}

class _ErrorBanner extends StatelessWidget {
  const _ErrorBanner({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) => Container(
    width: double.infinity,
    padding: const EdgeInsets.all(12),
    decoration: BoxDecoration(
      color: Theme.of(context).colorScheme.errorContainer,
      borderRadius: BorderRadius.circular(12),
    ),
    child: Text(
      message,
      style: TextStyle(color: Theme.of(context).colorScheme.onErrorContainer),
    ),
  );
}
