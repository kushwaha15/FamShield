import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../features/auth/auth_state.dart';
import '../../models/family.dart';
import '../../services/family_api.dart';

final familyApiProvider = Provider<FamilyApi>(
  (ref) => FamilyApi(ref.watch(authApiProvider)),
);

final familiesProvider = FutureProvider<List<FamilySummary>>(
  (ref) => ref.watch(familyApiProvider).getFamilies(),
);

final familyDetailsProvider = FutureProvider.family<FamilySummary, String>(
  (ref, familyId) => ref.watch(familyApiProvider).getFamily(familyId),
);

final familyMembersProvider = FutureProvider.family<List<FamilyMember>, String>(
  (ref, familyId) => ref.watch(familyApiProvider).getFamilyMembers(familyId),
);

final familyInvitationsProvider =
    FutureProvider.family<List<FamilyInvitation>, String>(
      (ref, familyId) =>
          ref.watch(familyApiProvider).getFamilyInvitations(familyId),
    );

final myInvitationsProvider = FutureProvider<List<FamilyInvitation>>(
  (ref) => ref.watch(familyApiProvider).getMyInvitations(),
);
