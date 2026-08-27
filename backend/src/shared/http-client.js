import { Agent, request } from 'undici';

export const CAPTURED_RESPONSE_HEADERS = Object.freeze([
  'content-type',
  'content-length',
  'retry-after',
  'date',
  'x-request-id',
]);

const TIMEOUT_CODES = new Set([
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'ABORT_ERR',
]);

const DNS_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN']);

const CONNECTION_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
]);

export function classifyTransportError(error) {
  const code = error?.code ?? error?.cause?.code;

  if (error?.name === 'TimeoutError' || TIMEOUT_CODES.has(code)) return 'TIMEOUT';

  if (DNS_CODES.has(code)) return 'DNS';

  if (CONNECTION_CODES.has(code)) return 'CONNECTION';

  return 'REQUEST_FAILED';
}

function capture(headers) {
  return Object.fromEntries(
    CAPTURED_RESPONSE_HEADERS.filter((name) => headers[name] !== undefined).map((name) => [
      name,
      String(headers[name]),
    ]),
  );
}

async function readSnippet(body, limitBytes) {
  const chunks = [];
  let size = 0;

  for await (const chunk of body) {
    chunks.push(chunk);
    size += chunk.length;

    if (size >= limitBytes) {
      break;
    }
  }

  body.destroy();

  return Buffer.concat(chunks).subarray(0, limitBytes).toString('utf8');
}

// One dispatcher per attempt: the pinned address belongs to this attempt, and a
// pooled agent would reuse a connection opened for a different endpoint.
function pinnedDispatcher({ target, connectTimeoutMs, totalTimeoutMs }) {
  return new Agent({
    connect: {
      timeout: connectTimeoutMs,
      lookup: (hostname, options, callback) => {
        if (options?.all) {
          callback(null, [{ address: target.address, family: target.family }]);

          return;
        }

        callback(null, target.address, target.family);
      },
    },
    headersTimeout: totalTimeoutMs,
    bodyTimeout: totalTimeoutMs,
  });
}

export async function sendWebhook({
  target,
  headers,
  body,
  connectTimeoutMs,
  totalTimeoutMs,
  snippetBytes,
}) {
  const dispatcher = pinnedDispatcher({ target, connectTimeoutMs, totalTimeoutMs });
  const startedAt = Date.now();

  try {
    // Redirects are never followed: a redirecting endpoint is a configuration
    // error, and following one would leave the pinned address behind.
    const response = await request(target.url, {
      method: 'POST',
      headers,
      body,
      dispatcher,
      maxRedirections: 0,
      signal: AbortSignal.timeout(totalTimeoutMs),
    });

    return {
      responseStatus: response.statusCode,
      responseHeaders: capture(response.headers),
      responseBodySnippet: await readSnippet(response.body, snippetBytes),
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      errorCode: classifyTransportError(error),
      errorMessage: error.message,
      durationMs: Date.now() - startedAt,
    };
  } finally {
    await dispatcher.close();
  }
}
