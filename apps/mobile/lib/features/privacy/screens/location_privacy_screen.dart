import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../features/location/location_providers.dart';
import '../../../features/privacy/privacy_providers.dart';
import '../../../models/location_consent.dart';

class LocationPrivacyScreen extends ConsumerStatefulWidget {
  const LocationPrivacyScreen({super.key});

  @override
  ConsumerState<LocationPrivacyScreen> createState() =>
      _LocationPrivacyScreenState();
}

class _LocationPrivacyScreenState extends ConsumerState<LocationPrivacyScreen> {
  String? _selectedFamilyId;
  bool _confirmed = false;
  bool _busy = false;
  String? _message;
  String? _error;

  Future<void> _grant(LocationConsentState consent) async {
    final familyId = _selectedFamilyId;
    if (familyId == null || !_confirmed || _busy) return;
    setState(() {
      _busy = true;
      _error = null;
      _message = null;
    });
    try {
      await ref
          .read(locationConsentApiProvider)
          .grant(
            familyId: familyId,
            policyVersion: consent.policyVersion,
            confirmed: _confirmed,
          );
      ref
        ..invalidate(locationConsentProvider)
        ..invalidate(locationConsentHistoryProvider);
      if (mounted) {
        setState(() {
          _confirmed = false;
          _message = 'Location-sharing consent enabled for this family.';
        });
      }
    } catch (error) {
      ref
        ..invalidate(locationConsentProvider)
        ..invalidate(locationConsentHistoryProvider);
      if (mounted) {
        setState(() {
          _confirmed = false;
          _error = error.toString();
        });
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _revoke(LocationConsentScope scope) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Revoke location-sharing consent?'),
        content: Text(
          'Future location sharing with active members of ${scope.familyName} will no longer be authorized.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Keep enabled'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Revoke consent'),
          ),
        ],
      ),
    );
    if (confirmed != true || _busy) return;
    setState(() {
      _busy = true;
      _error = null;
      _message = null;
    });
    try {
      await ref
          .read(locationSharingProvider.notifier)
          .revokeConsent(scope.familyId);
      ref
        ..invalidate(locationConsentProvider)
        ..invalidate(locationConsentHistoryProvider);
      if (mounted) {
        setState(() => _message = 'Location-sharing consent revoked.');
      }
    } catch (error) {
      ref
        ..invalidate(locationConsentProvider)
        ..invalidate(locationConsentHistoryProvider);
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final consent = ref.watch(locationConsentProvider);
    final history = ref.watch(locationConsentHistoryProvider);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Location sharing privacy'),
        actions: [
          IconButton(
            tooltip: 'Dashboard',
            onPressed: () => context.go('/dashboard'),
            icon: const Icon(Icons.home_outlined),
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
                  'Your consent, your choice',
                  style: Theme.of(context).textTheme.headlineSmall,
                ),
                const SizedBox(height: 12),
                const Text(
                  'Active consent authorizes sharing your current location with active members of that family. GPS permission is requested only after you press Start Sharing. Collection stops when the app is inactive, and no location history is stored. '
                  'Family owners cannot enable consent for you, and you can revoke it at any time.',
                ),
                if (_error != null) ...[
                  const SizedBox(height: 12),
                  _MessageCard(message: _error!, isError: true),
                ],
                if (_message != null) ...[
                  const SizedBox(height: 12),
                  _MessageCard(message: _message!),
                ],
                const SizedBox(height: 16),
                consent.when(
                  loading: () => const Card(
                    child: Padding(
                      padding: EdgeInsets.all(20),
                      child: Center(child: CircularProgressIndicator()),
                    ),
                  ),
                  error: (error, _) => _RetryCard(
                    message: error.toString(),
                    onRetry: () => ref.invalidate(locationConsentProvider),
                  ),
                  data: (value) => _buildScopes(value),
                ),
                const SizedBox(height: 16),
                history.when(
                  loading: () => const Card(
                    child: Padding(
                      padding: EdgeInsets.all(16),
                      child: LinearProgressIndicator(),
                    ),
                  ),
                  error: (error, _) => _RetryCard(
                    message: error.toString(),
                    onRetry: () =>
                        ref.invalidate(locationConsentHistoryProvider),
                  ),
                  data: _buildHistory,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildScopes(LocationConsentState consent) {
    final scopes = consent.scopes;
    if (scopes.isEmpty) {
      return const Card(
        child: Padding(
          padding: EdgeInsets.all(18),
          child: Text(
            'No active family memberships. Joining a family will not enable location sharing.',
          ),
        ),
      );
    }
    final selectedId =
        scopes.any((scope) => scope.familyId == _selectedFamilyId)
        ? _selectedFamilyId!
        : scopes.first.familyId;
    final selected = scopes.firstWhere((scope) => scope.familyId == selectedId);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'Current consent by family',
              style: Theme.of(context).textTheme.titleLarge,
            ),
            const SizedBox(height: 8),
            for (final scope in scopes)
              ListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(scope.familyName),
                subtitle: Text(
                  scope.enabled
                      ? 'Enabled'
                      : scope.needsReview
                      ? 'Policy updated — review required'
                      : 'Off',
                ),
                trailing: scope.enabled || scope.needsReview
                    ? OutlinedButton(
                        onPressed: _busy ? null : () => _revoke(scope),
                        child: Text(
                          scope.enabled ? 'Revoke' : 'Clear old consent',
                        ),
                      )
                    : null,
              ),
            const Divider(),
            Text(
              'Enable sharing for a family',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            DropdownButtonFormField<String>(
              initialValue: selectedId,
              decoration: const InputDecoration(labelText: 'Family'),
              items: [
                for (final scope in scopes)
                  DropdownMenuItem(
                    value: scope.familyId,
                    child: Text(scope.familyName),
                  ),
              ],
              onChanged: _busy
                  ? null
                  : (value) => setState(() {
                      _selectedFamilyId = value;
                      _confirmed = false;
                    }),
            ),
            CheckboxListTile(
              contentPadding: EdgeInsets.zero,
              value: _confirmed,
              onChanged: _busy
                  ? null
                  : (value) => setState(() => _confirmed = value ?? false),
              title: Text(
                'I understand and explicitly authorize future location sharing with active members of ${selected.familyName}. I can revoke this consent at any time.',
              ),
              controlAffinity: ListTileControlAffinity.leading,
            ),
            FilledButton(
              onPressed: _busy || !_confirmed || selected.enabled
                  ? null
                  : () => _grant(consent),
              child: Text(
                _busy ? 'Saving…' : 'Enable location-sharing consent',
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildHistory(List<LocationConsentHistoryEntry> items) {
    if (items.isEmpty) {
      return const Card(
        child: Padding(
          padding: EdgeInsets.all(18),
          child: Text('No location-sharing consent changes yet.'),
        ),
      );
    }
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Consent history',
              style: Theme.of(context).textTheme.titleLarge,
            ),
            const SizedBox(height: 8),
            for (final entry in items)
              ListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(switch (entry.status) {
                  'granted' => 'Granted',
                  'revoked' => 'Revoked',
                  _ => 'Not enabled',
                }),
                subtitle: Text(
                  '${_familyName(entry.familyId)} · Policy ${entry.policyVersion} · '
                  '${_formatDate(switch (entry.status) {
                    'granted' => entry.grantedAt,
                    'revoked' => entry.revokedAt,
                    _ => entry.recordedAt,
                  })}',
                ),
              ),
          ],
        ),
      ),
    );
  }

  String _formatDate(String? value) {
    if (value == null) return 'Date unavailable';
    final date = DateTime.tryParse(value)?.toLocal();
    if (date == null) return 'Date unavailable';
    return '${date.year}-${date.month.toString().padLeft(2, '0')}-'
        '${date.day.toString().padLeft(2, '0')}';
  }

  String _familyName(String? familyId) {
    if (familyId == null) return 'Previous unscoped consent';
    final scopes = ref.read(locationConsentProvider).asData?.value.scopes;
    if (scopes != null) {
      for (final scope in scopes) {
        if (scope.familyId == familyId) return scope.familyName;
      }
    }
    return 'Former or unavailable family';
  }
}

class _MessageCard extends StatelessWidget {
  const _MessageCard({required this.message, this.isError = false});

  final String message;
  final bool isError;

  @override
  Widget build(BuildContext context) => Card(
    color: isError
        ? Theme.of(context).colorScheme.errorContainer
        : Theme.of(context).colorScheme.secondaryContainer,
    child: Padding(padding: const EdgeInsets.all(14), child: Text(message)),
  );
}

class _RetryCard extends StatelessWidget {
  const _RetryCard({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => Card(
    child: Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        children: [
          Text(message),
          TextButton(onPressed: onRetry, child: const Text('Try again')),
        ],
      ),
    ),
  );
}
