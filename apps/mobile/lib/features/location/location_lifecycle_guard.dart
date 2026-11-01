import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'location_providers.dart';

class LocationLifecycleGuard extends ConsumerStatefulWidget {
  const LocationLifecycleGuard({required this.child, super.key});

  final Widget child;

  @override
  ConsumerState<LocationLifecycleGuard> createState() =>
      _LocationLifecycleGuardState();
}

class _LocationLifecycleGuardState
    extends ConsumerState<LocationLifecycleGuard>
    with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    ref
        .read(locationSharingProvider.notifier)
        .onLifecycleChanged(isResumed: state == AppLifecycleState.resumed);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final sharing = ref.watch(locationSharingProvider);
    return Column(
      children: [
        if (sharing.isSharing)
          Material(
            color: Theme.of(context).colorScheme.secondaryContainer,
            child: SafeArea(
              bottom: false,
              child: SizedBox(
                width: double.infinity,
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 16,
                    vertical: 10,
                  ),
                  child: Row(
                    children: [
                      Icon(
                        Icons.location_on,
                        color: Theme.of(context).colorScheme.onSecondaryContainer,
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          'Location sharing is active for ${sharing.familyName ?? 'your family'}.',
                          style: Theme.of(context).textTheme.labelLarge,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        Expanded(child: widget.child),
      ],
    );
  }
}
