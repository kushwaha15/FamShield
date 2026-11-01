import { z } from 'zod';

const emailSchema = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform((email) => email.toLowerCase());
const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{7,14}$/, 'Use an E.164 phone number.');
const passwordSchema = z
  .string()
  .min(12)
  .max(128)
  .regex(/[a-z]/, 'Password must contain a lowercase letter.')
  .regex(/[A-Z]/, 'Password must contain an uppercase letter.')
  .regex(/\d/, 'Password must contain a number.')
  .regex(/[^A-Za-z0-9]/, 'Password must contain a symbol.')
  .refine((password) => Buffer.byteLength(password, 'utf8') <= 72, {
    message: 'Password is too long.',
  });

export const registrationSchema = z
  .object({
    fullName: z.string().trim().min(2).max(100),
    email: emailSchema,
    phone: phoneSchema,
    password: passwordSchema,
    passwordConfirmation: z.string(),
    acceptTerms: z.literal(true),
    acceptPrivacy: z.literal(true),
  })
  .strict()
  .refine((value) => value.password === value.passwordConfirmation, {
    path: ['passwordConfirmation'],
    message: 'Passwords do not match.',
  });

export const identifierSchema = z
  .string()
  .trim()
  .min(3)
  .max(254)
  .transform((value) => (value.includes('@') ? value.toLowerCase() : value))
  .refine((value) => value.includes('@') || /^\+[1-9]\d{7,14}$/.test(value), {
    message: 'Enter a valid email address or E.164 phone number.',
  });

export const verificationSchema = z
  .object({
    email: emailSchema.optional(),
    phone: phoneSchema.optional(),
    code: z.string().regex(/^\d{6}$/),
  })
  .strict()
  .refine((value) => Boolean(value.email) !== Boolean(value.phone), {
    message: 'Provide exactly one email or phone number.',
  });

export const resendOtpSchema = z
  .object({
    identifier: identifierSchema,
    purpose: z.enum(['verify_email', 'verify_phone']),
  })
  .strict();

export const loginSchema = z
  .object({
    identifier: identifierSchema,
    password: z.string().min(1).max(128),
    clientType: z.enum(['web', 'mobile']).default('mobile'),
    deviceInfo: z.string().trim().max(256).optional(),
  })
  .strict();

export const refreshSchema = z
  .object({
    refreshToken: z.string().min(32).max(256).optional(),
  })
  .strict();

export const forgotPasswordSchema = z
  .object({
    identifier: identifierSchema,
    channel: z.enum(['email', 'phone']),
  })
  .strict();

export const resetPasswordSchema = z
  .object({
    identifier: identifierSchema,
    code: z.string().regex(/^\d{6}$/),
    password: passwordSchema,
    passwordConfirmation: z.string(),
  })
  .strict()
  .refine((value) => value.password === value.passwordConfirmation, {
    path: ['passwordConfirmation'],
    message: 'Passwords do not match.',
  });

export const profileUpdateSchema = z
  .object({
    fullName: z.string().trim().min(2).max(100).optional(),
    profileImageUrl: z
      .string()
      .url()
      .max(2048)
      .refine((url) => new URL(url).protocol === 'https:', 'Profile image URL must use HTTPS.')
      .nullable()
      .optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one profile field is required.',
  });

export const deleteAccountSchema = z
  .object({
    password: z.string().min(1).max(128),
  })
  .strict();

export type RegistrationInput = z.infer<typeof registrationSchema>;
export type ClientType = 'web' | 'mobile';
