import { describe, expect, it } from 'vitest';
import { socketExpiryDelay } from '../../src/api/realtime/socket.js';

const SIGNED_32_BIT_MAX = 2_147_483_647;

const now = Date.UTC(2026, 0, 1);

describe('socketExpiryDelay', () => {
  it('returns the time left on the token when it fits in a timer', () => {
    const expiresAt = Math.floor(now / 1000) + 900;

    expect(socketExpiryDelay(expiresAt, now)).toBe(900_000);
  });

  // JWT_ACCESS_TTL accepts up to 365d, and setTimeout fires immediately on a
  // delay that overflows a signed 32-bit int, which would drop every socket at
  // connect time.
  it('clamps a delay that would overflow setTimeout', () => {
    const oneYear = Math.floor(now / 1000) + 365 * 24 * 60 * 60;

    expect(socketExpiryDelay(oneYear, now)).toBe(SIGNED_32_BIT_MAX);
  });

  it('clamps one millisecond past the limit', () => {
    const beyond = (now + SIGNED_32_BIT_MAX + 1) / 1000;

    expect(socketExpiryDelay(beyond, now)).toBe(SIGNED_32_BIT_MAX);
  });

  it('leaves a delay that is exactly the limit alone', () => {
    const atLimit = (now + SIGNED_32_BIT_MAX) / 1000;

    expect(socketExpiryDelay(atLimit, now)).toBe(SIGNED_32_BIT_MAX);
  });

  it('reports a token that has already expired as a non-positive delay', () => {
    const expiresAt = Math.floor(now / 1000) - 5;

    expect(socketExpiryDelay(expiresAt, now)).toBe(-5_000);
  });
});
