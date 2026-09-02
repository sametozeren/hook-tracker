# Receiving Webhooks from hook-tracker

This guide is for the service on the other side: the one hook-tracker delivers to. Implementing all four rules below is what makes a receiver correct.

## What arrives

```http
POST /your/endpoint HTTP/1.1
Content-Type: application/json
User-Agent: HookTracker/1.0
X-Webhook-Id: dlv_9f2c1a...
X-Webhook-Event: order.created
X-Webhook-Attempt: 3
X-Webhook-Timestamp: 1756200000
X-Webhook-Signature: v1=8b1a9953c4611296a827abf8c47804d7...

{"orderId":1234,"total":99.9}
```

Respond `2xx` as soon as the payload is persisted. Do the real work asynchronously — the delivery times out after 10 seconds and a slow handler turns into a retry storm.

## Rule 1 — Verify the signature

The signed string is `<X-Webhook-Timestamp>.<raw request body>`. Sign it with HMAC-SHA256 using the endpoint secret and compare in constant time.

Sign the **raw bytes**, before any JSON parse or re-serialization. A parsed and re-stringified body changes key order and whitespace, and the signature will never match.

`X-Webhook-Signature` may carry more than one comma-separated `v1=` value during a secret rotation. Accept the request when **any** value matches.

## Rule 2 — Reject stale timestamps

Reject a request whose `X-Webhook-Timestamp` is more than 300 seconds away from your own clock. Without this check, a captured request can be replayed forever with a signature that still verifies.

## Rule 3 — Deduplicate on `X-Webhook-Id`

Delivery is at-least-once. A worker that crashes after sending the request but before committing its audit row will send that request again, and the retry ladder can also re-deliver an attempt your service actually received.

`X-Webhook-Id` is stable across every retry of the same delivery. Store it with a unique constraint and drop a repeat. `X-Webhook-Attempt` is informational only — never use it to decide whether you have seen the event.

A manual replay from the dashboard is a **new** delivery with a new id, and is meant to be processed again.

## Rule 4 — Answer with the right status

| Your response                            | What hook-tracker does                                                           |
| ---------------------------------------- | -------------------------------------------------------------------------------- |
| `2xx`                                    | marks the delivery `SUCCEEDED`                                                   |
| `408`, `425`, `429`, `5xx`               | retries on the schedule; `Retry-After` is honored when it exceeds the next delay |
| `400`, `401`, `403`, `404`, `410`, `422` | stops immediately and marks the delivery `FAILED_PERMANENTLY`                    |
| `3xx`                                    | treated as permanent — redirects are not followed                                |
| no response before the timeout           | retries                                                                          |

Return a permanent code only when a retry genuinely cannot help. A `500` for a validation problem burns all six attempts and hides a bug you would otherwise see on the first delivery.

## Node.js (Express)

```js
import express from 'express';
import crypto from 'node:crypto';

const app = express();
const SECRET = process.env.WEBHOOK_SECRET;
const TOLERANCE_SECONDS = 300;

app.post('/webhooks/hook-tracker', express.raw({ type: 'application/json' }), async (req, res) => {
  const timestamp = req.get('X-Webhook-Timestamp');
  const header = req.get('X-Webhook-Signature');
  const deliveryId = req.get('X-Webhook-Id');

  if (!timestamp || !header || !deliveryId) return res.sendStatus(400);

  const skew = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(skew) || skew > TOLERANCE_SECONDS) return res.sendStatus(400);

  const expected = crypto
    .createHmac('sha256', SECRET)
    .update(`${timestamp}.`)
    .update(req.body)
    .digest();

  const matches = header
    .split(',')
    .map((part) => part.trim().replace(/^v1=/, ''))
    .some((candidate) => {
      const received = Buffer.from(candidate, 'hex');
      return received.length === expected.length && crypto.timingSafeEqual(received, expected);
    });

  if (!matches) return res.sendStatus(401);

  const event = JSON.parse(req.body.toString('utf8'));
  const isNew = await storeIfAbsent(deliveryId, event);
  if (isNew) await enqueueForProcessing(deliveryId);

  res.sendStatus(200);
});
```

## Python (Flask)

```python
import hashlib
import hmac
import json
import time

from flask import Flask, request

app = Flask(__name__)
SECRET = os.environ["WEBHOOK_SECRET"].encode()
TOLERANCE_SECONDS = 300


@app.post("/webhooks/hook-tracker")
def receive():
    timestamp = request.headers.get("X-Webhook-Timestamp", "")
    header = request.headers.get("X-Webhook-Signature", "")
    delivery_id = request.headers.get("X-Webhook-Id", "")

    if not (timestamp and header and delivery_id):
        return "", 400

    try:
        skew = abs(int(time.time()) - int(timestamp))
    except ValueError:
        return "", 400
    if skew > TOLERANCE_SECONDS:
        return "", 400

    body = request.get_data()
    expected = hmac.new(SECRET, f"{timestamp}.".encode() + body, hashlib.sha256).hexdigest()

    candidates = [part.strip().removeprefix("v1=") for part in header.split(",")]
    if not any(hmac.compare_digest(expected, candidate) for candidate in candidates):
        return "", 401

    event = json.loads(body)
    if store_if_absent(delivery_id, event):
        enqueue_for_processing(delivery_id)

    return "", 200
```

## Testing your receiver

Use `POST /v1/endpoints/:endpointId/test` from the dashboard or the API. It sends a synthetic `ping` event through the normal pipeline — same signing, same headers, same retry rules — so a receiver that passes the test handles real traffic identically.
