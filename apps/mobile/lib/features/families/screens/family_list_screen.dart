import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../features/families/family_providers.dart';
import '../../../models/family.dart';

class FamilyListScreen extends ConsumerStatefulWidget {
  const FamilyListScreen({this.invitationToken, super.key});

  final String? invitationToken;

  @override
  ConsumerState<FamilyListScreen> createState() => _FamilyListScreenState();
}

class _FamilyListScreenState extends ConsumerState<FamilyListScreen> {
  late final TextEditingController _invitationToken;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _invitationToken = TextEditingController(
      text: widget.invitationToken ?? '',
    );
  }

  @override
  void dispose() {
    _invitationToken.dispose();
    super.dispose();
  }

  void _invalidateFamilyLists() {
    ref
      ..invalidate(familiesProvider)
      ..invalidate(myInvitationsProvider);
  }

  Future<void> _createFamily() async {
    final controller = TextEditingController();
    final name = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Create a family'),
        content: TextField(
          controller: controller,
          autofocus: true,
          maxLength: 100,
          decoration: const InputDecoration(labelText: 'Family name'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, controller.text.trim()),
            child: const Text('Create'),
          ),
        ],
      ),
    );
    controller.dispose();
    if (name == null || name.length < 2) {
      if (name != null) {
        _showMessage('Enter a family name with at least 2 characters.');
      }
      return;
    }
    setState(() => _busy = true);
    try {
      final family = await ref.read(familyApiProvider).createFamily(name);
      _invalidateFamilyLists();
      if (mounted) context.push('/families/${family.id}');
    } catch (error) {
      if (mounted) _showMessage(error.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _acceptInvitation() async {
    final token = _invitationToken.text.trim();
    if (token.isEmpty) return;
    setState(() => _busy = true);
    try {
      final family = await ref.read(familyApiProvider).acceptInvitation(token);
      _invitationToken.clear();
      _invalidateFamilyLists();
      if (mounted) {
        if (widget.invitationToken != null) context.go('/families');
        _showMessage(
          'You joined ${family.name}. Location sharing remains off.',
        );
      }
    } catch (error) {
      if (mounted) _showMessage(error.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _declineInvitation() async {
    final token = _invitationToken.text.trim();
    if (token.isEmpty) return;
    final shouldDecline = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Decline invitation?'),
        content: const Text('This invitation will no longer be usable.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Decline'),
          ),
        ],
      ),
    );
    if (shouldDecline != true) return;
    setState(() => _busy = true);
    try {
      await ref.read(familyApiProvider).declineInvitation(token);
      _invitationToken.clear();
      _invalidateFamilyLists();
      if (mounted) {
        if (widget.invitationToken != null) context.go('/families');
        _showMessage('The invitation was declined.');
      }
    } catch (error) {
      if (mounted) _showMessage(error.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _showMessage(String message) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    final families = ref.watch(familiesProvider);
    final invitations = ref.watch(myInvitationsProvider);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Your families'),
        actions: [
          IconButton(
            tooltip: 'Profile',
            onPressed: () => context.go('/profile'),
            icon: const Icon(Icons.person_outline),
          ),
        ],
      ),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 760),
            child: ListView(
              padding: const EdgeInsets.all(20),
              children: [
                Text(
                  'Family management',
                  style: Theme.of(context).textTheme.headlineSmall,
                ),
                const SizedBox(height: 8),
                const Text(
                  'Manage family membership and invitations. Joining a family never enables location sharing.',
                ),
                const SizedBox(height: 20),
                invitations.when(
                  loading: () => const Card(
                    child: Padding(
                      padding: EdgeInsets.all(16),
                      child: LinearProgressIndicator(),
                    ),
                  ),
                  error: (error, _) => _ErrorCard(
                    message: error.toString(),
                    onRetry: () => ref.invalidate(myInvitationsProvider),
                  ),
                  data: (items) => items.isEmpty
                      ? const SizedBox.shrink()
                      : _InvitationList(invitations: items),
                ),
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Text(
                          'Invitation link',
                          style: Theme.of(context).textTheme.titleMedium,
                        ),
                        const SizedBox(height: 8),
                        TextField(
                          controller: _invitationToken,
                          decoration: const InputDecoration(
                            labelText: 'Invitation token',
                            hintText:
                                'Paste the token from your invitation link',
                          ),
                        ),
                        const SizedBox(height: 12),
                        Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          children: [
                            FilledButton(
                              onPressed: _busy ? null : _acceptInvitation,
                              child: const Text('Accept invitation'),
                            ),
                            OutlinedButton(
                              onPressed: _busy ? null : _declineInvitation,
                              child: const Text('Decline'),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        'Family groups',
                        style: Theme.of(context).textTheme.titleLarge,
                      ),
                    ),
                    FilledButton.icon(
                      onPressed: _busy ? null : _createFamily,
                      icon: const Icon(Icons.add),
                      label: const Text('Create'),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                families.when(
                  loading: () => const Padding(
                    padding: EdgeInsets.all(24),
                    child: Center(child: CircularProgressIndicator()),
                  ),
                  error: (error, _) => _ErrorCard(
                    message: error.toString(),
                    onRetry: () => ref.invalidate(familiesProvider),
                  ),
                  data: (items) => items.isEmpty
                      ? const Card(
                          child: Padding(
                            padding: EdgeInsets.all(20),
                            child: Text('You have not joined a family yet.'),
                          ),
                        )
                      : Column(
                          children: items
                              .map(
                                (family) => _FamilyCard(
                                  family: family,
                                  onTap: () =>
                                      context.push('/families/${family.id}'),
                                ),
                              )
                              .toList(),
                        ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _FamilyCard extends StatelessWidget {
  const _FamilyCard({required this.family, required this.onTap});

  final FamilySummary family;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Card(
    child: ListTile(
      title: Text(family.name),
      subtitle: Text('Role: ${family.role ?? 'member'}'),
      trailing: const Icon(Icons.chevron_right),
      onTap: onTap,
    ),
  );
}

class _InvitationList extends StatelessWidget {
  const _InvitationList({required this.invitations});

  final List<FamilyInvitation> invitations;

  @override
  Widget build(BuildContext context) => Card(
    child: Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Invitations for you',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 8),
          ...invitations.map(
            (invitation) => ListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(invitation.familyName ?? 'Family invitation'),
              subtitle: Text(
                'Invited by ${invitation.inviterName ?? 'a family member'}. '
                'Use the original link or paste its token to respond.',
              ),
            ),
          ),
        ],
      ),
    ),
  );
}

class _ErrorCard extends StatelessWidget {
  const _ErrorCard({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => Card(
    color: Theme.of(context).colorScheme.errorContainer,
    child: Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(message),
          const SizedBox(height: 8),
          TextButton(onPressed: onRetry, child: const Text('Try again')),
        ],
      ),
    ),
  );
}
