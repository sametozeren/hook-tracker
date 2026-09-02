# Contributing to hook-tracker

Thanks for taking the time. This file covers how to get the project running, how to
run each test suite, and what a change is checked against before it is merged. The
specifications themselves live in `docs/`; this file points at them rather than
repeating them, so there is only one copy to keep correct.

Read before you start:

- `docs/architecture.md` — data flow, queue topology, entity model
- `docs/api.md` — the HTTP contract
- `docs/dashboard.md` — the dashboard's behavior
- `docs/guidelines.md` — architectural, security, testing and database rules
- `docs/code-review.md` — the numbered rules every change is reviewed against
- `docs/implementation-plan.md` — phase order and the Definition of Done

## Setup

Node 24 is pinned in `.nvmrc` and in `engines` in both `package.json` files, and it
matches the Docker base image. The Prisma client is emitted as TypeScript and run
through Node's type stripping, which is why an older Node cannot run the backend.

`backend/` and `dashboard/` are independent packages with their own `node_modules`.
There is no root workspace — **never run `npm install` at the repository root**.

```bash
cp .env.example .env

cd backend && npm install && cd ..
cd dashboard && npm install && cd ..
```

The whole stack runs under Docker Compose:

```bash
docker compose up -d --build
docker compose run --rm migrate npm run seed
```

That gives you Postgres, Redis, RabbitMQ, the API on `:3000`, the workers, the
maintenance jobs, the dashboard on `:8080`, and a demo receiver. The 60-second
version of this is in `README.md`.

`.env.example` is the authoritative list of configuration keys, each one validated by
a zod schema at startup. A process exits rather than starting degraded when a value is
missing or malformed.

## Running the tests

All test commands run from `backend/`.

```bash
npm test                 # unit — pure logic, no containers
npm run test:integration # integration — Testcontainers: real Postgres, Redis, RabbitMQ
npm run test:docker      # standalone Docker environment probe
```

Notes that save time:

- The integration files share one container stack, started once by
  `tests/support/global-setup.js`. Isolation comes from a per-file queue namespace and
  a per-file project row, not from a container each, so the files do not run in
  parallel.
- `tests/integration/docker-environment.test.js` deliberately sits outside that global
  setup. Run `npm run test:docker` first when the integration suite fails in a way that
  smells environmental — it tells a Docker fault apart from a code fault.
- The integration suite reaches `src/shared/config.js`, which exits on an invalid
  environment. A root `.env` must exist before you run it.
- `src/generated/` is not committed. Run `npx prisma generate` after a fresh clone or
  a schema change.
- Tests never sleep on the wall clock for the retry ladder; the schedule is injected so
  intervals collapse to milliseconds.

Which level a change belongs at: unit for pure logic (retry-level selection, failure
classification, signature construction, env schema parsing), integration for anything
touching Postgres, Redis or RabbitMQ. `docs/guidelines.md` § Testing lists the
integration coverage the project requires.

## Code standards

ESLint and Prettier are authoritative. Formatting is not discussed in review:

```bash
cd backend   && npm run lint && npm run format
cd dashboard && npm run lint && npm run format
```

`npm run format:write` fixes formatting in place. Both must be clean in both packages.

The Markdown outside the two packages — this file, the README, `CHANGELOG.md` and everything
under `docs/` — shares the same `.prettierrc.json` but belongs to no package, so it is checked
with the binary one of them already installed:

```bash
./backend/node_modules/.bin/prettier --check "*.md" "docs/**/*.md"
```

Add `--write` to fix it. A specification that drifts out of format produces diffs about
whitespace instead of about behaviour, which is the thing the formatter exists to prevent.

Beyond what the linter enforces:

- **CR-1 (blank lines around definitions and blocks)** in `docs/code-review.md` is a
  lint rule, not a review preference. The other CR rules in that file are reviewed by
  hand; a finding is reported as `CR-<n>, <file>:<line>`.
- **Comments** follow the rules in `CLAUDE.md`: no comments by default, none that
  restate the code. Comment only non-obvious context that can be verified in the
  codebase — a business rule, a technical constraint or workaround, a security or
  performance trade-off, an external system behaving unexpectedly, or something that
  looks like a bug but is intentional.
- **ESM only.** `"type": "module"` in both packages; `import`/`export`, never
  `require`.
- **Shared truth stays shared.** Queue names, the retry schedule, the delivery status
  enum and the HMAC function live in `backend/src/shared` only. Duplicating one of them
  into `api/` or `worker/` is a defect — the two processes must never be able to
  disagree.

## Database changes

Schema changes go through `prisma migrate dev`, and the generated SQL is committed
alongside the `schema.prisma` change:

```bash
cd backend
npx prisma migrate dev --name <short_name>
```

Containers run `prisma migrate deploy` at startup; nothing runs `db push`. Prisma has
no automatic down-migrations, so a change that drops or renames a column ships as an
expand-and-contract pair — add the new shape, migrate the data, remove the old one in a
later release. Every query a list view issues must be backed by an index declared in
`schema.prisma`.

## Specs and behavior change together

`docs/` is the specification, not documentation written after the fact. If your change
alters a decision the specs describe — an endpoint's contract, the queue topology, a
security property, the dashboard's behavior — update the affected document **in the
same change**. A spec that disagrees with the code is worse than no spec.

## Definition of done

From the top of `docs/implementation-plan.md`, and repeated in the pull request
template:

- Lint and format clean in both packages
- New behavior covered by a test at the right level
- `.env.example` covers every new variable, with a safe default or an explicitly
  invalid placeholder
- No secret, token, endpoint URL or payload added to a log line
- The affected spec document updated in the same change
- The acceptance check actually run and its output observed, not assumed

## Before opening a pull request

There is no CI pipeline: the checks above are run locally, by you, and their output is
the evidence. Run lint, Prettier and both test suites in the packages you touched, and
say in the pull request what you ran and what it printed.

## Reporting a security issue

Do not open a public issue. See `SECURITY.md`.
