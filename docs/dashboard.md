# Dashboard Specification

Vue 3 (Composition API, `<script setup>`) with TailwindCSS, built by Vite and served by nginx. It is an operator tool, not a marketing surface: the first question it answers is always "is anything failing right now, and which endpoint".

## Principles

- **State before detail.** Every list leads with status, then time, then identity. A failing delivery must be recognizable without reading text.
- **Status is a colour and a shape, never colour alone.** `SUCCEEDED`, `RETRYING`, `FAILED_PERMANENTLY`, `PENDING`, `IN_FLIGHT` and `SKIPPED` each get a distinct pill with its own label; colour-blind users and greyscale screenshots must still be readable.
- **Live, not noisy.** Socket.io updates rows in place. New rows arriving while the operator is reading are counted in a "N new deliveries" bar the operator clicks to apply, rather than shifting the list under the cursor.
- **Nothing is secret twice.** API keys and endpoint secrets are shown once, in a modal that states plainly that the value cannot be retrieved later.

## Screens

### Login / Register

Email and password. Registration is open to anyone: it creates a new project and makes the registering user its `OWNER`, and an email already in use is rejected with `409`. Failed login says the credentials are wrong without revealing which half. The intended model is an owner creating users for their own project, with open registration closing once the first one exists; that change is not built yet and is tracked in `docs/roadmap.md`.

### Shell

Persistent project switcher, primary navigation (Deliveries, Endpoints, Events, Settings), a connection indicator for the realtime socket, and the signed-in user menu. A dropped socket shows a reconnecting state instead of silently going stale.

The switcher also creates projects, since a user may own more than one and the API places no limit on that. A signed-in account with no membership — the state left behind when someone is removed from their only project — lands on the same creation screen rather than on a project route that would redirect it straight back to login.

### Deliveries — the default screen

Cursor-paginated table: status pill, event type, endpoint, attempt count, last response code, duration, relative time. Filters for status, endpoint, event type and a date range, all reflected in the URL so a filtered view can be shared or bookmarked.

Header strip: counts by status for the selected range, plus a small success-rate sparkline. Bulk replay acts on the current filter, states the exact number of deliveries it will replay, and warns when the filter exceeds `BULK_REPLAY_LIMIT`.

### Delivery detail

The event payload (JSON, collapsible, copyable), the outgoing headers that were sent, and an attempt timeline. Each attempt shows its number, timestamp, response status, duration, and the captured response snippet or error message. The next scheduled retry is shown as an absolute time and a countdown.

Actions: Replay, and Copy as cURL — a ready-to-run request against the same endpoint, useful when debugging with the receiving team.

### Endpoints

List with URL, status, subscribed event types, rate limit and consecutive failure count. A disabled endpoint is called out with why and when it was disabled, and offers Enable.

Create and edit run the SSRF check on submit and report a blocked target inline, naming what was rejected (private address, blocked port, unsupported scheme).

Secret rotation shows the grace window explicitly: both signatures are being sent, and this is the time by which the receiver must accept the new one.

Send test event delivers a synthetic `ping` and links to the resulting delivery.

### Events

Ingested events with their fan-out: one event, the deliveries it produced, and each delivery's status. Useful when one endpoint succeeded and another did not for the same event.

The screen reads the event endpoint, so it lists what the project received rather than what the delivery list happened to load. Search takes a path and a value — `customer.id` and `cus_9` — and finds events whose payload contains exactly that, which is the question an operator arrives with: this order was not delivered, where did it go. The screen says the match is exact rather than letting someone infer substring search from an empty result.

### Settings

Project name, the alert address, members and roles, API keys (create, list by prefix and last-used, revoke). Owner-only actions are hidden rather than disabled for members, except where hiding would make the interface confusing.

The alert address states what it is for before it asks for a value — an endpoint disabled by repeated failures, a dead-letter backlog, an unreachable dependency — and that the request is neither signed nor retried, so nobody builds a delivery guarantee on it. Clearing the field turns alerts off. A URL the delivery pipeline would refuse is refused here too, and the reason appears next to the field rather than as a banner, because the field is what has to change.

## Empty, loading and error states

Every list defines three states beyond its populated one:

- **Empty and expected** — a new project with no deliveries yet gets the setup path: create an endpoint, copy the API key, send the first event, with the exact `curl` command.
- **Empty because of filters** — says which filters are active and offers to clear them.
- **Failed to load** — states what failed and offers Retry. An expired session redirects to login preserving the intended destination.

Tables render a skeleton on first load; realtime updates never show a spinner.

## Accessibility and responsiveness

Keyboard reachable throughout with a visible focus ring. Status pills carry text, not only colour. The layout targets a desktop operator; below `md` the tables collapse to stacked cards keeping status, endpoint and time.

Dark mode follows the system preference and is togglable, since this screen is often left open on a wall display.
