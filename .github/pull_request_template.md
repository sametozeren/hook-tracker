## What this changes

<!-- One or two sentences. Link the issue if there is one. -->

## How it was verified

<!-- The commands you ran and what you observed. "Assumed" is not verified. -->

## Definition of done

From `docs/implementation-plan.md`.

- [ ] `npm run lint` and `npm run format` clean in **both** `backend/` and `dashboard/`
- [ ] New behavior covered by a test at the right level — unit for pure logic,
      integration for anything touching Postgres, Redis or RabbitMQ
- [ ] `.env.example` covers every new variable, with a safe default or an explicitly
      invalid placeholder
- [ ] No secret, token, endpoint URL or payload added to a log line
- [ ] The affected spec document in `docs/` updated in the same change
- [ ] Migration generated with `prisma migrate dev` and the SQL committed (or: no
      schema change)
- [ ] The acceptance check was actually run and its output observed
