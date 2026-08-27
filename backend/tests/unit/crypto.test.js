import { describe, expect, it } from 'vitest';
import {
  apiKeyPrefix,
  constantTimeEquals,
  decryptSecret,
  encryptSecret,
  generateApiKey,
  generateEndpointSecret,
  hashApiKey,
  hashPassword,
  verifyPassword,
} from '../../src/shared/crypto.js';

describe('password hashing', () => {
  it('verifies the original password and rejects a wrong one', async () => {
    const hash = await hashPassword('correct horse battery staple');

    expect(hash.startsWith('$argon2id$')).toBe(true);
    await expect(verifyPassword(hash, 'correct horse battery staple')).resolves.toBe(true);
    await expect(verifyPassword(hash, 'wrong password')).resolves.toBe(false);
  });

  it('returns false instead of throwing on a malformed hash', async () => {
    await expect(verifyPassword('not-a-hash', 'anything')).resolves.toBe(false);
  });
});

describe('api keys', () => {
  it('derives the lookup prefix from the first 8 characters after ht_', () => {
    const { plaintext, keyPrefix, keyHash } = generateApiKey();

    expect(plaintext.startsWith('ht_')).toBe(true);
    expect(keyPrefix).toBe(plaintext.slice(3, 11));
    expect(keyHash).toBe(hashApiKey(plaintext));
    expect(keyHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects a key without the ht_ marker', () => {
    expect(() => apiKeyPrefix('sk_live_whatever')).toThrow(/must start with/);
  });
});

describe('constantTimeEquals', () => {
  it('compares equal strings and rejects differing ones', () => {
    expect(constantTimeEquals('abc', 'abc')).toBe(true);
    expect(constantTimeEquals('abc', 'abd')).toBe(false);
    expect(constantTimeEquals('abc', 'abcd')).toBe(false);
    expect(constantTimeEquals('abc', undefined)).toBe(false);
  });
});

describe('secret encryption', () => {
  it('round-trips an endpoint secret', () => {
    const secret = generateEndpointSecret();
    const encrypted = encryptSecret(secret);

    expect(encrypted.startsWith('v1.')).toBe(true);
    expect(encrypted).not.toContain(secret);
    expect(decryptSecret(encrypted)).toBe(secret);
  });

  it('uses a fresh iv for every encryption', () => {
    expect(encryptSecret('same input')).not.toBe(encryptSecret('same input'));
  });

  it('rejects a tampered ciphertext', () => {
    const encrypted = encryptSecret('whsec_tampered');
    const [version, iv, tag, ciphertext] = encrypted.split('.');
    const flipped = Buffer.from(ciphertext, 'base64url');

    flipped[0] ^= 0xff;

    const tampered = [version, iv, tag, flipped.toString('base64url')].join('.');

    expect(() => decryptSecret(tampered)).toThrow();
  });

  it('rejects a malformed payload', () => {
    expect(() => decryptSecret('nonsense')).toThrow(/Malformed encrypted secret/);
  });
});
