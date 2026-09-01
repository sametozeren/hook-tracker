const ORIGIN_FALLBACK = 'https://your-hook-tracker-host';

export function apiOrigin() {
  return typeof window === 'undefined' ? ORIGIN_FALLBACK : window.location.origin;
}

export function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

export function buildCurl(url, headers = [], body = null) {
  const lines = [`curl -X POST ${shellQuote(url)}`];

  for (const [name, value] of headers) {
    lines.push(`  -H ${shellQuote(`${name}: ${value}`)}`);
  }

  if (body !== null && body !== undefined) {
    lines.push(`  -d ${shellQuote(body)}`);
  }

  return lines.join(' \\\n');
}
