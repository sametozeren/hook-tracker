import { pino } from 'pino';
import { config } from './config.js';

const REDACTION_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'headers.authorization',
  'headers.cookie',
  'password',
  'passwordHash',
  'secret',
  'previousSecret',
  'apiKey',
  'keyHash',
  'token',
  'accessToken',
  'refreshToken',
  'payload',
  'endpointUrl',
  '*.password',
  '*.passwordHash',
  '*.secret',
  '*.previousSecret',
  '*.apiKey',
  '*.keyHash',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.payload',
  '*.endpointUrl',
  'endpoint.url',
];

export function createLogger(service, bindings = {}) {
  return pino({
    name: service,
    level: config.LOG_LEVEL,
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: REDACTION_PATHS, censor: '[redacted]' },
  }).child(bindings);
}

export { REDACTION_PATHS };
