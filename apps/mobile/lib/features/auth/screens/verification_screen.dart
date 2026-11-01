import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/app_error.dart';
import '../../../shared/widgets/auth_page.dart';
import '../auth_state.dart';

class VerificationScreen extends ConsumerStatefulWidget {
  const VerificationScreen({
    required this.email,
    required this.phone,
    this.developmentOtp,
    super.key,
  });

  final String email;
  final String phone;
  final Map<String, dynamic>? developmentOtp;

  @override
  ConsumerState<VerificationScreen> createState() => _VerificationScreenState();
}

class _VerificationScreenState extends ConsumerState<VerificationScreen> {
  final _emailCode = TextEditingController();
  final _phoneCode = TextEditingController();
  Timer? _timer;
  int _cooldown = 30;
  bool _emailVerified = false;
  bool _phoneVerified = false;
  bool _busy = false;
  String? _message;
  bool _isError = false;
  String? _developmentEmailCode;
  String? _developmentPhoneCode;

  @override
  void initState() {
    super.initState();
    if (kDebugMode) {
      _developmentEmailCode = widget.developmentOtp?['email'] as String?;
      _developmentPhoneCode = widget.developmentOtp?['phone'] as String?;
    }
    _timer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (_cooldown <= 1) {
        timer.cancel();
        if (mounted) setState(() => _cooldown = 0);
      } else if (mounted) {
        setState(() => _cooldown--);
      }
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    _emailCode.dispose();
    _phoneCode.dispose();
    super.dispose();
  }

  Future<void> _verify({required bool email}) async {
    final controller = email ? _emailCode : _phoneCode;
    final code = controller.text.trim();
    if (!RegExp(r'^\d{6}$').hasMatch(code)) {
      setState(() {
        _isError = true;
        _message = 'Enter a valid 6-digit code.';
      });
      return;
    }
    setState(() {
      _busy = true;
      _message = null;
    });
    try {
      final api = ref.read(authApiProvider);
      if (email) {
        await api.verifyEmail(widget.email, code);
      } else {
        await api.verifyPhone(widget.phone, code);
      }
      if (mounted) {
        setState(() {
          if (email) {
            _emailVerified = true;
          } else {
            _phoneVerified = true;
          }
          _isError = false;
          _message = email ? 'Email verified.' : 'Mobile number verified.';
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

  Future<void> _resend({required bool email}) async {
    setState(() {
      _busy = true;
      _message = null;
    });
    try {
      final response = await ref
          .read(authApiProvider)
          .resendOtp(
            identifier: email ? widget.email : widget.phone,
            purpose: email ? 'verify_email' : 'verify_phone',
          );
      if (mounted) {
        final developmentCode = response['developmentOtp'];
        setState(() {
          _cooldown = 30;
          _message = 'If the account is eligible, a new code has been sent.';
          _isError = false;
          if (kDebugMode && developmentCode is String) {
            if (email) {
              _developmentEmailCode = developmentCode;
            } else {
              _developmentPhoneCode = developmentCode;
            }
          }
        });
        _timer?.cancel();
        _timer = Timer.periodic(const Duration(seconds: 1), (timer) {
          if (_cooldown <= 1) {
            timer.cancel();
            if (mounted) setState(() => _cooldown = 0);
          } else if (mounted) {
            setState(() => _cooldown--);
          }
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
  Widget build(BuildContext context) {
    final hasBothContacts = widget.email.isNotEmpty && widget.phone.isNotEmpty;
    return AuthPage(
      title: 'Verify your contacts',
      description:
          'Enter the 6-digit codes sent to your email and mobile number.',
      children: [
        if (!hasBothContacts)
          const Text(
            'Open verification from registration to provide both contacts.',
          )
        else ...[
          if (kDebugMode &&
              (_developmentEmailCode != null || _developmentPhoneCode != null))
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: SelectableText(
                'Development-only test codes: email ${_developmentEmailCode ?? '—'}, '
                'phone ${_developmentPhoneCode ?? '—'}',
              ),
            ),
          if (!_emailVerified)
            _codeSection(
              label: 'Email verification code',
              controller: _emailCode,
              verified: _emailVerified,
              onVerify: () => _verify(email: true),
              onResend: () => _resend(email: true),
            )
          else
            const ListTile(
              leading: Icon(Icons.verified, color: Color(0xFF0F9D9A)),
              title: Text('Email verified'),
            ),
          const SizedBox(height: 16),
          if (!_phoneVerified)
            _codeSection(
              label: 'Phone verification code',
              controller: _phoneCode,
              verified: _phoneVerified,
              onVerify: () => _verify(email: false),
              onResend: () => _resend(email: false),
            )
          else
            const ListTile(
              leading: Icon(Icons.verified, color: Color(0xFF0F9D9A)),
              title: Text('Mobile number verified'),
            ),
        ],
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
        if (_emailVerified && _phoneVerified)
          Padding(
            padding: const EdgeInsets.only(top: 16),
            child: SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: () => context.go('/login'),
                child: const Text('Continue to sign in'),
              ),
            ),
          ),
        TextButton(
          onPressed: () => context.go('/login'),
          child: const Text('Back to sign in'),
        ),
      ],
    );
  }

  Widget _codeSection({
    required String label,
    required TextEditingController controller,
    required bool verified,
    required VoidCallback onVerify,
    required VoidCallback onResend,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        TextFormField(
          controller: controller,
          decoration: InputDecoration(labelText: label),
          keyboardType: TextInputType.number,
          maxLength: 6,
        ),
        FilledButton(
          onPressed: _busy || verified ? null : onVerify,
          child: const Text('Verify'),
        ),
        TextButton(
          onPressed: _busy || _cooldown > 0 ? null : onResend,
          child: Text(
            _cooldown > 0 ? 'Resend available in ${_cooldown}s' : 'Resend code',
          ),
        ),
      ],
    );
  }
}
