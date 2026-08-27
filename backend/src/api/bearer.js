const BEARER = /^Bearer\s+(\S+)$/i;

// Both authentication schemes read the same header in the same format, so they
// parse it with the same function and cannot drift on what a valid one looks
// like. What they do with an absent token differs, and stays with each of them.
export function bearerToken(req) {
  return BEARER.exec(req.get('authorization') ?? '')?.[1] ?? null;
}
