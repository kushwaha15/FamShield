import { z } from 'zod';

const uuidSchema = z.string().uuid();
const emailSchema = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform((value) => value.toLowerCase());
const phoneSchema = z.string().regex(/^\+[1-9]\d{7,14}$/);

export const familyIdSchema = z.object({ familyId: uuidSchema });
export const familyUserIdSchema = z.object({ familyId: uuidSchema, userId: uuidSchema });
export const familyInvitationIdSchema = z.object({
  familyId: uuidSchema,
  invitationId: uuidSchema,
});
export const createFamilySchema = z.object({
  name: z.string().trim().min(2).max(100),
});
export const createInvitationSchema = z
  .object({
    email: emailSchema.optional(),
    phone: phoneSchema.optional(),
  })
  .refine((value) => Number(Boolean(value.email)) + Number(Boolean(value.phone)) === 1, {
    message: 'Provide exactly one email address or phone number.',
  });
export const invitationTokenSchema = z.object({
  token: z
    .string()
    .min(32)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/),
});
export const transferOwnershipSchema = z.object({
  targetUserId: uuidSchema,
});
