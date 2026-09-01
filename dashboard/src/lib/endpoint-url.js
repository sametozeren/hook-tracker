// Two readings of the same URL, kept side by side because they differ on
// purpose: `displayName` is the short identity other screens render an endpoint
// by, so it drops the query string; `splitUrl` is the endpoint list's own view of
// the exact target a request is posted to, so it keeps it.

export function displayName(rawUrl) {
  try {
    const parsed = new URL(rawUrl);

    return `${parsed.host}${parsed.pathname === '/' ? '' : parsed.pathname}`;
  } catch {
    return rawUrl;
  }
}

export function splitUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    const path = parsed.pathname === '/' ? '' : parsed.pathname;

    return { host: parsed.host, path: `${path}${parsed.search}` };
  } catch {
    return { host: rawUrl, path: '' };
  }
}
