import { z } from 'zod';
import { DELIVERY_STATUS_VALUES } from '../../shared/delivery-status.js';
import { EVENT_TYPE_PATTERN, MAX_EVENT_TYPE_LENGTH } from '../../shared/event-types.js';

const MIN_PASSWORD_LENGTH = 12;

const name = z.string().trim().min(1).max(120);

const email = z.email().max(254);

const eventTypePattern = z
  .string()
  .max(MAX_EVENT_TYPE_LENGTH + 2)
  .refine(
    (value) => EVENT_TYPE_PATTERN.test(value) || /^[a-z0-9]+([._-][a-z0-9]+)*\.\*$/.test(value),
    'must be an event type or a single trailing wildcard, such as order.*',
  )
  .refine((value) => value !== '*', 'a bare * is not accepted; an empty list already means all');

export const registerSchema = z
  .object({
    email,
    password: z.string().min(MIN_PASSWORD_LENGTH).max(200),
    name,
    projectName: name,
  })
  .strict();

export const loginSchema = z.object({ email, password: z.string().min(1).max(200) }).strict();

export const projectSchema = z.object({ name }).strict();

export const memberSchema = z
  .object({ email, role: z.enum(['OWNER', 'MEMBER']).default('MEMBER') })
  .strict();

export const apiKeySchema = z.object({ name }).strict();

export const endpointCreateSchema = z
  .object({
    url: z.url().max(2048),
    description: z.string().max(500).optional(),
    eventTypes: z.array(eventTypePattern).max(50).default([]),
    rateLimitPerMinute: z.coerce.number().int().min(1).max(60_000).optional(),
  })
  .strict();

export const endpointUpdateSchema = endpointCreateSchema.partial().strict();

export const deliveryFilterSchema = z
  .object({
    status: z.enum(DELIVERY_STATUS_VALUES).optional(),
    endpointId: z.string().min(1).optional(),
    eventType: z.string().max(MAX_EVENT_TYPE_LENGTH).optional(),
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();

export const bulkReplaySchema = deliveryFilterSchema
  .omit({ cursor: true, limit: true })
  .extend({ limit: z.coerce.number().int().min(1).optional() })
  .strict();
