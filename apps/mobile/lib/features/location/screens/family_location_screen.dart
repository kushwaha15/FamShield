import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../features/families/family_providers.dart';
import '../../../features/location/location_providers.dart';
import '../../../features/privacy/privacy_providers.dart';
import '../../../models/family_location.dart';
import '../../../models/location_consent.dart';
import '../../../services/location_realtime_client.dart';

class FamilyLocationScreen extends ConsumerStatefulWidget {
  const FamilyLocationScreen({required this.familyId, super.key});

  final String familyId;

  @override
  ConsumerState<FamilyLocationScreen> createState() =>
      _FamilyLocationScreenState();
}

class _FamilyLocationScreenState extends ConsumerState<FamilyLocationScreen> {
  LocationRealtimeSubscription? _subscription;
  String? _realtimeError;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _subscribe());
  }

  Future<void> _subscribe() async {
    try {
      final subscription = await ref
          .read(locationRealtimeClientProvider)
          .subscribe(
            familyId: widget.familyId,
            onChanged: () {
              if (mounted) {
                ref.invalidate(familyLocationsProvider(widget.familyId));
              }
            },
            onInvalidated: () {
              if (mounted) {
                ref.invalidate(familyLocationsProvider(widget.familyId));
              }
            },
          );
      if (!mounted) {
        subscription.dispose();
        return;
      }
      _subscription?.dispose();
      setState(() {
        _subscription = subscription;
        _realtimeError = null;
      });
    } catch (_) {
      if (mounted) {
        setState(() {
          _realtimeError = 'Realtime refresh is unavailable. Use Refresh to check current locations.';
        });
      }
    }
  }

  @override
  void dispose() {
    _subscription?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final family = ref.watch(familyDetailsProvider(widget.familyId));
    final consent = ref.watch(locationConsentProvider);
    final sharing = ref.watch(locationSharingProvider);
    final locations = ref.watch(familyLocationsProvider(widget.familyId));

    ref.listen(locationSharingProvider, (previous, next) {
      if (next.message != null && previous?.message != next.message) {
        ScaffoldMessenger.of(context)
          ..hideCurrentSnackBar()
          ..showSnackBar(SnackBar(content: Text(next.message!)));
      }
    });

    return Scaffold(
      appBar: AppBar(
        title: const Text('Family location sharing'),
        actions: [
          IconButton(
            tooltip: 'Location privacy',
            onPressed: () => context.go('/privacy'),
            icon: const Icon(Icons.privacy_tip_outlined),
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
                  'Share and view current locations',
                  style: Theme.of(context).textTheme.headlineSmall,
                ),
                const SizedBox(height: 8),
                const Text(
                  'FamShield collects location only after you grant active consent and press Start Sharing. Collection runs only while this app is active. You can pause, stop, or revoke consent at any time. No location history is stored.',
                ),
                const SizedBox(height: 16),
                family.when(
                  loading: () => const LinearProgressIndicator(),
                  error: (error, _) => _InfoCard(
                    child: Text('Family information is unavailable: $error'),
                  ),
                  data: (value) => _consentAndControls(
                    familyName: value.name,
                    consent: consent,
                    sharing: sharing,
                  ),
                ),
                if (_realtimeError != null) ...[
                  const SizedBox(height: 12),
                  _InfoCard(child: Text(_realtimeError!)),
                ],
                const SizedBox(height: 24),
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        'Current shared locations',
                        style: Theme.of(context).textTheme.titleLarge,
                      ),
                    ),
                    IconButton(
                      tooltip: 'Refresh current locations',
                      onPressed: () => ref.invalidate(
                        familyLocationsProvider(widget.familyId),
                      ),
                      icon: const Icon(Icons.refresh),
                    ),
                  ],
                ),
                const Text(
                  'Only active family members who currently consent to sharing and have a valid sharing session are shown.',
                ),
                const SizedBox(height: 8),
                locations.when(
                  loading: () => const Padding(
                    padding: EdgeInsets.all(20),
                    child: Center(child: CircularProgressIndicator()),
                  ),
                  error: (error, _) => _InfoCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Unable to load authorized family locations: $error',
                        ),
                        TextButton(
                          onPressed: () => ref.invalidate(
                            familyLocationsProvider(widget.familyId),
                          ),
                          child: const Text('Try again'),
                        ),
                      ],
                    ),
                  ),
                  data: (items) => _buildLocations(items),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _consentAndControls({
    required String familyName,
    required AsyncValue<LocationConsentState> consent,
    required LocationSharingState sharing,
  }) {
    final scopes = consent.asData?.value.scopes;
    final matchingScopes = scopes
        ?.where((entry) => entry.familyId == widget.familyId)
        .toList();
    final scope = matchingScopes == null || matchingScopes.isEmpty
        ? null
        : matchingScopes.first;
    final hasActiveConsent = scope?.enabled == true;
    final currentFamilySession = sharing.familyId == widget.familyId;

    return _InfoCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Consent status for $familyName',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 8),
          if (consent.isLoading)
            const LinearProgressIndicator()
          else if (consent.hasError)
            Text('Consent status could not be verified: ${consent.error}')
          else
            Text(
              hasActiveConsent
                  ? 'Active. Sharing is still off until you press Start Sharing.'
                  : 'Not active. Family membership does not enable consent.',
            ),
          if (!hasActiveConsent)
            TextButton.icon(
              onPressed: () => context.go('/privacy'),
              icon: const Icon(Icons.privacy_tip_outlined),
              label: const Text('Review or grant consent'),
            ),
          if (hasActiveConsent)
            OutlinedButton.icon(
              onPressed: sharing.isBusy
                  ? null
                  : () => _confirmRevokeConsent(familyName),
              icon: const Icon(Icons.block_outlined),
              label: const Text('Revoke Consent'),
            ),
          if (sharing.hasSession && !currentFamilySession)
            const Text(
              'Sharing is active for another family. Stop that session before starting a new one.',
            ),
          if (!currentFamilySession)
            FilledButton.icon(
              onPressed:
                  sharing.hasSession ||
                      !hasActiveConsent ||
                      consent.isLoading ||
                      consent.hasError ||
                      sharing.isBusy
                  ? null
                  : () => ref
                        .read(locationSharingProvider.notifier)
                        .startSharing(
                          familyId: widget.familyId,
                          familyName: familyName,
                        ),
              icon: const Icon(Icons.location_on_outlined),
              label: const Text('Start Sharing'),
            )
          else if (sharing.isSharing) ...[
            FilledButton.tonalIcon(
              onPressed: sharing.isBusy
                  ? null
                  : () => ref
                        .read(locationSharingProvider.notifier)
                        .pauseSharing(),
              icon: const Icon(Icons.pause),
              label: const Text('Pause Sharing'),
            ),
            OutlinedButton.icon(
              onPressed: sharing.isBusy
                  ? null
                  : () => ref
                        .read(locationSharingProvider.notifier)
                        .stopSharing(),
              icon: const Icon(Icons.stop),
              label: const Text('Stop Sharing'),
            ),
          ] else if (sharing.hasSession) ...[
            FilledButton.icon(
              onPressed:
                  sharing.isBusy ||
                      !hasActiveConsent ||
                      consent.isLoading ||
                      consent.hasError
                  ? null
                  : () => ref
                        .read(locationSharingProvider.notifier)
                        .resumeSharing(),
              icon: const Icon(Icons.play_arrow),
              label: const Text('Resume Sharing'),
            ),
            OutlinedButton.icon(
              onPressed: sharing.isBusy
                  ? null
                  : () => ref
                        .read(locationSharingProvider.notifier)
                        .stopSharing(),
              icon: const Icon(Icons.stop),
              label: const Text('Stop Sharing'),
            ),
          ],
          if (sharing.approximatePermission && currentFamilySession)
            const Text('Android has granted approximate location access.'),
          if (sharing.error != null)
            Text(
              sharing.error!,
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
        ],
      ),
    );
  }

  Future<void> _confirmRevokeConsent(String familyName) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Revoke location consent?'),
        content: Text(
          'FamShield will stop collecting your location and revoke sharing consent for $familyName.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Keep consent'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Revoke Consent'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    try {
      await ref
          .read(locationSharingProvider.notifier)
          .revokeConsent(widget.familyId);
      ref
        ..invalidate(locationConsentProvider)
        ..invalidate(locationConsentHistoryProvider)
        ..invalidate(familyLocationsProvider(widget.familyId));
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Unable to revoke consent: $error')),
        );
      }
    }
  }

  Widget _buildLocations(List<FamilyLocation> locations) {
    if (locations.isEmpty) {
      return const _InfoCard(
        child: Text('No family member is currently sharing a location.'),
      );
    }
    return Column(
      children: [
        for (final location in locations)
          Card(
            child: ListTile(
              leading: const Icon(Icons.location_on_outlined),
              title: Text(location.fullName),
              subtitle: Text(
                '${location.status == 'stale' ? 'Last known' : 'Current'} · '
                '${location.latitude.toStringAsFixed(4)}, '
                '${location.longitude.toStringAsFixed(4)} · '
                '±${location.accuracyMeters.toStringAsFixed(0)} m · '
                '${_formatDate(location.recordedAt)}',
              ),
              isThreeLine: true,
              titleAlignment: ListTileTitleAlignment.top,
              contentPadding: const EdgeInsets.all(16),
              subtitleTextStyle: Theme.of(context).textTheme.bodySmall,
            ),
          ),
      ],
    );
  }

  String _formatDate(DateTime value) {
    final local = value.toLocal();
    final hour = local.hour.toString().padLeft(2, '0');
    final minute = local.minute.toString().padLeft(2, '0');
    return '${local.year}-${local.month.toString().padLeft(2, '0')}-'
        '${local.day.toString().padLeft(2, '0')} $hour:$minute';
  }
}

class _InfoCard extends StatelessWidget {
  const _InfoCard({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) => Card(
    child: Padding(padding: const EdgeInsets.all(16), child: child),
  );
}
