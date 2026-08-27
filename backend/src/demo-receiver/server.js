import express from 'express';
import { config } from '../shared/config.js';
import { WEBHOOK_HEADERS, verifySignature } from '../shared/hmac.js';
import { closeServer, onShutdown } from '../shared/lifecycle.js';
import { createLogger } from '../shared/logger.js';

const RECEIVER_PORT = 4000;
const HISTORY_LIMIT = 100;
const DEFAULT_SLOW_MS = 12_000;
const MAX_SLOW_MS = 120_000;
const DEFAULT_FLAKY_RATE = 0.5;

const logger = createLogger('receiver');

if (!config.DEMO_ENDPOINT_SECRET) {
  process.stderr.write(
    'DEMO_ENDPOINT_SECRET is required by the demo receiver; see .env.example.\n',
  );
  process.exit(1);
}

const history = [];

function parseBody(raw) {
  if (!raw || raw.length === 0) return null;

  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    return raw.toString('utf8').slice(0, 1024);
  }
}

function record(req) {
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  const signature = verifySignature({
    header: req.get(WEBHOOK_HEADERS.signature),
    secret: config.DEMO_ENDPOINT_SECRET,
    timestamp: req.get(WEBHOOK_HEADERS.timestamp),
    rawBody: raw,
  });

  const entry = {
    receivedAt: new Date().toISOString(),
    method: req.method,
    path: req.originalUrl,
    webhookId: req.get(WEBHOOK_HEADERS.id) ?? null,
    eventType: req.get(WEBHOOK_HEADERS.event) ?? null,
    attempt: Number(req.get(WEBHOOK_HEADERS.attempt)) || null,
    signatureValid: signature.valid,
    signatureReason: signature.reason ?? null,
    headers: req.headers,
    body: parseBody(raw),
  };

  history.push(entry);

  if (history.length > HISTORY_LIMIT) history.shift();

  logger.info(
    {
      webhookId: entry.webhookId,
      eventType: entry.eventType,
      attempt: entry.attempt,
      signatureValid: entry.signatureValid,
      signatureReason: entry.signatureReason,
      path: entry.path,
    },
    'webhook received',
  );

  return entry;
}

function clamp(value, min, max, fallback) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) return fallback;

  return Math.min(Math.max(parsed, min), max);
}

const app = express();

app.disable('x-powered-by');
app.use(express.raw({ type: () => true, limit: '5mb' }));

app.post('/ok', (req, res) => {
  const entry = record(req);

  res.status(200).json({ status: 'ok', webhookId: entry.webhookId });
});

app.post('/fail-500', (req, res) => {
  record(req);
  res.status(500).json({ status: 'error', reason: 'simulated permanent failure' });
});

app.post('/slow', (req, res) => {
  record(req);

  const delayMs = clamp(req.query.ms, 0, MAX_SLOW_MS, DEFAULT_SLOW_MS);
  const timer = setTimeout(() => {
    res.status(200).json({ status: 'ok', delayedMs: delayMs });
  }, delayMs);

  res.on('close', () => clearTimeout(timer));
});

app.post('/flaky', (req, res) => {
  record(req);

  const rate = clamp(req.query.rate, 0, 1, DEFAULT_FLAKY_RATE);

  if (Math.random() < rate) {
    res.status(503).json({ status: 'error', reason: 'simulated transient failure', rate });

    return;
  }

  res.status(200).json({ status: 'ok', rate });
});

app.get('/received', (req, res) => {
  res.status(200).json({ count: history.length, requests: history });
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

const server = app.listen(RECEIVER_PORT, () => {
  logger.info({ port: RECEIVER_PORT }, 'demo receiver listening');
});

onShutdown({
  logger,
  graceMs: config.SHUTDOWN_GRACE_MS,
  close: () => closeServer(server),
});
