import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/app_error.dart';
import '../../../shared/widgets/auth_page.dart';
import '../auth_state.dart';

class RegistrationScreen extends ConsumerStatefulWidget {
  const RegistrationScreen({super.key});

  @override
  ConsumerState<RegistrationScreen> createState() => _RegistrationScreenState();
}

class _RegistrationScreenState extends ConsumerState<RegistrationScreen> {
  final _formKey = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _phone = TextEditingController();
  final _password = TextEditingController();
  final _confirmation = TextEditingController();
  bool _acceptTerms = false;
  bool _acceptPrivacy = false;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    _phone.dispose();
    _password.dispose();
    _confirmation.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    if (!_acceptTerms || !_acceptPrivacy) {
      setState(
        () => _error = 'Accept the Terms and Privacy Policy to continue.',
      );
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final result = await ref
          .read(authApiProvider)
          .register(
            fullName: _name.text.trim(),
            email: _email.text.trim(),
            phone: _phone.text.trim(),
            password: _password.text,
            passwordConfirmation: _confirmation.text,
            acceptTerms: _acceptTerms,
            acceptPrivacy: _acceptPrivacy,
          );
      if (mounted) {
        final otp = result['developmentOtp'];
        final developmentOtp = kDebugMode && otp is Map<String, dynamic>
            ? otp
            : null;
        context.go(
          '/verify?email=${Uri.encodeQueryComponent(_email.text.trim())}'
          '&phone=${Uri.encodeQueryComponent(_phone.text.trim())}',
          extra: developmentOtp,
        );
      }
    } on AppError catch (error) {
      if (mounted) setState(() => _error = error.message);
    } catch (_) {
      if (mounted) setState(() => _error = 'Unable to create your account.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => AuthPage(
    title: 'Create your account',
    description: 'Verify both contacts to activate your FamShield account.',
    children: [
      Form(
        key: _formKey,
        child: Column(
          children: [
            TextFormField(
              controller: _name,
              decoration: const InputDecoration(labelText: 'Full name'),
              textCapitalization: TextCapitalization.words,
              maxLength: 100,
              validator: (value) => value == null || value.trim().length < 2
                  ? 'Enter your full name.'
                  : null,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _email,
              decoration: const InputDecoration(labelText: 'Email address'),
              keyboardType: TextInputType.emailAddress,
              validator: (value) =>
                  value != null &&
                      RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$')
                          .hasMatch(value.trim())
                  ? null
                  : 'Enter a valid email address.',
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _phone,
              decoration: const InputDecoration(
                labelText: 'Mobile number with country code',
                hintText: '+14155550123',
              ),
              keyboardType: TextInputType.phone,
              validator: (value) =>
                  value != null &&
                      RegExp(r'^\+[1-9]\d{7,14}$').hasMatch(value.trim())
                  ? null
                  : 'Use an international E.164 mobile number.',
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _password,
              decoration: const InputDecoration(labelText: 'Password'),
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
      CheckboxListTile(
        contentPadding: EdgeInsets.zero,
        controlAffinity: ListTileControlAffinity.leading,
        value: _acceptTerms,
        onChanged: _busy
            ? null
            : (value) => setState(() => _acceptTerms = value ?? false),
        title: const Text('I accept the Terms of Service.'),
      ),
      CheckboxListTile(
        contentPadding: EdgeInsets.zero,
        controlAffinity: ListTileControlAffinity.leading,
        value: _acceptPrivacy,
        onChanged: _busy
            ? null
            : (value) => setState(() => _acceptPrivacy = value ?? false),
        title: const Text('I acknowledge the Privacy Policy.'),
      ),
      if (_error != null) ...[
        const SizedBox(height: 8),
        Text(
          _error!,
          style: TextStyle(color: Theme.of(context).colorScheme.error),
        ),
      ],
      const SizedBox(height: 12),
      SizedBox(
        width: double.infinity,
        child: FilledButton(
          onPressed: _busy ? null : _submit,
          child: _busy
              ? const CircularProgressIndicator()
              : const Text('Create account'),
        ),
      ),
      Center(
        child: TextButton(
          onPressed: () => context.go('/login'),
          child: const Text('I already have an account'),
        ),
      ),
    ],
  );
}
