# Implementation Plan

**Status:** Phase 4 complete, acceptance check run and observed. Phase 5 next. Last updated 2026-08-27.

Ordered phases. Each one ends in something that runs and can be checked, so a broken phase is caught before the next depends on it. Do not start a phase until its predecessor's acceptance check passes. Update the status line above when a phase closes, so a session that starts with no memory of this one knows where the work stands.

This file carries order, completion state and risk. What each piece does belongs in `architecture.md`, `api.md`, `dashboard.md` and `guidelines.md` — restating that here would create a second copy to keep in sync.

## Definition of Done

Applies to every phase, in addition to its own acceptance check:

- [ ] Lint and format clean in both packages
- [ ] New behavior covered by a test at the right level — unit for pure logic, integration for anything touching Postgres, Redis or RabbitMQ
- [ ] `.env.example` covers every new variable, with a safe default or an explicitly invalid placeholder
- [ ] No secret, token, endpoint URL or payload added to a log line
- [ ] If implementation changed a decision, the affected spec document is updated in the same change — and the Turkish reading page is flagged for update
- [ ] The acceptance check was actually run and its output observed, not assumed

## Known Risks

Places where the work is likely to stall. Listed here rather than in the specs because they concern building, not behavior.

| Risk | Phase | Handling |
|---|---|---|
| Prisma client generation and import paths under ESM need extra configuration | 1 | Resolved: the v7 `prisma-client` generator emits TypeScript into `src/generated/prisma`, which Node 24 runs directly through type stripping, and v7 requires a driver adapter (`@prisma/adapter-pg`). Both are contained in `shared/db.js`, the only module that imports the generated client. A Node older than 24 cannot run the client without `--experimental-strip-types`, which is why `engines` pins 24 |
| RabbitMQ queue arguments are immutable — a wrong TTL yields `PRECONDITION_FAILED` on restart | 2 | Resolved: `npm run queue:reset` inspects every queue first and refuses to delete one that still holds messages unless `--force` is passed; it also refuses to run with `NODE_ENV=production`. The broker is not published to the host, so it is used as `docker compose run --rm api npm run queue:reset` |
| Testcontainers on Windows and Docker Desktop: slow starts, socket path configuration | 2 | Resolved: `tests/integration/docker-environment.test.js` starts a bare alpine container, so an environment fault is told apart from a code fault at a glance. One broker is started per test file and stopped in `afterAll`; container reuse is not enabled while a single file needs a broker, and is the next step if that changes. CI runs Linux, so a local-only failure is an environment finding |
| Connecting to a pinned IP while keeping TLS valid | 4 | Resolved: a fresh `undici` Agent per attempt whose `connect.lookup` returns the verified address. The request is still made against the original URL, so SNI and the `Host` header carry the hostname and certificate validation is unaffected. One agent per attempt rather than a pooled one, because a pinned address belongs to a single attempt |
| Socket.io fan-out across replicas only misbehaves with more than one API instance | 5 | Test with two API containers, not one; a single-instance test passes even when the adapter is misconfigured |
| Refresh cookie behind the Vite dev server behaves differently than behind nginx | 6 | Dev server proxies `/v1` to the API so the cookie stays same-origin; cookie `Path` and CORS credentials verified in both setups |

## Phase 0 — Repository skeleton

- [x] `README.md`, `LICENSE` (MIT), `.gitignore`, `.dockerignore`, `.editorconfig`, `.nvmrc` (Node 24)
- [x] `.env.example` covering every key in the configuration reference
- [x] `backend/package.json` (`"type": "module"`, `engines`, scripts: `start:api`, `start:worker`, `start:jobs`, `start:receiver`, `lint`, `test`, `test:integration`, `seed`)
- [x] `dashboard/package.json` (Vue 3, Vite, Tailwind)
- [x] `backend/Dockerfile`, `dashboard/Dockerfile` + `dashboard/nginx.conf`
- [x] `docker-compose.yml` with healthchecks, the one-shot `migrate` service, and the dependency conditions from architecture §2.1
- [x] `backend/src/shared/config.js` — zod env schema, cross-field rules (MAX_ATTEMPTS vs schedule, production secret checks), exits on invalid input
- [x] `backend/src/shared/logger.js` — pino with the redaction path list
- [x] ESLint + Prettier config in both packages

**Acceptance:** `docker compose up` starts postgres, redis, rabbitmq and api; `GET /health` returns 200; a missing required env var stops the process with a readable message.

## Phase 1 — Data layer

- [x] `backend/prisma/schema.prisma` — every model, enum, index and cascade rule from architecture §11
- [x] Initial migration committed
- [x] `backend/src/shared/ids.js` — prefixed cuid2 helper
- [x] `backend/src/shared/crypto.js` — argon2id hashing, AES-256-GCM secret encryption, constant-time compare
- [x] `backend/prisma/seed.js` — demo user, project, API key, endpoint pointing at the receiver
- [x] `backend/src/demo-receiver/server.js` — the routes from architecture §2.2
- [x] `backend/src/shared/db.js` — driver adapter, the single import site of the generated client
- [x] `backend/src/shared/hmac.js` — pulled forward from phase 4, because the receiver verifies signatures and the signing function may exist only once
- [x] `receiver` service in `docker-compose.yml`, without a host port

**Acceptance:** `migrate deploy` runs clean on an empty database; `npm run seed` produces the demo records; the receiver answers each of its routes as specified.

## Phase 2 — Queue layer

- [x] `backend/src/shared/queue/topology.js` — single declaration of exchanges, queues, TTLs, DLX bindings
- [x] `backend/src/shared/queue/connection.js` — connect with retry, channel management, graceful close
- [x] `backend/src/shared/queue/publisher.js` — publish to main, retry level and DLQ
- [x] `backend/src/shared/retry.js` — schedule, level selection, jitter, failure classification
- [x] Integration test: a message published to `retry.1m` reappears on `webhook.delivery` after its TTL
- [x] `backend/scripts/queue-reset.js` and the `queue:reset` script, from the immutable-arguments risk below
- [x] `backend/vitest.config.js` — container-sized timeouts for the integration suite

**Acceptance:** topology asserts idempotently on a second startup; the ladder test passes against a real broker in Testcontainers.

## Phase 3 — Ingestion API

- [x] Express app, request id middleware, problem+json error middleware, `AppError` hierarchy, helmet, CORS from `CORS_ORIGINS`
- [x] API key authentication (prefix lookup, constant-time hash compare, `lastUsedAt`)
- [x] Redis sliding-window rate limiter with the documented response headers
- [x] Idempotency middleware (reserve, store, replay, `409` on concurrent duplicates)
- [x] `POST /v1/publish` — validation, fan-out selection, event + delivery rows, publish
- [x] `/health`, `/ready`
- [x] `src/shared/redis.js`, `src/shared/json.js` (canonical serialisation) and `src/shared/event-types.js` (subscription matching)
- [x] Topology asserted at API startup, and the app assembled by `createApp({ ... })` so an integration test can drive it against containers

**Acceptance:** an integration test publishes an event, sees rows in Postgres and a message on the queue, gets the identical response on a repeat with the same `Idempotency-Key`, and is rate limited past the configured threshold.

## Phase 4 — Delivery worker

- [x] `backend/src/shared/hmac.js` — signing, including the rotation overlap (delivered in phase 1)
- [x] `backend/src/shared/ssrf.js` — DNS resolution, range checks, IP pinning, allowlist
- [x] HTTP client with split timeouts and no redirect following
- [x] Attempt handler: response capture, transactional attempt row + status update, then ack
- [x] Retry routing, DLQ routing, endpoint token-bucket parking
- [x] Consecutive failure counter and auto-disable
- [x] Realtime publishing to Redis pub/sub
- [x] Graceful shutdown
- [x] `backend/src/shared/token-bucket.js` — refill and take in one Redis round trip
- [x] `worker` service in `docker-compose.yml`, scalable through `deploy.replicas`

**Acceptance:** against the demo receiver, `/ok` succeeds on the first attempt, `/fail-500` walks the full ladder into the DLQ with six attempt rows, `/slow` times out and retries, a private-address endpoint is rejected by the SSRF guard, and a worker killed mid-delivery redelivers without losing the audit row.

## Phase 5 — Dashboard API and realtime

- [ ] Auth routes: register, login, refresh rotation, logout, me
- [ ] JWT middleware and membership-based authorization
- [ ] Projects, members, API keys, endpoints (including rotate-secret, enable, disable, test)
- [ ] Deliveries: keyset list with filters, detail with attempts, replay, bulk replay, stats
- [ ] Socket.io namespace with handshake auth, project rooms, Redis adapter, per-project throttle, disconnect on access-token expiry

**Acceptance:** a member of one project cannot read another project's deliveries by id; a replay creates a new delivery with `replayedFromId` set; a connected client receives `delivery.succeeded` for its own project only.

## Phase 6 — Vue dashboard

- [ ] Shell, router, auth store, API client with refresh handling
- [ ] Login and register
- [ ] Deliveries list with filters in the URL, status pills, live updates and the "N new" bar
- [ ] Delivery detail with attempt timeline, payload viewer, replay and copy-as-cURL
- [ ] Endpoints: list, create/edit with inline SSRF errors, rotate secret, send test
- [ ] Events and Settings
- [ ] Empty, loading and error states from the dashboard spec

**Acceptance:** a fresh clone, seeded, shows deliveries moving through retry to failure live, without a manual refresh.

## Phase 7 — Polish and release

- [ ] OpenAPI generated from the zod schemas, served at `/docs`
- [ ] Prometheus metrics with the documented names
- [ ] `jobs` process: retention and stuck-delivery sweeper
- [ ] GitHub Actions: lint, unit, integration, `prisma validate`, docker build for both packages
- [ ] `CONTRIBUTING.md`, `SECURITY.md`, issue and PR templates
- [ ] README: what it does, 60-second quickstart, architecture diagram, screenshot or GIF, link to `docs/receiving-webhooks.md`

**Acceptance:** CI green on a clean checkout; following only the README, a new user goes from clone to a delivered webhook.
