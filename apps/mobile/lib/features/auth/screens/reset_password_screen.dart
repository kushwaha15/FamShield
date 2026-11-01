import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/app_error.dart';
import '../../../shared/widgets/auth_page.dart';
import '../auth_state.dart';

class ResetPasswordScreen extends ConsumerStatefulWidget {
  const ResetPasswordScreen({required this.identifier, super.key});

  final String identifier;

  @override
  ConsumerState<ResetPasswordScreen> createState() =>
      _ResetPasswordScreenState();
}

class _ResetPasswordScreenState extends ConsumerState<ResetPasswordScreen> {
  final _formKey = GlobalKey<FormState>();
  final _identifier = TextEditingController();
  final _code = TextEditingController();
  final _password = TextEditingController();
  final _confirmation = TextEditingController();
  bool _busy = false;
  String? _message;
  bool _isError = false;

  @override
  void initState() {
    super.initState();
    _identifier.text = widget.identifier;
  }

  @override
  void dispose() {
    _identifier.dispose();
    _code.dispose();
    _password.dispose();
    _confirmation.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _message = null;
    });
    try {
      await ref
          .read(authApiProvider)
          .resetPassword(
            identifier: _identifier.text.trim(),
            code: _code.text.trim(),
            password: _password.text,
            passwordConfirmation: _confirmation.text,
          );
      if (mounted) {
        setState(() {
          _isError = false;
          _message = 'Password reset. Sign in with your new password.';
        });
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
    title: 'Choose a new password',
    description: 'Enter the verification code and set a new password.',
    children: [
      Form(
        key: _formKey,
        child: Column(
          children: [
            TextFormField(
              controller: _identifier,
              decoration: const InputDecoration(
                labelText: 'Email or mobile number',
              ),
              validator: (value) => value == null || value.trim().isEmpty
                  ? 'Enter the contact used for the reset.'
                  : null,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _code,
              decoration: const InputDecoration(
                labelText: '6-digit reset code',
              ),
              keyboardType: TextInputType.number,
              maxLength: 6,
              validator: (value) =>
                  value != null && RegExp(r'^\d{6}$').hasMatch(value.trim())
                  ? null
                  : 'Enter a valid 6-digit code.',
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _password,
              decoration: const InputDecoration(labelText: 'New password'),
              obscureText: true,
              validator: validatePassword,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _confirmation,
              decoration: const InputDecoration(labelText: 'Confirm password'),
              obscureText: true,
              validator: (value) =>
                  value != _password.text ? 'Passwords do not match.' : null,
            ),
          ],
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
              : const Text('Reset password'),
        ),
      ),
      if (!_isError && _message != null)
        Center(
          child: TextButton(
            onPressed: () => context.go('/login'),
            child: const Text('Sign in'),
          ),
        ),
    ],
  );
}
