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
  const [first, second, third] = address.split('.').map(Number);

  if (first === 0) return 'reserved';

  if (first === 10) return 'private';

  if (first === 127) return 'loopback';

  if (first === 100 && second >= 64 && second <= 127) return 'cgnat';

  if (first === 169 && second === 254) return 'link-local';

  if (first === 172 && second >= 16 && second <= 31) return 'private';

  if (first === 192 && second === 0 && third === 0) return 'reserved';

  if (first === 192 && second === 0 && third === 2) return 'reserved';

  if (first === 192 && second === 168) return 'private';

  if (first === 198 && (second === 18 || second === 19)) return 'reserved';

  if (first === 198 && second === 51 && third === 100) return 'reserved';

  if (first === 203 && second === 0 && third === 113) return 'reserved';

  if (first >= 224 && first <= 239) return 'multicast';

  if (first >= 240) return 'reserved';

  return 'public';
}

function expandIpv4Suffix(groups) {
  const last = groups.at(-1);

  if (!last?.includes('.')) return groups;

  const [a, b, c, d] = last.split('.').map(Number);

  return [
    ...groups.slice(0, -1),
    (((a << 8) | b) >>> 0).toString(16),
    (((c << 8) | d) >>> 0).toString(16),
  ];
}

function splitGroups(part) {
  return part === '' ? [] : expandIpv4Suffix(part.split(':'));
}

function ipv6ToBytes(address) {
  const [head, tail, extra] = address.toLowerCase().split('::');

  if (extra !== undefined) return null;

  const leading = splitGroups(head);
  const trailing = tail === undefined ? [] : splitGroups(tail);
  const gap = 8 - leading.length - trailing.length;
  const groups =
    tail === undefined
      ? leading
      : [...leading, ...Array.from({ length: gap }, () => '0'), ...trailing];

  if (groups.length !== 8 || gap < 0) return null;

  const bytes = new Uint8Array(16);

  for (let index = 0; index < 8; index += 1) {
    const group = Number.parseInt(groups[index], 16);

    if (!Number.isInteger(group) || group < 0 || group > 0xffff) return null;

    bytes[index * 2] = group >>> 8;
    bytes[index * 2 + 1] = group & 0xff;
  }

  return bytes;
}

function isZeroRange(bytes, start, end) {
  for (let index = start; index < end; index += 1) {
    if (bytes[index] !== 0) return false;
  }

  return true;
}

function ipv4At(bytes, offsets) {
  return offsets.map((offset) => bytes[offset]).join('.');
}

const EMBEDDED_IPV4_OFFSETS = [12, 13, 14, 15];

export function classifyIpv6(address) {
  const bytes = ipv6ToBytes(address);

  if (!bytes) return 'unknown';

  // WHATWG URL normalises [::ffff:127.0.0.1] to ::ffff:7f00:1, so a mapped or
  // embedded IPv4 address is only visible at the byte level, never in the text.
  if (isZeroRange(bytes, 0, 10)) {
    if (bytes[10] === 0xff && bytes[11] === 0xff) {
      return classifyIpv4(ipv4At(bytes, EMBEDDED_IPV4_OFFSETS));
    }

    if (bytes[10] === 0 && bytes[11] === 0) {
      if (isZeroRange(bytes, 12, 16)) return 'reserved';

      if (isZeroRange(bytes, 12, 15) && bytes[15] === 1) return 'loopback';

      return classifyIpv4(ipv4At(bytes, EMBEDDED_IPV4_OFFSETS));
    }
  }

  const nat64 = bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b;

  if (nat64 && (isZeroRange(bytes, 4, 12) || (bytes[4] === 0x00 && bytes[5] === 0x01))) {
    return classifyIpv4(ipv4At(bytes, EMBEDDED_IPV4_OFFSETS));
  }

  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return 'link-local';

  if ((bytes[0] & 0xfe) === 0xfc) return 'unique-local';

  if (bytes[0] === 0xff) return 'multicast';

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
