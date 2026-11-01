import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/app_error.dart';
import '../../../shared/widgets/auth_page.dart';
import '../auth_state.dart';

class ForgotPasswordScreen extends ConsumerStatefulWidget {
  const ForgotPasswordScreen({super.key});

  @override
  ConsumerState<ForgotPasswordScreen> createState() =>
      _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState extends ConsumerState<ForgotPasswordScreen> {
  final _formKey = GlobalKey<FormState>();
  final _identifier = TextEditingController();
  String _channel = 'email';
  bool _busy = false;
  String? _message;
  bool _isError = false;

  @override
  void dispose() {
    _identifier.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _message = null;
    });
    final identifier = _identifier.text.trim();
    try {
      await ref
          .read(authApiProvider)
          .forgotPassword(identifier: identifier, channel: _channel);
      if (mounted) {
        context.go(
          '/reset-password?identifier=${Uri.encodeQueryComponent(identifier)}',
        );
      }
    } on AppError catch (error) {
      if (mounted) {
        setState(() {
          _isError = true;
          _message = error.message;
        });
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => AuthPage(
    title: 'Reset your password',
    description: 'Choose a verified contact method. If your account is eligible, reset instructions will be sent.',
    children: [
      DropdownButtonFormField<String>(
        initialValue: _channel,
        decoration: const InputDecoration(labelText: 'Send code by'),
        items: const [
          DropdownMenuItem(value: 'email', child: Text('Email')),
          DropdownMenuItem(value: 'phone', child: Text('Mobile number')),
        ],
        onChanged: _busy
            ? null
            : (value) => setState(() => _channel = value ?? 'email'),
      ),
      const SizedBox(height: 16),
      Form(
        key: _formKey,
        child: TextFormField(
          controller: _identifier,
          decoration: InputDecoration(
            labelText: _channel == 'email' ? 'Email address' : 'Mobile number',
            hintText: _channel == 'phone' ? '+14155550123' : 'you@example.com',
          ),
          keyboardType: _channel == 'email'
              ? TextInputType.emailAddress
              : TextInputType.phone,
          validator: (value) {
            final input = value?.trim() ?? '';
            final valid = _channel == 'email'
                ? RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$').hasMatch(input)
                : RegExp(r'^\+[1-9]\d{7,14}$').hasMatch(input);
            return valid ? null : 'Enter a valid contact.';
          },
        ),
      ),
      if (_message != null)
        Padding(
          padding: const EdgeInsets.only(top: 12),
          child: Text(
            _message!,
            style: TextStyle(
              color: _isError
                  ? Theme.of(context).colorScheme.error
                  : Colors.teal,
            ),
          ),
        ),
      const SizedBox(height: 20),
      SizedBox(
        width: double.infinity,
        child: FilledButton(
          onPressed: _busy ? null : _submit,
          child: _busy
              ? const CircularProgressIndicator()
              : const Text('Send reset code'),
        ),
      ),
      Center(
        child: TextButton(
          onPressed: () => context.go('/login'),
          child: const Text('Back to sign in'),
        ),
      ),
    ],
  );
}
