import { z } from 'zod';

export const locationConsentFamilyParamsSchema = z.object({
  familyId: z.string().uuid(),
});

export const grantLocationConsentSchema = z
  .object({
    familyId: z.string().uuid(),
    policyVersion: z.string().min(1).max(32),
    confirmed: z.literal(true),
  })
  .strict();
