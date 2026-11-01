import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/app_error.dart';
import '../../../features/auth/auth_state.dart';
import '../../../models/auth_session.dart';
import '../../../services/auth_api.dart';
import '../../../shared/widgets/auth_page.dart';

class SecurityScreen extends ConsumerStatefulWidget {
  const SecurityScreen({super.key});

  @override
  ConsumerState<SecurityScreen> createState() => _SecurityScreenState();
}

class _SecurityScreenState extends ConsumerState<SecurityScreen> {
  late Future<List<AuthSession>> _sessions;
  String? _error;
  bool _busy = false;

  AuthApi get _api => ref.read(authApiProvider);

  @override
  void initState() {
    super.initState();
    _sessions = _api.activeSessions();
  }

  Future<void> _revoke(AuthSession session) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Revoke this session?'),
        content: const Text(
          'This device session will no longer be able to access FamShield.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Revoke session'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await _api.revokeSession(session.sessionId);
      if (mounted) setState(() => _sessions = _api.activeSessions());
    } on AppError catch (error) {
      if (mounted) setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _logoutAll() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Sign out everywhere?'),
        content: const Text('All active FamShield sessions will be revoked.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Sign out everywhere'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await ref.read(authProvider.notifier).signOut(everywhere: true);
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Local session cleared; server logout failed.'),
          ),
        );
      }
    } finally {
      if (mounted) context.go('/login');
    }
  }

  @override
  Widget build(BuildContext context) => AuthPage(
    title: 'Security and sessions',
    description:
        'Review active sessions and revoke sessions you no longer recognize.',
    children: [
      if (_error != null)
        Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: Text(
            _error!,
            style: TextStyle(color: Theme.of(context).colorScheme.error),
          ),
        ),
      FutureBuilder<List<AuthSession>>(
        future: _sessions,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) {
            return const Padding(
              padding: EdgeInsets.all(24),
              child: Center(child: CircularProgressIndicator()),
            );
          }
          if (snapshot.hasError) {
            return Column(
              children: [
                const Text('Could not load active sessions.'),
                TextButton(
                  onPressed: () =>
                      setState(() => _sessions = _api.activeSessions()),
                  child: const Text('Try again'),
                ),
              ],
            );
          }
          final sessions = snapshot.data ?? const <AuthSession>[];
          if (sessions.isEmpty) {
            return const Text('No active sessions were returned.');
          }
          return Column(
            children: [
              for (final session in sessions)
                Card(
                  child: ListTile(
                    title: Text(session.deviceInfo ?? 'FamShield session'),
                    subtitle: Text(
                      'Started ${_formatDate(session.createdAt)}\n'
                      'Expires ${_formatDate(session.expiresAt)}',
                    ),
                    isThreeLine: true,
                    trailing: IconButton(
                      tooltip: 'Revoke session',
                      onPressed: _busy ? null : () => _revoke(session),
                      icon: const Icon(Icons.delete_outline),
                    ),
                  ),
                ),
            ],
          );
        },
      ),
      const SizedBox(height: 20),
      SizedBox(
        width: double.infinity,
        child: FilledButton.tonal(
          onPressed: _busy ? null : _logoutAll,
          child: const Text('Sign out everywhere'),
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

  String _formatDate(String value) {
    final date = DateTime.tryParse(value)?.toLocal();
    if (date == null) return value;
    return '${date.year}-${date.month.toString().padLeft(2, '0')}-'
        '${date.day.toString().padLeft(2, '0')}';
  }
}
