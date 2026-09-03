# Connection-Pool Sizing

Scaling `worker` replicas multiplies Prisma connection pools against PostgreSQL's
default `max_connections` of 100. This page explains how to size the pool so the
stack does not exhaust that limit.

## Why this matters

Every hook-tracker process that imports `shared/db.js` holds a pool of persistent
PostgreSQL connections. The compose topology has four such processes:

| Service    | Replicas (default) | Holds a pool? |
|------------|--------------------|---------------|
| `api`      | 1                  | yes           |
| `worker`   | 1 (scalable)       | yes           |
| `jobs`     | 1                  | yes           |
| `migrate`  | one-shot           | yes, briefly  |

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

The Prisma `@prisma/adapter-pg` adapter accepts a pool size through the `pg.Pool`
constructor in `backend/src/shared/db.js`. Add a `DATABASE_POOL_SIZE` variable to
your `.env` (and `.env.example`) and wire it in:

```js
// backend/src/shared/db.js  (relevant excerpt)
import { Pool } from 'pg'
import { PrismaClient } from '../generated/prisma/index.js'
import { PrismaPg } from '@prisma/adapter-pg'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.DATABASE_POOL_SIZE ?? '10', 10),
})
```

Add the variable to `.env.example`:

```dotenv
# Number of Postgres connections each process may hold.
# Formula: floor((pg_max_connections - 3) / (api + workers + jobs replicas))
# Default of 10 is safe for up to 9 total replicas against pg max_connections=100.
DATABASE_POOL_SIZE=10
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

> **Note:** Each Postgres connection uses roughly 5–10 MB of shared memory.
> Raising `max_connections` to 200 may require a corresponding increase to
> `shared_buffers` (e.g., `256MB`) in memory-constrained environments.

## PgBouncer for high worker counts

When `worker` replicas exceed ~10, a connection pooler such as
[PgBouncer](https://www.pgbouncer.org/) in *transaction-mode* keeps the
PostgreSQL server connection count independent of the application process count.
In transaction mode each application-side connection uses a server connection
only for the duration of a single transaction, so dozens of worker replicas can
share a small server-side pool.

Add PgBouncer as an extra compose service and point `DATABASE_URL` at it
(`pgbouncer:6432`) instead of directly at `postgres`. The Prisma adapter requires
no changes; PgBouncer is transparent to the application.

## Quick-reference table

| pg `max_connections` | Superuser reserve | Total replicas | Safe `DATABASE_POOL_SIZE` |
|----------------------|-------------------|----------------|---------------------------|
| 100 (default)        | 3                 | 5              | 19                        |
| 100 (default)        | 3                 | 10             | 9                         |
| 200                  | 3                 | 10             | 19                        |
| 200                  | 3                 | 20             | 9                         |

## See also

- [Architecture — §11 Data Model](architecture.md) — Prisma / PostgreSQL overview
- [Architecture — §16 Configuration Reference](architecture.md) — full variable list
- [Roadmap — item 18](roadmap.md) — the issue that prompted this page
- [Prisma connection management](https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/databases-connections)
- [PgBouncer documentation](https://www.pgbouncer.org/config.html)
