# Dashboard Specification

Vue 3 (Composition API, `<script setup>`) with TailwindCSS, built by Vite and served by nginx. It is an operator tool, not a marketing surface: the first question it answers is always "is anything failing right now, and which endpoint".

## Principles

- **State before detail.** Every list leads with status, then time, then identity. A failing delivery must be recognizable without reading text.
- **Status is a colour and a shape, never colour alone.** `SUCCEEDED`, `RETRYING`, `FAILED_PERMANENTLY`, `PENDING`, `IN_FLIGHT` and `SKIPPED` each get a distinct pill with its own label; colour-blind users and greyscale screenshots must still be readable.
- **Live, not noisy.** Socket.io updates rows in place. New rows arriving while the operator is reading are counted in a "N new deliveries" bar the operator clicks to apply, rather than shifting the list under the cursor.
- **Nothing is secret twice.** API keys and endpoint secrets are shown once, in a modal that states plainly that the value cannot be retrieved later.

## Screens

### Login / Register
Email and password. Register is only offered when the instance has no user yet — the first account creates its project and becomes `OWNER`. Failed login says the credentials are wrong without revealing which half.

### Shell
Persistent project switcher, primary navigation (Deliveries, Endpoints, Events, Settings), a connection indicator for the realtime socket, and the signed-in user menu. A dropped socket shows a reconnecting state instead of silently going stale.

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

### Settings
Project name, members and roles, API keys (create, list by prefix and last-used, revoke). Owner-only actions are hidden rather than disabled for members, except where hiding would make the interface confusing.

## Empty, loading and error states

Every list defines three states beyond its populated one:

- **Empty and expected** — a new project with no deliveries yet gets the setup path: create an endpoint, copy the API key, send the first event, with the exact `curl` command.
- **Empty because of filters** — says which filters are active and offers to clear them.
- **Failed to load** — states what failed and offers Retry. An expired session redirects to login preserving the intended destination.

Tables render a skeleton on first load; realtime updates never show a spinner.

## Accessibility and responsiveness

Keyboard reachable throughout with a visible focus ring. Status pills carry text, not only colour. The layout targets a desktop operator; below `md` the tables collapse to stacked cards keeping status, endpoint and time.

Dark mode follows the system preference and is togglable, since this screen is often left open on a wall display.
