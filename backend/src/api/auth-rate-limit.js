const MAX_EMAIL_LENGTH = 254;

function presentedEmail(req) {
  const value = req.body?.email;

  if (typeof value !== 'string') {
    return null;
  }

  const email = value.trim().toLowerCase().slice(0, MAX_EMAIL_LENGTH);

  return email || null;
}

// The window is claimed per address *and* per account rather than per address
// alone. Behind a reverse proxy every dashboard request arrives from the proxy,
// so an address-only counter lets one person's failed logins lock out everyone
// else; adding the account keeps the counters apart whether or not TRUST_PROXY
// is set. The address stays in the key so an attacker who knows an address
// cannot lock its owner out from somewhere else once the proxy is trusted.
//
// The body is read before validation on purpose: an attempt that names an
// account is counted against it even when the rest of the payload is malformed.
export function authRateLimitKey(req) {
  return `${req.ip}:${presentedEmail(req) ?? '-'}`;
}
