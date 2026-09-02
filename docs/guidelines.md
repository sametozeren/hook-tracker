# Development & Coding Guidelines

## Architectural Rules

- **Module Standard:** Native ESM (`import/export`) is mandatory for all Node.js services. Ensure `"type": "module"` is configured in `package.json`.
- **Package Boundaries:** `backend/` and `dashboard/` are independent packages with their own `package.json` and `node_modules`. There is no root workspace. Backend ships one image with four entrypoints (`api`, `worker`, `jobs`, `demo-receiver`) sharing `src/shared`.
- **Separation of Concerns:** Strictly decouple Routes, Controllers, Services, and Data Access (Prisma) layers. Routes never touch Prisma directly; services never read `req`.
- **Shared Truth:** Queue names, retry schedule, delivery status enum, and the HMAC function live in `src/shared` only. Duplicating any of them in `api/` or `worker/` is a defect — the two processes must never be able to disagree. Concretely: `queue/topology.js`, `retry.js`, `delivery-status.js`, and `hmac.js` (which also owns the outbound header names, since the signer and the receiver must read the same ones).
- **One shutdown:** `shared/lifecycle.js` owns the part every process shares — one shutdown per process however many signals arrive, a force-exit timer, the exit code. Each entrypoint passes what to close; none of them re-implements the surrounding sequence.
- **Fail-Fast Principle:** Validate incoming payloads at the API layer; reject invalid payloads before queuing. Validate environment variables with a zod schema at startup and exit on failure rather than starting degraded.
- **Asynchronous Safety:** Delivery workers must only issue RabbitMQ acknowledgments (`ACK`) after the HTTP attempt is finalized and audit rows are committed to PostgreSQL, in a single transaction.

## Error Handling & Reliability

- Enforce explicit HTTP request timeouts on all external delivery attempts (`DELIVERY_CONNECT_TIMEOUT_MS` and `DELIVERY_TIMEOUT_MS`).
- Redact sensitive values (API keys, endpoint secrets, `Authorization` headers, refresh cookies) from logs and error traces through the `pino` redaction path list, never with ad-hoc string replacement.
- Errors thrown from services are typed (`AppError` subclasses carrying an HTTP status and a problem `type`); a single Express error middleware renders them as `application/problem+json`. Never send a raw stack trace to a client.
- Every process implements graceful shutdown on `SIGTERM`.
- Retries are the queue's job, not the code's: no manual `setTimeout` retry loops inside a service.

## Security Rules

- Every outbound delivery target passes the SSRF guard described in `docs/architecture.md`. There is no code path that issues a request to a user-supplied URL without it.
- Secrets are compared with `crypto.timingSafeEqual`, never with `===`.
- Passwords use argon2id. API keys and refresh tokens are stored hashed.
- Every dashboard query derives `projectId` from the authenticated membership set, never from an unchecked route parameter.
- Standard response headers are set by `helmet`, with HSTS enabled only when `NODE_ENV=production`. `x-powered-by` is removed.
- A "not found" and a "not yours" are answered identically (`404`), so ids cannot be enumerated by comparing responses.
- Secrets never travel in a URL, a query string or a log line — only in a request body or an `Authorization` header.

## Testing

- **Runner:** Vitest. **Integration:** Testcontainers with real Postgres, Redis and RabbitMQ — no broker or database mocks.
- The integration files share one stack, started once by `tests/support/global-setup.js` (`npm run test:integration`, `vitest.integration.config.js`). Isolation comes from a per-file queue namespace and a per-file project row, not from a container each. `npm run test:docker` runs the standalone environment probe, which deliberately sits outside that setup so a Docker fault is told apart from a code fault.
- Required integration coverage: the full retry ladder to the DLQ, manual replay, idempotent republish, endpoint rate-limit parking, SSRF rejection, a signed request accepted by the demo receiver over the real HTTP chain, and worker restart during an in-flight delivery.
- Unit tests cover pure logic: retry-level selection, failure classification, signature construction against an independent implementation (`node:crypto`, not `src/shared/hmac.js`), and env schema parsing.
- Tests never depend on wall-clock sleeps for the retry ladder; the schedule is injected so intervals collapse to milliseconds under test.
- There is no CI pipeline. Lint, unit tests, integration tests, `prisma validate` and the Docker build are run locally before a change is considered done, and the observed output is the evidence — a claim that they pass is not.

## Code Standards

- Use modern JavaScript (ES6+) and native ESM syntax.
- Handle asynchronous control flow using `async/await`; keep `try/catch` scopes tight and intentional.
- ESLint + Prettier are authoritative; formatting is not discussed in review. The blank-line rules a reviewer would otherwise argue about are stated in `docs/code-review.md` (CR-1) and enforced by a lint rule.
- Node version is pinned in `engines` and `.nvmrc`, and matches the Docker base image.
- Follow the commenting rules defined in `CLAUDE.md` without exception.

## Database

- Schema changes always go through `prisma migrate dev`; the generated SQL is committed.
- Containers run `prisma migrate deploy` at startup, never `db push`.
- Every query that a list view issues must be backed by an index declared in `schema.prisma`.
- Prisma has no automatic down-migrations. A change that drops or renames a column ships as an expand-and-contract pair — add the new shape, migrate the data, remove the old one in a later release — so a rollback never lands on a schema the previous version cannot read.
- Deletes that can touch large ranges (retention) run in bounded batches with an explicit limit, never as one unbounded statement holding a long transaction.
- Seed data (`prisma/seed.js`) creates a demo user, project, API key and an endpoint pointing at the bundled receiver, so a fresh clone shows a working delivery within a minute.
