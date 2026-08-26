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

## Authentication

| Method | Path | Purpose |
|---|---|---|
| POST | `/v1/auth/register` | first user creates a project and becomes `OWNER` |
| POST | `/v1/auth/login` | returns access token, sets refresh cookie |
| POST | `/v1/auth/refresh` | rotates the refresh token |
| POST | `/v1/auth/logout` | revokes the refresh token |
| GET | `/v1/auth/me` | current user with memberships |

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

Listing uses keyset pagination (`?cursor=&limit=`) rather than `OFFSET`, because the delivery table grows without bound.

## Operational

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | none | liveness |
| GET | `/ready` | none | dependency readiness |
| GET | `/metrics` | none inside the network | Prometheus exposition |
| GET | `/docs` | none | Swagger UI over the generated OpenAPI document |

The OpenAPI document is generated from the same zod schemas the routes validate with, so the spec cannot drift from the implementation.
