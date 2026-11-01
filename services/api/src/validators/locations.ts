import { z } from 'zod';

const uuid = z.string().uuid();

export const locationFamilyParamsSchema = z.object({ familyId: uuid });
export const locationSessionParamsSchema = z.object({
  familyId: uuid,
  sessionId: uuid,
});

export const locationPositionSchema = z
  .object({
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
    accuracyMeters: z.number().finite().min(0).max(1000),
    sequence: z.number().int().min(1).max(2_147_483_647),
    clientRecordedAt: z.iso.datetime({ offset: true }),
  })
  .strict();
