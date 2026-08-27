import {
  createHash,
  randomBytes,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
} from 'node:crypto';
import { Algorithm, hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import { config } from './config.js';

const ARGON_OPTIONS = Object.freeze({
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
});

const API_KEY_MARKER = 'ht_';
const API_KEY_PREFIX_LENGTH = 8;
const ENDPOINT_SECRET_MARKER = 'whsec_';
const ENCRYPTION_VERSION = 'v1';
const GCM_IV_BYTES = 12;

export async function hashPassword(password) {
  return argonHash(password, ARGON_OPTIONS);
}

export async function verifyPassword(passwordHash, password) {
  try {
    return await argonVerify(passwordHash, password, ARGON_OPTIONS);
  } catch {
    return false;
  }
}

export function constantTimeEquals(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;

  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');

  if (left.length !== right.length) return false;

  return timingSafeEqual(left, right);
}

export function sha256Hex(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function hashApiKey(plaintext) {
  return sha256Hex(plaintext);
}

export function apiKeyPrefix(plaintext) {
  if (!plaintext.startsWith(API_KEY_MARKER)) {
    throw new TypeError(`API key must start with "${API_KEY_MARKER}"`);
  }

  return plaintext.slice(API_KEY_MARKER.length, API_KEY_MARKER.length + API_KEY_PREFIX_LENGTH);
}

export function generateApiKey() {
  const plaintext = `${API_KEY_MARKER}${randomBytes(24).toString('base64url')}`;

  return { plaintext, keyPrefix: apiKeyPrefix(plaintext), keyHash: hashApiKey(plaintext) };
}

export function generateEndpointSecret() {
  return `${ENDPOINT_SECRET_MARKER}${randomBytes(32).toString('base64url')}`;
}

function encryptionKey() {
  return Buffer.from(config.SECRET_ENCRYPTION_KEY, 'hex');
}

export function encryptSecret(plaintext) {
  const iv = randomBytes(GCM_IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

  return [
    ENCRYPTION_VERSION,
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

export function decryptSecret(encoded) {
  const [version, iv, authTag, ciphertext] = String(encoded).split('.');

  if (version !== ENCRYPTION_VERSION || !iv || !authTag || !ciphertext) {
    throw new TypeError('Malformed encrypted secret');
  }

  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64url'));

  decipher.setAuthTag(Buffer.from(authTag, 'base64url'));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
