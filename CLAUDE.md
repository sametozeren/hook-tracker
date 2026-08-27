# Project: hook-tracker — Webhook Gateway & Retry Engine

## Mandatory Pre-requisite
- Before writing any code, planning tasks, or answering questions, thoroughly read **`docs/architecture.md`**, **`docs/api.md`**, **`docs/guidelines.md`**, **`docs/dashboard.md`** and **`docs/code-review.md`**. Follow the phase order in **`docs/implementation-plan.md`**. All implementations must strictly align with the data flow, queue mechanisms, and entity models defined in those documents.

## Core Constraints
- **Git Operations are STRICTLY FORBIDDEN:** Under no circumstances should you execute `git commit`, `git push`, `git pull`, `git checkout`, branch creations, or any Git command. Version control is handled entirely and manually by the user.
- **Module System (ESM):** All Node.js packages must use ECMAScript Modules (ESM) standard (`"type": "module"`). Use `import/export` syntax instead of `require`.

## Code Review Rules
- **`docs/code-review.md` is binding.** Apply its CR rules while writing code, and check the changed files against them again before reporting a change as complete. Report a finding as `CR-<n>, <file>:<line>`.
- Rules that a linter can enforce are enforced there rather than by review; `npm run lint` must be clean in both packages.

## Commenting Standards
- Do not add comments by default. Prioritize readable code, expressive naming, and small single-purpose functions.
- Do not write comments that merely rephrase what the code does.
- Only comment on non-obvious context verifiable within the codebase:
  * Business rules and intentional exceptions,
  * Technical constraints and workarounds,
  * Security or performance trade-offs,
  * Unexpected behaviors of external systems,
  * Intentional implementations that look like bugs at first glance.

## Agent & Skill Usage
- You may utilize multiple agents in parallel when solving problems or writing code.
- You are fully authorized to autonomously invoke available tools and skills such as `context7`, `frontend-design`, `context-mode`, and any sub-agents. Do not ask for user confirmation before calling these tools; invoke them directly as needed.

## Tech Stack
- **Module Format:** ES Modules (ESM - `"type": "module"`)
- **Backend:** Node.js (JavaScript), Express.js
- **Database & ORM:** PostgreSQL, Prisma ORM
- **Message Broker:** RabbitMQ (TTL + DLX retry chain, no plugins)
- **Cache & Rate Limit:** Redis
- **Real-Time Communication:** Socket.io
- **Frontend:** Vue.js 3, TailwindCSS
- **Auth:** JWT (dashboard) + hashed API keys (ingestion), argon2id passwords
- **Validation:** zod (request payloads and environment schema)
- **Testing:** Vitest + Testcontainers (real Postgres, Redis, RabbitMQ)
- **Infrastructure:** Docker, Docker Compose

## Repository Layout
- `backend/` and `dashboard/` are separate packages with separate `node_modules`. No root workspace.
- Backend builds one image with four entrypoints: `src/api`, `src/worker`, `src/jobs`, `src/demo-receiver`, sharing `src/shared`.
- Never run `npm install` at the repository root.