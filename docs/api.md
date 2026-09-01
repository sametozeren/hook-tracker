# API Contract (v1)

Base path `/v1`. All responses are JSON. Errors follow RFC 9457 (`application/problem+json`).

Two authentication schemes coexist:
* **API key** — ingestion only (`POST /v1/publish`). Header `Authorization: Bearer ht_<key>`.
* **User JWT** — every dashboard route. Header `Authorization: Bearer <jwt>`.

## Error Shape

```json
{
  "type": "urn:hook-tracker:error:rate-limited",
  "title": "Rate limit exceeded",
  "status": 429,
  "detail": "600 requests per minute allowed for this API key",
  "instance": "/v1/publish",
  "requestId": "01J8QW..."
}
```

Validation failures add an `errors` array of `{ path, message }` produced from the zod issue list.

## Ingestion

### `POST /v1/publish`
Auth: API key. Headers: optional `Idempotency-Key`.

```json
{
  "eventType": "order.created",
  "payload": { "orderId": 1234, "total": 99.9 },
  "endpointIds": ["ep_..."]
}
```

`eventType` matches `^[a-z0-9]+([._-][a-z0-9]+)*$`, at most 64 characters.

`endpointIds` is optional. When omitted the event fans out to every `ACTIVE` endpoint of the project whose `eventTypes` matches `eventType` — exact entry, trailing-wildcard entry (`order.*`), or an empty array meaning all events. When supplied, the listed endpoints are used regardless of their subscriptions; duplicates are collapsed, and an id outside the caller's project is rejected with `422` without disclosing whether it exists.

`202 Accepted`:

```json
{
  "eventId": "evt_...",
  "deliveries": [
    { "id": "dlv_...", "endpointId": "ep_...", "status": "PENDING" }
  ]
}
```

Failure modes: `400` invalid body, `401` missing or revoked key, `413` payload above `MAX_PAYLOAD_BYTES`, `409` idempotency key in flight, `422` no matching endpoint, `429` rate limited.

`413` is answered by the body parser, before authentication: a body that cannot be read cannot be authenticated either, and reading it to the end only to reject it is the thing the limit exists to prevent.

Every response carries `X-Request-Id`. A caller may set the header itself — it is echoed when it matches `[A-Za-z0-9._-]{1,128}` — which is what lets a request be followed from the caller's logs into hook-tracker's.

## Authentication

| Method | Path | Purpose |
|---|---|---|
| POST | `/v1/auth/register` | first user creates a project and becomes `OWNER` |
| POST | `/v1/auth/login` | returns access token, sets refresh cookie |
| POST | `/v1/auth/refresh` | rotates the refresh token |
| POST | `/v1/auth/logout` | revokes the refresh token |
| GET | `/v1/auth/me` | current user with memberships |

Auth routes are rate limited per IP (20 attempts per minute), separately from the per-key ingestion limit, because the caller of a login attempt has no key yet.

`register` and `login` return `{ user, project?, accessToken }` and set the refresh cookie. `refresh` returns a new `accessToken` and replaces the cookie; the token it was called with is revoked in the same step, so calling it twice with the same cookie is a `401`.

## Projects & Members

| Method | Path | Purpose |
|---|---|---|
| GET | `/v1/projects` | projects the user belongs to |
| POST | `/v1/projects` | create, caller becomes `OWNER` |
| PATCH | `/v1/projects/:projectId` | rename |
| GET | `/v1/projects/:projectId/members` | list |
| POST | `/v1/projects/:projectId/members` | add by email, `OWNER` only |
| DELETE | `/v1/projects/:projectId/members/:userId` | remove, `OWNER` only |

## API Keys

| Method | Path | Purpose |
|---|---|---|
| GET | `/v1/projects/:projectId/api-keys` | list, prefix only, never the secret |
| POST | `/v1/projects/:projectId/api-keys` | create, returns plaintext **once** |
| DELETE | `/v1/projects/:projectId/api-keys/:keyId` | revoke |

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/v1/projects/:projectId/endpoints` | list |
| POST | `/v1/projects/:projectId/endpoints` | create; the signing secret is returned once |
| PATCH | `/v1/endpoints/:endpointId` | url, description, `eventTypes`, `rateLimitPerMinute` |
| POST | `/v1/endpoints/:endpointId/rotate-secret` | starts the rotation grace window |
| POST | `/v1/endpoints/:endpointId/enable` | clears `consecutiveFailures` |
| POST | `/v1/endpoints/:endpointId/disable` | manual disable |
| DELETE | `/v1/endpoints/:endpointId` | delete |
| POST | `/v1/endpoints/:endpointId/test` | sends a synthetic `ping` event through the normal pipeline |

Creating or updating a URL runs the SSRF guard synchronously and rejects a blocked target with `422` rather than accepting it and failing later at delivery time.

## Deliveries

| Method | Path | Purpose |
|---|---|---|
| GET | `/v1/projects/:projectId/deliveries` | cursor pagination; filters `status`, `endpointId`, `eventType`, `from`, `to` |
| GET | `/v1/deliveries/:deliveryId` | delivery with its full attempt list |
| POST | `/v1/deliveries/:deliveryId/replay` | new Delivery row, `replayedFromId` set |
| POST | `/v1/projects/:projectId/deliveries/bulk-replay` | replays a filtered set, capped at `BULK_REPLAY_LIMIT` |
| GET | `/v1/projects/:projectId/stats` | counts by status and a delivery-latency summary for the dashboard header |

Listing uses keyset pagination (`?cursor=&limit=`) rather than `OFFSET`, because the delivery table grows without bound. A page is `{ deliveries, nextCursor }`, and `nextCursor` is `null` on the last page. The cursor encodes `createdAt` and `id` together: `createdAt` alone is not unique, and a boundary that fell inside a group of same-millisecond rows would repeat or skip them.

A list row carries the delivery fields plus `eventType`, `receivedAt`, `lastResponseStatus` and `lastDurationMs` — the `responseStatus` and `durationMs` of the delivery's newest attempt, both `null` when no attempt has been recorded yet, and `lastResponseStatus` `null` when the attempt errored before a response. Those four are list-only: the single-delivery response carries the full `attempts` array instead.

`bulk-replay` answers `{ matched, replayed, cappedAt, deliveries }`. `matched` counts the rows the filter selected, `replayed` counts those that were in a state worth replaying, and `cappedAt` reports the limit that was applied — a silent truncation would read as "everything was replayed".

`stats` answers `{ byStatus, total, latency: { attempts, averageMs, slowestMs } }`.

Deleting an endpoint that already has delivery history is refused with `409`; disabling it is the operation that keeps the audit trail intact.

## Operational

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | none | liveness |
| GET | `/ready` | none | dependency readiness |
| GET | `/metrics` | none — rides the published API port; block at the reverse proxy in a deployment | Prometheus exposition |
| GET | `/docs` | none | Swagger UI over the generated OpenAPI document |
| GET | `/openapi.json` | none | the document itself |

The OpenAPI document is generated from the same zod schemas the routes validate with, so the spec cannot drift from the implementation. Response shapes, which no zod schema validates at runtime, are declared next to the request schemas in `src/api/schemas/responses.js` and built from the same shared enums the services write. Swagger UI is served from the installed `swagger-ui-dist` package rather than a CDN, so `/docs` opens on a closed network.
