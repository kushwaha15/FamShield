import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../features/families/family_providers.dart';
import '../../../features/location/location_providers.dart';
import '../../../models/family.dart';

class FamilyDetailScreen extends ConsumerWidget {
  const FamilyDetailScreen({required this.familyId, super.key});

  final String familyId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final family = ref.watch(familyDetailsProvider(familyId));
    return family.when(
      loading: () =>
          const Scaffold(body: Center(child: CircularProgressIndicator())),
      error: (error, _) => Scaffold(
        appBar: AppBar(title: const Text('Family')),
        body: _LoadError(
          message: error.toString(),
          onRetry: () => ref.invalidate(familyDetailsProvider(familyId)),
        ),
      ),
      data: (value) => _FamilyDetailContent(family: value),
    );
  }
}

class _FamilyDetailContent extends ConsumerStatefulWidget {
  const _FamilyDetailContent({required this.family});

  final FamilySummary family;

  @override
  ConsumerState<_FamilyDetailContent> createState() =>
      _FamilyDetailContentState();
}

class _FamilyDetailContentState extends ConsumerState<_FamilyDetailContent> {
  bool _busy = false;

  bool get _isOwner => widget.family.role == 'owner';

  void _refresh() {
    ref
      ..invalidate(familiesProvider)
      ..invalidate(familyDetailsProvider(widget.family.id))
      ..invalidate(familyMembersProvider(widget.family.id))
      ..invalidate(myInvitationsProvider);
    if (_isOwner) ref.invalidate(familyInvitationsProvider(widget.family.id));
  }

  Future<bool> _confirm(String title, String message, String action) async =>
      await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text(title),
          content: Text(message),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: Text(action),
            ),
          ],
        ),
      ) ??
      false;

  void _message(String message) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  Future<bool> _perform(Future<void> Function() action) async {
    setState(() => _busy = true);
    try {
      await action();
      _refresh();
      return true;
    } catch (error) {
      if (mounted) _message(error.toString());
      return false;
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _createInvitation() async {
    final controller = TextEditingController();
    var method = 'email';
    final contact = await showDialog<({String contact, String method})>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: const Text('Invite a family member'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              DropdownButtonFormField<String>(
                initialValue: method,
                decoration: const InputDecoration(labelText: 'Contact type'),
                items: const [
                  DropdownMenuItem(value: 'email', child: Text('Email')),
                  DropdownMenuItem(value: 'phone', child: Text('Phone')),
                ],
                onChanged: (value) {
                  if (value != null) setDialogState(() => method = value);
                },
              ),
              TextField(
                controller: controller,
                keyboardType: method == 'email'
                    ? TextInputType.emailAddress
                    : TextInputType.phone,
                decoration: InputDecoration(
                  labelText: method == 'email'
                      ? 'Verified email address'
                      : 'Phone in E.164 format',
                ),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () {
                final value = controller.text.trim();
                if (value.isNotEmpty) {
                  Navigator.pop(context, (contact: value, method: method));
                }
              },
              child: const Text('Create invitation'),
            ),
          ],
        ),
      ),
    );
    controller.dispose();
    if (contact == null) return;

    setState(() => _busy = true);
    try {
      final result = await ref
          .read(familyApiProvider)
          .createInvitation(
            widget.family.id,
            email: contact.method == 'email' ? contact.contact : null,
            phone: contact.method == 'phone' ? contact.contact : null,
          );
      _refresh();
      if (mounted) await _showCreatedToken(result);
    } catch (error) {
      if (mounted) _message(error.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _showCreatedToken(CreatedFamilyInvitation result) async {
    await showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Invitation created'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Copy this one-time token and share it only with the invited person. It will not be shown again.',
            ),
            const SizedBox(height: 12),
            SelectableText(result.token),
            const SizedBox(height: 8),
            Text('Expires ${_date(result.invitation.expiresAt)}'),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () async {
              try {
                await Clipboard.setData(ClipboardData(text: result.token));
                if (context.mounted) Navigator.pop(context);
                if (mounted) _message('Invitation token copied.');
              } catch (error) {
                if (mounted) {
                  _message('Unable to copy invitation token: $error');
                }
              }
            },
            child: const Text('Copy token'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Done'),
          ),
        ],
      ),
    );
  }

  Future<void> _removeMember(FamilyMember member) async {
    if (!await _confirm(
      'Remove family member?',
      'Remove ${member.fullName} from ${widget.family.name}?',
      'Remove',
    )) {
      return;
    }
    final removed = await _perform(
      () => ref
          .read(familyApiProvider)
          .removeMember(widget.family.id, member.userId),
    );
    if (removed && mounted) _message('${member.fullName} was removed.');
  }

  Future<void> _revokeInvitation(FamilyInvitation invitation) async {
    if (!await _confirm(
      'Revoke invitation?',
      'This invitation link will no longer work.',
      'Revoke',
    )) {
      return;
    }
    final revoked = await _perform(
      () => ref
          .read(familyApiProvider)
          .revokeInvitation(widget.family.id, invitation.id),
    );
    if (revoked && mounted) _message('Invitation revoked.');
  }

  Future<void> _leaveFamily() async {
    if (!await _confirm(
      'Leave family?',
      'You will need a new invitation to rejoin.',
      'Leave',
    )) {
      return;
    }
    final left = await _perform(
      () async {
        await ref
            .read(locationSharingProvider.notifier)
            .stopForFamily(widget.family.id);
        await ref.read(familyApiProvider).leaveFamily(widget.family.id);
      },
    );
    if (left && mounted) context.go('/families');
  }

  Future<void> _transferOwnership(List<FamilyMember> members) async {
    final candidates = members
        .where((member) => member.role == 'member')
        .toList();
    if (candidates.isEmpty) return;
    final targetUserId = await showDialog<String>(
      context: context,
      builder: (context) => SimpleDialog(
        title: const Text('Transfer ownership to'),
        children: candidates
            .map(
              (member) => SimpleDialogOption(
                onPressed: () => Navigator.pop(context, member.userId),
                child: Text(member.fullName),
              ),
            )
            .toList(),
      ),
    );
    if (targetUserId == null) return;
    final target = candidates.firstWhere(
      (member) => member.userId == targetUserId,
    );
    if (!await _confirm(
      'Confirm ownership transfer?',
      '${target.fullName} will become the owner. You will remain a member.',
      'Transfer',
    )) {
      return;
    }
    final transferred = await _perform(
      () => ref
          .read(familyApiProvider)
          .transferOwnership(widget.family.id, targetUserId),
    );
    if (transferred && mounted) {
      _message('Ownership transferred to ${target.fullName}.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final members = ref.watch(familyMembersProvider(widget.family.id));
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.family.name),
        actions: [
          IconButton(
            tooltip: 'Back to families',
            onPressed: () => context.go('/families'),
            icon: const Icon(Icons.groups_outlined),
          ),
        ],
      ),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 760),
            child: members.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (error, _) => _LoadError(
                message: error.toString(),
                onRetry: () =>
                    ref.invalidate(familyMembersProvider(widget.family.id)),
              ),
              data: (items) => ListView(
                padding: const EdgeInsets.all(20),
                children: [
                  Text(
                    'Active members',
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                  const SizedBox(height: 8),
                  FilledButton.icon(
                    onPressed: () => context.go(
                      '/families/${widget.family.id}/location',
                    ),
                    icon: const Icon(Icons.location_on_outlined),
                    label: const Text('Share or view current locations'),
                  ),
                  const SizedBox(height: 8),
                  if (items.isEmpty)
                    const Card(
                      child: Padding(
                        padding: EdgeInsets.all(16),
                        child: Text('No active members.'),
                      ),
                    ),
                  ...items.map(
                    (member) => Card(
                      child: ListTile(
                        leading: CircleAvatar(
                          child: Text(
                            member.fullName.isEmpty
                                ? '?'
                                : member.fullName.substring(0, 1),
                          ),
                        ),
                        title: Text(member.fullName),
                        subtitle: Text(
                          '${member.role} · joined ${_date(member.joinedAt)}',
                        ),
                        trailing: _isOwner && member.role == 'member'
                            ? PopupMenuButton<String>(
                                tooltip: 'Member actions',
                                onSelected: (value) {
                                  if (value == 'remove') {
                                    _removeMember(member);
                                  }
                                },
                                itemBuilder: (context) => const [
                                  PopupMenuItem(
                                    value: 'remove',
                                    child: Text('Remove member'),
                                  ),
                                ],
                              )
                            : null,
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  if (_isOwner) ...[
                    FilledButton.icon(
                      onPressed: _busy ? null : _createInvitation,
                      icon: const Icon(Icons.person_add_alt_1),
                      label: const Text('Invite a member'),
                    ),
                    if (items.any((member) => member.role == 'member'))
                      OutlinedButton.icon(
                        onPressed: _busy
                            ? null
                            : () => _transferOwnership(items),
                        icon: const Icon(Icons.swap_horiz),
                        label: const Text('Transfer ownership'),
                      ),
                    _OwnerInvitations(
                      familyId: widget.family.id,
                      onRevoke: _busy ? null : _revokeInvitation,
                    ),
                  ] else
                    OutlinedButton.icon(
                      onPressed: _busy ? null : _leaveFamily,
                      icon: const Icon(Icons.logout),
                      label: const Text('Leave family'),
                    ),
                  const Card(
                    child: Padding(
                      padding: EdgeInsets.all(16),
                      child: Text(
                        'Family membership does not grant location access or enable location sharing.',
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _OwnerInvitations extends ConsumerWidget {
  const _OwnerInvitations({required this.familyId, required this.onRevoke});

  final String familyId;
  final Future<void> Function(FamilyInvitation)? onRevoke;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final invitations = ref.watch(familyInvitationsProvider(familyId));
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Pending invitations',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            invitations.when(
              loading: () => const LinearProgressIndicator(),
              error: (error, _) => Text(error.toString()),
              data: (items) => items.isEmpty
                  ? const Text('No pending invitations.')
                  : Column(
                      children: items
                          .map(
                            (invitation) => ListTile(
                              contentPadding: EdgeInsets.zero,
                              title: Text(
                                invitation.inviteeEmail ??
                                    invitation.inviteePhone ??
                                    'Invitee',
                              ),
                              subtitle: Text(
                                'Expires ${_date(invitation.expiresAt)}',
                              ),
                              trailing: IconButton(
                                tooltip: 'Revoke invitation',
                                onPressed: onRevoke == null
                                    ? null
                                    : () => onRevoke!(invitation),
                                icon: const Icon(Icons.cancel_outlined),
                              ),
                            ),
                          )
                          .toList(),
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

class _LoadError extends StatelessWidget {
  const _LoadError({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(message, textAlign: TextAlign.center),
          const SizedBox(height: 8),
          TextButton(onPressed: onRetry, child: const Text('Try again')),
        ],
      ),
    ),
  );
}

String _date(String value) {
  final date = DateTime.tryParse(value);
  if (date == null) return 'unavailable';
  final local = date.toLocal();
  return '${local.year}-${local.month.toString().padLeft(2, '0')}-'
      '${local.day.toString().padLeft(2, '0')}';
}
