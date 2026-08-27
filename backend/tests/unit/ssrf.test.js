import { describe, expect, it } from 'vitest';
import { classifyAddress, resolveSafeTarget } from '../../src/shared/ssrf.js';

function lookupReturning(...addresses) {
  return async () =>
    addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
}

describe('classifyAddress', () => {
  it('names the ranges a webhook may never reach', () => {
    expect(classifyAddress('127.0.0.1')).toBe('loopback');
    expect(classifyAddress('10.1.2.3')).toBe('private');
    expect(classifyAddress('172.16.0.1')).toBe('private');
    expect(classifyAddress('172.32.0.1')).toBe('public');
    expect(classifyAddress('192.168.1.1')).toBe('private');
    expect(classifyAddress('169.254.169.254')).toBe('link-local');
    expect(classifyAddress('100.64.0.1')).toBe('cgnat');
    expect(classifyAddress('224.0.0.1')).toBe('multicast');
    expect(classifyAddress('240.0.0.1')).toBe('reserved');
    expect(classifyAddress('0.0.0.0')).toBe('reserved');
  });

  it('judges an IPv4-mapped IPv6 address by the address it embeds', () => {
    expect(classifyAddress('::ffff:127.0.0.1')).toBe('loopback');
    expect(classifyAddress('::ffff:8.8.8.8')).toBe('public');
  });

  it('classifies the IPv6 ranges', () => {
    expect(classifyAddress('::1')).toBe('loopback');
    expect(classifyAddress('fe80::1')).toBe('link-local');
    expect(classifyAddress('fd00::1')).toBe('unique-local');
    expect(classifyAddress('ff02::1')).toBe('multicast');
    expect(classifyAddress('2606:4700::1111')).toBe('public');
  });
});

describe('resolveSafeTarget', () => {
  const lookup = lookupReturning('93.184.216.34');

  it('pins the resolved address and keeps the hostname for SNI and Host', async () => {
    const target = await resolveSafeTarget('https://example.com/hooks', { lookup });

    expect(target.address).toBe('93.184.216.34');
    expect(target.hostname).toBe('example.com');
    expect(target.port).toBe(443);
    expect(target.url.href).toBe('https://example.com/hooks');
  });

  it('rejects a scheme that is not http or https', async () => {
    await expect(resolveSafeTarget('file:///etc/passwd', { lookup })).rejects.toMatchObject({
      code: 'SSRF_BLOCKED',
      reason: 'unsupported_scheme',
    });
  });

  it('rejects a blocked port', async () => {
    await expect(
      resolveSafeTarget('http://example.com:5432/hooks', { lookup, blockedPorts: [5432] }),
    ).rejects.toMatchObject({ reason: 'blocked_port' });
  });

  it('rejects a hostname that resolves into a private range', async () => {
    await expect(
      resolveSafeTarget('http://internal.test/hooks', { lookup: lookupReturning('10.0.0.5') }),
    ).rejects.toMatchObject({ reason: 'private_address' });
  });

  it('rejects the cloud metadata address written as a literal', async () => {
    await expect(
      resolveSafeTarget('http://169.254.169.254/latest/meta-data', {}),
    ).rejects.toMatchObject({ reason: 'private_address' });
  });

  it('rejects a name that resolves to a public and a private address at once', async () => {
    await expect(
      resolveSafeTarget('http://mixed.test/hooks', {
        lookup: lookupReturning('93.184.216.34', '127.0.0.1'),
      }),
    ).rejects.toMatchObject({ reason: 'private_address' });
  });

  it('lets an allowlisted host through, which is how the compose demo reaches the receiver', async () => {
    const target = await resolveSafeTarget('http://receiver:4000/ok', {
      allowlistHosts: ['receiver'],
      lookup: lookupReturning('172.20.0.5'),
    });

    expect(target.address).toBe('172.20.0.5');
  });

  it('lets everything through when SSRF_ALLOW_PRIVATE is on', async () => {
    const target = await resolveSafeTarget('http://localhost:4000/ok', {
      allowPrivate: true,
      lookup: lookupReturning('127.0.0.1'),
    });

    expect(target.address).toBe('127.0.0.1');
  });

  it('reports a name that does not resolve', async () => {
    await expect(
      resolveSafeTarget('http://nowhere.test/hooks', {
        lookup: async () => {
          throw new Error('ENOTFOUND');
        },
      }),
    ).rejects.toMatchObject({ reason: 'dns_failure' });
  });
});
