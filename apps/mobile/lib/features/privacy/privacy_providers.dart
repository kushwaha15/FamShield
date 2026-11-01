import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../features/auth/auth_state.dart';
import '../../models/location_consent.dart';
import '../../services/location_consent_api.dart';

final locationConsentApiProvider = Provider<LocationConsentApi>(
  (ref) => LocationConsentApi(ref.watch(authApiProvider)),
);

final locationConsentProvider = FutureProvider<LocationConsentState>(
  (ref) => ref.watch(locationConsentApiProvider).getConsent(),
);

final locationConsentHistoryProvider =
    FutureProvider<List<LocationConsentHistoryEntry>>(
      (ref) => ref.watch(locationConsentApiProvider).getHistory(),
    );
