const PROBLEM_TYPE_PREFIX = 'urn:hook-tracker:error:';

export class ApiError extends Error {
  constructor({ status, problem, requestId }) {
    super(problem?.detail || problem?.title || `Request failed with ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.type = problem?.type ?? '';
    this.title = problem?.title ?? '';
    this.detail = problem?.detail ?? '';
    this.errors = problem?.errors ?? [];
    this.requestId = problem?.requestId ?? requestId ?? '';
  }

  get kind() {
    return this.type.startsWith(PROBLEM_TYPE_PREFIX)
      ? this.type.slice(PROBLEM_TYPE_PREFIX.length)
      : '';
  }

  fieldErrors() {
    const map = {};

    for (const issue of this.errors) {
      const key = String(issue.path ?? '').replace(/^body\./, '');

      if (!map[key]) {
        map[key] = issue.message;
      }
    }

    return map;
  }
}

export function isUnauthorized(error) {
  return error instanceof ApiError && error.status === 401;
}
