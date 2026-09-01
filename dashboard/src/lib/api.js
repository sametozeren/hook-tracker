import { ApiError } from './problem.js';

const BASE = '/v1';

let getAccessToken = null;
let refreshSession = null;
let onSessionLost = null;
let inflightRefresh = null;

export function configureApi(handlers) {
  getAccessToken = handlers.getAccessToken ?? getAccessToken;
  refreshSession = handlers.refreshSession ?? refreshSession;
  onSessionLost = handlers.onSessionLost ?? onSessionLost;
}

function buildUrl(path, query) {
  const url = `${BASE}${path}`;

  if (!query) {
    return url;
  }

  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') {
      params.set(key, String(value));
    }
  }

  const search = params.toString();

  return search ? `${url}?${search}` : url;
}

async function readBody(response) {
  if (response.status === 204) {
    return null;
  }

  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

// One refresh at a time: a page that fires several requests at once would
// otherwise rotate the refresh cookie concurrently, and the loser of that race
// presents an already-revoked token and logs the user out.
function refreshOnce() {
  if (!refreshSession) {
    return Promise.resolve(false);
  }

  if (!inflightRefresh) {
    inflightRefresh = refreshSession()
      .then((ok) => ok)
      .catch(() => false)
      .finally(() => {
        inflightRefresh = null;
      });
  }

  return inflightRefresh;
}

async function send(path, options, query) {
  const headers = { Accept: 'application/json', ...(options.headers ?? {}) };
  const token = options.auth === false ? null : (getAccessToken?.() ?? null);

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const init = {
    method: options.method ?? 'GET',
    headers,
    credentials: 'same-origin',
    signal: options.signal,
  };

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(options.body);
  }

  return fetch(buildUrl(path, query), init);
}

export async function request(path, options = {}) {
  const { query, retryOnUnauthorized = true, ...rest } = options;
  let response = await send(path, rest, query);

  if (response.status === 401 && rest.auth !== false && retryOnUnauthorized) {
    const refreshed = await refreshOnce();

    if (!refreshed) {
      const body = await readBody(response);

      onSessionLost?.();

      throw new ApiError({
        status: 401,
        problem: body,
        requestId: response.headers.get('X-Request-Id'),
      });
    }

    response = await send(path, rest, query);
  }

  const body = await readBody(response);

  if (!response.ok) {
    throw new ApiError({
      status: response.status,
      problem: body,
      requestId: response.headers.get('X-Request-Id'),
    });
  }

  return body;
}

export const api = {
  get: (path, query, options = {}) => request(path, { ...options, method: 'GET', query }),
  post: (path, body, options = {}) => request(path, { ...options, method: 'POST', body }),
  patch: (path, body, options = {}) => request(path, { ...options, method: 'PATCH', body }),
  delete: (path, options = {}) => request(path, { ...options, method: 'DELETE' }),
};
