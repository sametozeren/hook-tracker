# hook-tracker

A webhook gateway and retry engine. It accepts events from your backend and takes
responsibility for getting them delivered to third-party endpoints — retrying on a
TTL/DLX ladder when the receiver is down, signing every request, and keeping a full
audit trail of each attempt.

> **Status: under construction.** Phase 0 (repository skeleton) is complete. See
> [`docs/implementation-plan.md`](docs/implementation-plan.md) for what lands when.

## Quickstart

```bash
cp .env.example .env
docker compose up
```

`GET http://localhost:3000/health` answers once the API is up. The dashboard is served
on http://localhost:8080.

`.env.example` ships placeholder values for `JWT_SECRET` and `SECRET_ENCRYPTION_KEY` that
work for local development and are **refused** when `NODE_ENV=production`. Generate real
ones with:

```bash
openssl rand -hex 32
```

`SECRET_ENCRYPTION_KEY` cannot be rotated without re-encrypting every stored endpoint
secret; that migration is out of scope for v1.

## Layout

| Path | What it is |
|---|---|
| `backend/` | Node 24 + Express. One image, four entrypoints: `api`, `worker`, `jobs`, `demo-receiver`, sharing `src/shared`. |
| `dashboard/` | Vue 3 + Vite + Tailwind, served by nginx, proxying `/v1` and `/socket.io` to the API. |
| `docs/` | The specification. Read it before changing behavior. |

`backend/` and `dashboard/` are independent packages with their own `node_modules`.
There is no root workspace — never run `npm install` at the repository root.

## Documentation

| Document | Contents |
|---|---|
| [`docs/architecture.md`](docs/architecture.md) | Data flow, queue topology, retry ladder, SSRF guard, data model, configuration reference |
| [`docs/api.md`](docs/api.md) | The v1 HTTP contract |
| [`docs/dashboard.md`](docs/dashboard.md) | Operator UI specification |
| [`docs/guidelines.md`](docs/guidelines.md) | Coding, security and testing rules |
| [`docs/implementation-plan.md`](docs/implementation-plan.md) | Phase order and completion state |
| [`docs/receiving-webhooks.md`](docs/receiving-webhooks.md) | For teams on the receiving end |

## Local development

Node 24 is the pinned runtime (`.nvmrc`, `engines`, and the Docker base image all agree).

```bash
cd backend && npm install
cd ../dashboard && npm install
```

Both packages expose `npm run lint` and `npm run format`. The backend adds
`npm test` (unit), `npm run test:integration` (Testcontainers, real Postgres,
Redis and RabbitMQ) and `npm run test:docker`, a one-test probe that tells a
Docker problem apart from a code one.

## License

MIT — see [`LICENSE`](LICENSE).
