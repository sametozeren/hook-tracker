# Connection-Pool Sizing

Scaling `worker` replicas multiplies Prisma connection pools against PostgreSQL's
default `max_connections` of 100. This page explains how to size the pool so the
stack does not exhaust that limit.

## Why this matters

Three long-lived hook-tracker services (`api`, `worker`, `jobs`) import `shared/db.js`
and hold persistent PostgreSQL connection pools. In addition, the one-shot `migrate`
service runs `prisma migrate deploy` via the Prisma CLI, opening connections briefly
during startup:

| Service   | Replicas (default) | Holds a pool?                 |
| --------- | ------------------ | ----------------------------- |
| `api`     | 1                  | yes (via `shared/db.js`)      |
| `worker`  | 1 (scalable)       | yes (via `shared/db.js`)      |
| `jobs`    | 1                  | yes (via `shared/db.js`)      |
| `migrate` | one-shot           | yes, briefly (via Prisma CLI) |

Workers scale independently via `deploy.replicas`. Each additional worker replica
opens its own pool. PostgreSQL's default `max_connections` is **100**, and that
ceiling is shared across every process on every host.

## Calculating the safe pool size per process

```
max_connections = (api_replicas + worker_replicas + jobs_replicas) × pool_size
                 + superuser reserve (typically 3)
```

Rearranging for `pool_size`:

```
pool_size = floor((max_connections - superuser_reserve) / total_process_count)
```

**Example — 3 worker replicas, default Postgres:**

```
total_process_count = 1 (api) + 3 (workers) + 1 (jobs) = 5
pool_size = floor((100 - 3) / 5) = 19
```

## Setting the pool size

The Prisma `@prisma/adapter-pg` adapter accepts `pg.PoolConfig` fields directly, so the pool
size is configured where the adapter is constructed in `backend/src/shared/db.js`.

The stack wires `DATABASE_POOL_SIZE` end to end across three files:

1. In `backend/src/shared/env-schema.js`, the variable is validated and defaulted in the Infrastructure block:

```js
// backend/src/shared/env-schema.js (Infrastructure block)
DATABASE_POOL_SIZE: z.coerce.number().int().min(1).default(10);
```

2. In `.env.example`, the key is documented for operators:

```dotenv
# Maximum number of Postgres connections each process may hold (default: 10).
# Formula: floor((pg_max_connections - 3) / (api + workers + jobs replicas))
DATABASE_POOL_SIZE=10
```

3. In `backend/src/shared/db.js`, `createPrismaClient` passes `config.DATABASE_POOL_SIZE` as `max` to the adapter:

```js
// backend/src/shared/db.js (relevant excerpt)
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../generated/prisma/client.ts';
import { config } from './config.js';

export function createPrismaClient({ connectionString = config.DATABASE_URL } = {}) {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString, max: config.DATABASE_POOL_SIZE }),
  });
}
```

## Raising `max_connections` on the Postgres side

For larger deployments it is more efficient to raise `max_connections` in the
Postgres configuration than to keep the per-process pool tiny. Add a `command`
override to the `postgres` service in `docker-compose.yml`:

```yaml
postgres:
  image: postgres:17-alpine
  command: postgres -c max_connections=200
  # ... rest of the service definition
```

> **Note:** Each Postgres connection consumes roughly 5–10 MB of private memory
> per backend process. Raising `max_connections` increases host RAM usage proportionally
> and should be planned against available memory.

## PgBouncer for high worker counts

When `worker` replicas exceed ~10, a connection pooler such as
[PgBouncer](https://www.pgbouncer.org/) in _transaction-mode_ keeps the
PostgreSQL server connection count independent of the application process count.
In transaction mode each application-side connection uses a server connection
only for the duration of a single transaction, so dozens of worker replicas can
share a small server-side pool.

Add PgBouncer as an extra compose service and point `DATABASE_URL` at it
(`pgbouncer:6432`) instead of directly at `postgres`. The Prisma adapter requires
no changes; PgBouncer is transparent to the application.

## Quick-reference table

| pg `max_connections` | Superuser reserve | Total replicas | Safe `DATABASE_POOL_SIZE` |
| -------------------- | ----------------- | -------------- | ------------------------- |
| 100 (default)        | 3                 | 5              | 19                        |
| 100 (default)        | 3                 | 10             | 9                         |
| 200                  | 3                 | 10             | 19                        |
| 200                  | 3                 | 20             | 9                         |

## See also

- [Architecture — §11 Data Model](architecture.md) — Prisma / PostgreSQL overview
- [Architecture — §16 Configuration Reference](architecture.md) — full variable list
- [Roadmap](roadmap.md) — what is not built yet
- [Prisma connection management](https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/databases-connections)
- [PgBouncer documentation](https://www.pgbouncer.org/config.html)
