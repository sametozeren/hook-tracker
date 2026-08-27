import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export const SSRF_ERROR_CODE = 'SSRF_BLOCKED';

const DEFAULT_PORTS = { 'http:': 80, 'https:': 443 };

export class SsrfBlockedError extends Error {
  constructor(reason, detail) {
    super(detail);

    this.name = 'SsrfBlockedError';
    this.code = SSRF_ERROR_CODE;
    this.reason = reason;
  }
}

export function classifyIpv4(address) {
  const [first, second] = address.split('.').map(Number);

  if (first === 0) return 'reserved';

  if (first === 10) return 'private';

  if (first === 127) return 'loopback';

  if (first === 100 && second >= 64 && second <= 127) return 'cgnat';

  if (first === 169 && second === 254) return 'link-local';

  if (first === 172 && second >= 16 && second <= 31) return 'private';

  if (first === 192 && second === 168) return 'private';

  if (first >= 224 && first <= 239) return 'multicast';

  if (first >= 240) return 'reserved';

  return 'public';
}

export function classifyIpv6(address) {
  const value = address.toLowerCase();

  if (value === '::1') return 'loopback';

  if (value === '::') return 'reserved';

  // An IPv4-mapped address reaches the same host as the address it embeds, so
  // it is judged by the embedded value rather than by its IPv6 form.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value);

  if (mapped) {
    return classifyIpv4(mapped[1]);
  }

  const head = value.slice(0, 4);

  if (
    head.startsWith('fe8') ||
    head.startsWith('fe9') ||
    head.startsWith('fea') ||
    head.startsWith('feb')
  ) {
    return 'link-local';
  }

  if (head.startsWith('fc') || head.startsWith('fd')) return 'unique-local';

  if (head.startsWith('ff')) return 'multicast';

  return 'public';
}

export function classifyAddress(address) {
  const version = isIP(address);

  if (version === 4) return classifyIpv4(address);

  if (version === 6) return classifyIpv6(address);

  return 'unknown';
}

function targetPort(url) {
  return Number(url.port || DEFAULT_PORTS[url.protocol]);
}

// The address is resolved once here and handed to the HTTP client, which
// connects to that exact address. Resolving again at connect time would leave a
// window in which DNS could be re-pointed at a private host after the check.
export async function resolveSafeTarget(
  rawUrl,
  { allowPrivate = false, allowlistHosts = [], blockedPorts = [], lookup = dnsLookup } = {},
) {
  let url;

  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError('invalid_url', 'The endpoint URL cannot be parsed');
  }

  if (!DEFAULT_PORTS[url.protocol]) {
    throw new SsrfBlockedError(
      'unsupported_scheme',
      `Only http and https are allowed, not ${url.protocol}`,
    );
  }

  const port = targetPort(url);

  if (blockedPorts.includes(port)) {
    throw new SsrfBlockedError('blocked_port', `Port ${port} is blocked by SSRF_BLOCKED_PORTS`);
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const allowlisted = allowlistHosts.includes(hostname);

  let addresses;

  if (isIP(hostname)) {
    addresses = [{ address: hostname, family: isIP(hostname) }];
  } else {
    try {
      addresses = await lookup(hostname, { all: true });
    } catch {
      throw new SsrfBlockedError('dns_failure', `${hostname} does not resolve`);
    }
  }

  if (addresses.length === 0) {
    throw new SsrfBlockedError('dns_failure', `${hostname} does not resolve`);
  }

  if (!allowPrivate && !allowlisted) {
    for (const entry of addresses) {
      const classification = classifyAddress(entry.address);

      if (classification !== 'public') {
        throw new SsrfBlockedError(
          'private_address',
          `${hostname} resolves to a ${classification} address`,
        );
      }
    }
  }

  const [pinned] = addresses;

  return { url, hostname, port, address: pinned.address, family: pinned.family };
}
