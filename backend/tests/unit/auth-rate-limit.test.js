import { describe, expect, it } from 'vitest';
import { authRateLimitKey } from '../../src/api/auth-rate-limit.js';

describe('authRateLimitKey', () => {
  it('counts an attempt against the address and the account it names', () => {
    expect(authRateLimitKey({ ip: '203.0.113.7', body: { email: 'ada@example.com' } })).toBe(
      '203.0.113.7:ada@example.com',
    );
  });

  it('keeps two accounts behind one proxy address apart', () => {
    const proxy = '10.0.0.2';
    const first = authRateLimitKey({ ip: proxy, body: { email: 'ada@example.com' } });
    const second = authRateLimitKey({ ip: proxy, body: { email: 'grace@example.com' } });

    expect(first).not.toBe(second);
  });

  it('treats an account as one account however it was typed', () => {
    expect(authRateLimitKey({ ip: '203.0.113.7', body: { email: '  ADA@Example.com ' } })).toBe(
      '203.0.113.7:ada@example.com',
    );
  });

  it('falls back to the address alone when the attempt names no account', () => {
    expect(authRateLimitKey({ ip: '203.0.113.7', body: {} })).toBe('203.0.113.7:-');
    expect(authRateLimitKey({ ip: '203.0.113.7' })).toBe('203.0.113.7:-');
  });

  it('ignores an email that is not a string, so a crafted body cannot shape the key', () => {
    expect(authRateLimitKey({ ip: '203.0.113.7', body: { email: { toString: () => 'x' } } })).toBe(
      '203.0.113.7:-',
    );
    expect(authRateLimitKey({ ip: '203.0.113.7', body: { email: ['a@b.c'] } })).toBe(
      '203.0.113.7:-',
    );
  });

  it('caps the account it will key on, so an oversized body cannot grow the key', () => {
    const key = authRateLimitKey({ ip: '203.0.113.7', body: { email: 'a'.repeat(5000) } });

    expect(key.length).toBeLessThanOrEqual('203.0.113.7:'.length + 254);
  });
});
