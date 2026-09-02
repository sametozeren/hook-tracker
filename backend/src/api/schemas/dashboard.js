import { z } from 'zod';
import { DELIVERY_STATUS_VALUES } from '../../shared/delivery-status.js';
import { EVENT_TYPE_PATTERN, MAX_EVENT_TYPE_LENGTH } from '../../shared/event-types.js';
import { ROLES, ROLE_VALUES } from '../../shared/roles.js';

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

// Spelled out rather than derived with .partial(): a partial keeps the defaults
// of the fields it makes optional, and an update that omits a field must leave
// it alone rather than reset it.
export const projectUpdateSchema = z
  .object({ name: name.optional(), alertWebhookUrl: z.url().max(2048).nullable().optional() })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'requires at least one field' });

export const memberSchema = z
  .object({ email, role: z.enum(ROLE_VALUES).default(ROLES.MEMBER) })
  .strict();

export const apiKeySchema = z.object({ name }).strict();

const eventTypes = z.array(eventTypePattern).max(50);

export const endpointCreateSchema = z
  .object({
    url: z.url().max(2048),
    description: z.string().max(500).optional(),
    eventTypes: eventTypes.default([]),
    rateLimitPerMinute: z.coerce.number().int().min(1).max(60_000).optional(),
  })
  .strict();

// `.partial()` makes a key optional but keeps its default, so an update that
// omitted eventTypes used to parse as an explicit empty list and silently clear
// the endpoint's subscriptions. The key is redeclared here without one, so an
// absent eventTypes stays absent and only an explicit [] clears the list.
export const endpointUpdateSchema = endpointCreateSchema
  .partial()
  .extend({ eventTypes: eventTypes.optional() })
  .strict();

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

export const eventFilterSchema = z
  .object({
    eventType: z.string().max(MAX_EVENT_TYPE_LENGTH).optional(),
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
    payloadPath: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[A-Za-z0-9_.-]+$/)
      .optional(),
    payloadValue: z.string().max(500).optional(),
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict()
  .refine((value) => value.payloadPath === undefined || value.payloadValue !== undefined, {
    path: ['payloadValue'],
    message: 'is required when payloadPath is given',
  });

export const bulkReplaySchema = deliveryFilterSchema
  .omit({ cursor: true, limit: true })
  .extend({ limit: z.coerce.number().int().min(1).optional() })
  .strict();
