# Security Policy

## Reporting a vulnerability

Do not open a public issue, a pull request or a discussion for a security problem.
A public report tells everyone running the project about the hole before there is a
fix for it.

Report it privately through GitHub: open the repository's **Security** tab and choose
**Report a vulnerability**. That opens a private advisory visible only to the
maintainers. If private reporting is unavailable to you, contact a maintainer directly
through their GitHub profile and ask for a private channel before sending details.

Please include:

- What an attacker can do, and what access they need to start
- The affected component — `api`, `worker`, `jobs`, `demo-receiver`, or the dashboard
- Steps to reproduce, ideally against `docker compose up` on a clean checkout
- The commit or tag you tested
- Any proof-of-concept request or payload, with real secrets removed

You will get an acknowledgement that the report was received. Please give the
maintainers a reasonable window to ship a fix before disclosing publicly, and do not
run tests against anyone else's deployment.

## Supported versions

The project is pre-1.0. Fixes land on the default branch; there are no maintained
release branches, and there is no backporting.

## Scope

In scope — anything that breaks one of the properties below, plus:

- Authentication and session handling: API keys, JWT access tokens, refresh tokens
- Project isolation: reaching another project's events, deliveries, endpoints or keys
- The SSRF guard on outbound delivery targets
- The outbound HMAC signature and its verification
- Idempotency and rate limiting, where bypassing one is a denial-of-service vector
- Secret handling: storage, encryption, and anything that puts a secret in a log line

Out of scope:

- The `.env.example` placeholders for `JWT_SECRET` and `SECRET_ENCRYPTION_KEY`. They
  are documented as placeholders and are refused when `NODE_ENV=production`.
- The bundled demo receiver and the seeded demo account. They exist to make the retry
  ladder observable on a laptop and are not a production surface.
- The absence of TLS in `docker-compose.yml`. The compose stack is a development
  topology; a deployment terminates TLS in front of it.
- Findings that require an attacker to already hold the operator's `.env`, database
  credentials or shell access.
- Volumetric denial of service against a deployment you control.

## What the project commits to

These are properties the code implements today. Anything here that turns out not to
hold is a vulnerability worth reporting.

**Outbound requests.** Every delivery target passes the SSRF guard
(`backend/src/shared/ssrf.js`) before a connection is made — at the worker before each
attempt, and at the API when an endpoint URL is created or changed. The host is
resolved and rejected when it maps to loopback, private (RFC1918), link-local
(including `169.254.169.254`), CGNAT, multicast or reserved ranges. The resolved
address is pinned for the connection, so DNS cannot be re-pointed between the check and
the connect. Only `http` and `https` are accepted. `SSRF_ALLOW_PRIVATE` defaults to
`false`; `SSRF_BLOCKED_PORTS` blocks common internal service ports by default. Hosts named
in `SSRF_ALLOWLIST_HOSTS` skip the address classification entirely — it is the one way past
the guard, and the compose demo uses it for the bundled `receiver` and nothing else.
Redirects are not followed — a `3xx` is a permanent failure, not a second request.

**Passwords and stored credentials.** Passwords are hashed with argon2id. API keys are
stored as a SHA-256 hash next to a lookup prefix; the plaintext key is returned exactly
once, at creation, and is never recoverable afterwards. Refresh tokens are stored
hashed. Endpoint signing secrets are encrypted at rest with AES-256-GCM under
`SECRET_ENCRYPTION_KEY`.

**Constant-time comparison.** API key hashes and HMAC signatures are compared with
`crypto.timingSafeEqual`, never with `===`. Refresh tokens are matched by an indexed hash
and never compared in application code; passwords go through argon2's own verify.

**Request signing.** Every outbound delivery carries an HMAC-SHA256 signature over the
timestamp and the raw body, in `x-webhook-signature`, with a `v1=` scheme and a
timestamp tolerance. During a secret rotation both the current and the previous
signature are sent, so a receiver can migrate without downtime; the previous secret
expires at `secretRotatedAt + SECRET_ROTATION_GRACE_HOURS`. The signing function and
the header names live in `backend/src/shared/hmac.js` only, so the signer and the
verifier cannot drift apart.

**Secrets stay out of URLs and logs.** Secrets are never placed in a URL or a query
string — only in a request body or an `Authorization` header. Logs are structured
`pino` output, and `Authorization` headers, cookies, `set-cookie`, passwords, password
hashes, endpoint secrets, API keys, key hashes, access and refresh tokens, payloads and
endpoint URLs are removed through the redaction path list in
`backend/src/shared/logger.js` — never by ad-hoc string replacement.

**Project isolation.** Every dashboard query derives `projectId` from the authenticated
membership set, never from an unchecked route parameter. A project the caller does not
belong to answers identically to a project that does not exist (`404`), so ids cannot
be enumerated by comparing responses. A caller who *is* a member but lacks the required
role gets `403`, because they already know the project exists.

**Error responses.** Errors are rendered as RFC 9457 `application/problem+json` by a
single middleware. A raw stack trace is never sent to a client.

**Response headers.** `helmet` sets the standard headers, with HSTS enabled only when
`NODE_ENV=production`. `x-powered-by` is removed.

**Configuration is validated.** Every environment variable is parsed by a zod schema at
startup. A process exits with a readable message rather than starting degraded, and in
production the `.env.example` placeholder secrets are refused outright.

`docs/guidelines.md` § Security Rules and `docs/architecture.md` §6 and §7 are the
authoritative statements of the above.
