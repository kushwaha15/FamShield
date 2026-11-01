import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import '../core/app_error.dart';
import '../models/auth_user.dart';
import '../services/auth_api.dart';

class AuthScreen extends StatefulWidget {
  const AuthScreen({super.key, this.authApi});

  final AuthApi? authApi;

  @override
  State<AuthScreen> createState() => _AuthScreenState();
}

class _AuthScreenState extends State<AuthScreen> {
  late final AuthApi _authApi = widget.authApi ?? AuthApi();
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _emailController = TextEditingController();
  final _phoneController = TextEditingController();
  final _identifierController = TextEditingController();
  final _passwordController = TextEditingController();
  final _confirmationController = TextEditingController();
  final _emailCodeController = TextEditingController();
  final _phoneCodeController = TextEditingController();

  bool _isRegistering = false;
  bool _isVerifying = false;
  bool _emailVerified = false;
  bool _phoneVerified = false;
  bool _acceptTerms = false;
  bool _acceptPrivacy = false;
  bool _busy = false;
  String? _message;
  String? _developmentEmailCode;
  String? _developmentPhoneCode;
  AuthUser? _user;

  @override
  void dispose() {
    _nameController.dispose();
    _emailController.dispose();
    _phoneController.dispose();
    _identifierController.dispose();
    _passwordController.dispose();
    _confirmationController.dispose();
    _emailCodeController.dispose();
    _phoneCodeController.dispose();
    super.dispose();
  }

  Future<void> _submitLogin() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _message = null;
    });
    try {
      final user = await _authApi.login(
        _identifierController.text.trim(),
        _passwordController.text,
      );
      if (mounted) setState(() => _user = user);
    } on AppError catch (error) {
      if (mounted) setState(() => _message = error.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _submitRegistration() async {
    if (!_formKey.currentState!.validate()) return;
    if (!_acceptTerms || !_acceptPrivacy) {
      setState(
        () => _message =
            'Accept the Terms of Service and Privacy Policy to continue.',
      );
      return;
    }
    setState(() {
      _busy = true;
      _message = null;
    });
    try {
      final result = await _authApi.register(
        fullName: _nameController.text.trim(),
        email: _emailController.text.trim(),
        phone: _phoneController.text.trim(),
        password: _passwordController.text,
        passwordConfirmation: _confirmationController.text,
        acceptTerms: _acceptTerms,
        acceptPrivacy: _acceptPrivacy,
      );
      final codes = result['developmentOtp'];
      if (kDebugMode && codes is Map<String, dynamic>) {
        _developmentEmailCode = codes['email'] as String?;
        _developmentPhoneCode = codes['phone'] as String?;
      }
      setState(() {
        _isVerifying = true;
        _message = 'Verify both your email address and mobile number to activate your account.';
      });
    } on AppError catch (error) {
      if (mounted) setState(() => _message = error.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _verifyEmail() async {
    if (!RegExp(r'^\d{6}$').hasMatch(_emailCodeController.text.trim())) {
      setState(() => _message = 'Enter a 6-digit email verification code.');
      return;
    }
    setState(() {
      _busy = true;
      _message = null;
    });
    try {
      await _authApi.verifyEmail(
        _emailController.text.trim(),
        _emailCodeController.text.trim(),
      );
      if (mounted) {
        setState(() {
          _emailVerified = true;
          _message = 'Email verified.';
        });
      }
    } on AppError catch (error) {
      if (mounted) setState(() => _message = error.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _verifyPhone() async {
    if (!RegExp(r'^\d{6}$').hasMatch(_phoneCodeController.text.trim())) {
      setState(() => _message = 'Enter a 6-digit phone verification code.');
      return;
    }
    setState(() {
      _busy = true;
      _message = null;
    });
    try {
      await _authApi.verifyPhone(
        _phoneController.text.trim(),
        _phoneCodeController.text.trim(),
      );
      if (mounted) {
        setState(() {
          _phoneVerified = true;
          _message = 'Mobile number verified.';
        });
      }
    } on AppError catch (error) {
      if (mounted) setState(() => _message = error.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _logout() async {
    setState(() {
      _busy = true;
      _message = null;
    });
    try {
      await _authApi.logout();
      if (mounted) setState(() => _user = null);
    } on AppError catch (error) {
      if (mounted) setState(() => _message = error.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String? _validateRequired(String? value) {
    if (value == null || value.trim().isEmpty) return 'This field is required.';
    return null;
  }

  String? _validatePassword(String? value) {
    final required = _validateRequired(value);
    if (required != null) return required;
    if (value!.length < 12 ||
        !RegExp('[a-z]').hasMatch(value) ||
        !RegExp('[A-Z]').hasMatch(value) ||
        !RegExp(r'\d').hasMatch(value) ||
        !RegExp(r'[^A-Za-z0-9]').hasMatch(value)) {
      return 'Use 12+ characters with upper/lowercase, a number, and a symbol.';
    }
    return null;
  }

  Widget _textField(
    String label,
    TextEditingController controller, {
    String? Function(String?)? validator,
    TextInputType? keyboardType,
    bool obscureText = false,
    int maxLength = 254,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: TextFormField(
        controller: controller,
        validator: validator ?? _validateRequired,
        keyboardType: keyboardType,
        obscureText: obscureText,
        maxLength: maxLength,
        decoration: InputDecoration(
          labelText: label,
          counterText: '',
          border: OutlineInputBorder(borderRadius: BorderRadius.circular(14)),
        ),
      ),
    );
  }

  Widget _consentCheckbox(
    String title,
    bool value,
    ValueChanged<bool?> onChanged,
  ) {
    return CheckboxListTile(
      contentPadding: EdgeInsets.zero,
      controlAffinity: ListTileControlAffinity.leading,
      value: value,
      title: Text(title, style: const TextStyle(fontSize: 14)),
      onChanged: _busy ? null : onChanged,
    );
  }

  @override
  Widget build(BuildContext context) {
    final user = _user;
    return Scaffold(
      appBar: AppBar(title: const Text('FamShield account')),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 480),
              child: Card(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: user != null
                      ? Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text(
                              'Welcome, ${user.fullName}',
                              style: Theme.of(context).textTheme.headlineSmall,
                            ),
                            const SizedBox(height: 8),
                            Text(user.email),
                            Text(user.phone),
                            const SizedBox(height: 20),
                            FilledButton(
                              onPressed: _busy ? null : _logout,
                              child: const Text('Sign out'),
                            ),
                          ],
                        )
                      : _isVerifying
                      ? _buildVerificationForm(context)
                      : _buildAuthForm(context),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildAuthForm(BuildContext context) {
    return Form(
      key: _formKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            _isRegistering ? 'Create your account' : 'Sign in',
            style: Theme.of(context).textTheme.headlineSmall,
          ),
          const SizedBox(height: 8),
          const Text(
            'Account verification is required before sign-in is enabled.',
          ),
          const SizedBox(height: 24),
          if (_isRegistering) ...[
            _textField('Full name', _nameController, maxLength: 100),
            _textField(
              'Email address',
              _emailController,
              keyboardType: TextInputType.emailAddress,
            ),
            _textField(
              'Mobile number with country code',
              _phoneController,
              keyboardType: TextInputType.phone,
            ),
          ] else
            _textField(
              'Email or mobile number',
              _identifierController,
              keyboardType: TextInputType.emailAddress,
            ),
          _textField(
            'Password',
            _passwordController,
            obscureText: true,
            validator: _isRegistering ? _validatePassword : _validateRequired,
            maxLength: 128,
          ),
          if (_isRegistering)
            _textField(
              'Confirm password',
              _confirmationController,
              obscureText: true,
              maxLength: 128,
              validator: (value) => value != _passwordController.text
                  ? 'Passwords do not match.'
                  : null,
            ),
          if (_isRegistering) ...[
            _consentCheckbox(
              'I accept the Terms of Service.',
              _acceptTerms,
              (value) => setState(() => _acceptTerms = value ?? false),
            ),
            _consentCheckbox(
              'I acknowledge the Privacy Policy.',
              _acceptPrivacy,
              (value) => setState(() => _acceptPrivacy = value ?? false),
            ),
          ],
          if (_message != null) ...[
            const SizedBox(height: 8),
            Text(
              _message!,
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          ],
          const SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            child: FilledButton(
              onPressed: _busy
                  ? null
                  : (_isRegistering ? _submitRegistration : _submitLogin),
              child: Text(
                _busy
                    ? 'Please wait…'
                    : _isRegistering
                    ? 'Create account'
                    : 'Sign in',
              ),
            ),
          ),
          TextButton(
            onPressed: _busy
                ? null
                : () => setState(() {
                    _isRegistering = !_isRegistering;
                    _message = null;
                    _formKey.currentState?.reset();
                  }),
            child: Text(
              _isRegistering
                  ? 'I already have an account'
                  : 'Create a FamShield account',
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildVerificationForm(BuildContext context) {
    return Form(
      key: _formKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            'Verify your contacts',
            style: Theme.of(context).textTheme.headlineSmall,
          ),
          const SizedBox(height: 8),
          const Text('Verify both email and mobile before signing in.'),
          const SizedBox(height: 20),
          if (!_emailVerified) ...[
            _textField(
              'Email verification code',
              _emailCodeController,
              keyboardType: TextInputType.number,
              maxLength: 6,
              validator: (value) =>
                  value != null && RegExp(r'^\d{6}$').hasMatch(value)
                  ? null
                  : 'Enter a 6-digit code.',
            ),
            SizedBox(
              width: double.infinity,
              child: OutlinedButton(
                onPressed: _busy ? null : _verifyEmail,
                child: const Text('Verify email'),
              ),
            ),
          ] else
            const ListTile(
              leading: Icon(Icons.check_circle, color: Color(0xFF0F9D9A)),
              title: Text('Email verified'),
            ),
          if (!_phoneVerified) ...[
            _textField(
              'Phone verification code',
              _phoneCodeController,
              keyboardType: TextInputType.number,
              maxLength: 6,
              validator: (value) =>
                  value != null && RegExp(r'^\d{6}$').hasMatch(value)
                  ? null
                  : 'Enter a 6-digit code.',
            ),
            SizedBox(
              width: double.infinity,
              child: OutlinedButton(
                onPressed: _busy ? null : _verifyPhone,
                child: const Text('Verify mobile number'),
              ),
            ),
          ] else
            const ListTile(
              leading: Icon(Icons.check_circle, color: Color(0xFF0F9D9A)),
              title: Text('Mobile number verified'),
            ),
          if (kDebugMode &&
              (_developmentEmailCode != null || _developmentPhoneCode != null))
            Padding(
              padding: const EdgeInsets.only(top: 16),
              child: SelectableText(
                'Development-only test codes: email ${_developmentEmailCode ?? '—'}, '
                'phone ${_developmentPhoneCode ?? '—'}',
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ),
          if (_message != null)
            Padding(
              padding: const EdgeInsets.only(top: 12),
              child: Text(
                _message!,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ),
          if (_emailVerified && _phoneVerified)
            Padding(
              padding: const EdgeInsets.only(top: 16),
              child: FilledButton(
                onPressed: () => setState(() {
                  _isVerifying = false;
                  _isRegistering = false;
                  _message = 'Both contacts are verified. Sign in to continue.';
                }),
                child: const Text('Continue to sign in'),
              ),
            ),
        ],
      ),
    );
  }
}
