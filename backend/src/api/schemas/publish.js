import { z } from 'zod';
import { EVENT_TYPE_PATTERN, MAX_EVENT_TYPE_LENGTH } from '../../shared/event-types.js';

export const publishSchema = z
  .object({
    eventType: z
      .string()
      .min(1)
      .max(MAX_EVENT_TYPE_LENGTH)
      .regex(EVENT_TYPE_PATTERN, 'must be lowercase and dot separated, such as order.created'),
    payload: z.record(z.string(), z.unknown()),
    endpointIds: z.array(z.string().min(1)).min(1).optional(),
  })
  .strict();
