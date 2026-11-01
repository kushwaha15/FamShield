import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/app_error.dart';
import '../../../features/auth/auth_state.dart';
import '../../../shared/widgets/auth_page.dart';

class ProfileScreen extends ConsumerStatefulWidget {
  const ProfileScreen({super.key});

  @override
  ConsumerState<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends ConsumerState<ProfileScreen> {
  final _formKey = GlobalKey<FormState>();
  final _fullName = TextEditingController();
  final _imageUrl = TextEditingController();
  bool _initialized = false;
  bool _removeImage = false;
  bool _busy = false;
  String? _message;
  bool _isError = false;

  @override
  void dispose() {
    _fullName.dispose();
    _imageUrl.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _message = null;
    });
    try {
      await ref
          .read(authProvider.notifier)
          .updateProfile(
            fullName: _fullName.text.trim(),
            profileImageUrl: _imageUrl.text.trim().isEmpty
                ? null
                : _imageUrl.text.trim(),
            removeProfileImage: _removeImage,
          );
      if (mounted) {
        setState(() {
          _isError = false;
          _message = 'Your profile has been updated.';
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
    final user = ref.watch(authProvider).asData?.value;
    if (user == null) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    if (!_initialized) {
      _fullName.text = user.fullName;
      _imageUrl.text = user.profileImageUrl ?? '';
      _initialized = true;
    }
    return AuthPage(
      title: 'Your profile',
      description: 'Edit only the account details supported by FamShield.',
      children: [
        Form(
          key: _formKey,
          child: Column(
            children: [
              TextFormField(
                controller: _fullName,
                decoration: const InputDecoration(labelText: 'Full name'),
                maxLength: 100,
                validator: (value) => value == null || value.trim().length < 2
                    ? 'Enter a name with at least 2 characters.'
                    : null,
              ),
              const SizedBox(height: 12),
              TextFormField(
                initialValue: user.email,
                decoration: const InputDecoration(labelText: 'Email address'),
                readOnly: true,
              ),
              const SizedBox(height: 12),
              TextFormField(
                initialValue: user.phone,
                decoration: const InputDecoration(labelText: 'Mobile number'),
                readOnly: true,
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _imageUrl,
                decoration: const InputDecoration(
                  labelText: 'Profile image URL (optional)',
                  hintText: 'https://example.com/image.jpg',
                ),
                keyboardType: TextInputType.url,
                validator: (value) {
                  if (value == null || value.trim().isEmpty || _removeImage) {
                    return null;
                  }
                  final uri = Uri.tryParse(value.trim());
                  return uri?.scheme == 'https' && uri?.host.isNotEmpty == true
                      ? null
                      : 'Use a valid HTTPS URL.';
                },
              ),
            ],
          ),
        ),
        CheckboxListTile(
          contentPadding: EdgeInsets.zero,
          controlAffinity: ListTileControlAffinity.leading,
          value: _removeImage,
          title: const Text('Remove current profile image'),
          onChanged: _busy
              ? null
              : (value) => setState(() => _removeImage = value ?? false),
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
        const SizedBox(height: 16),
        SizedBox(
          width: double.infinity,
          child: FilledButton(
            onPressed: _busy ? null : _save,
            child: _busy
                ? const CircularProgressIndicator()
                : const Text('Save changes'),
          ),
        ),
        Center(
          child: TextButton(
            onPressed: () => context.go('/dashboard'),
            child: const Text('Back to dashboard'),
          ),
        ),
      ],
    );
  }
}
