import {
  AppError,
  NotFoundError,
  PayloadTooLargeError,
  ValidationError,
  toProblem,
} from '../../shared/errors.js';

// body-parser reports its own failures with a `type` field rather than a
// status, so they are translated before they reach the problem renderer.
function normalise(error) {
  if (error instanceof AppError) {
    return error;
  }

  if (error?.type === 'entity.too.large') {
    return new PayloadTooLargeError('The request body exceeds MAX_PAYLOAD_BYTES');
  }

  if (error?.type === 'entity.parse.failed') {
    return new ValidationError('The request body is not valid JSON');
  }

  return error;
}

export function notFoundHandler(req, res, next) {
  next(new NotFoundError(`No route matches ${req.method} ${req.path}`));
}

export function errorHandler(error, req, res, _next) {
  const normalised = normalise(error);
  const problem = toProblem(normalised, { instance: req.originalUrl, requestId: req.id });

  if (problem.status >= 500) {
    req.log?.error({ err: normalised }, 'request failed');
  } else {
    req.log?.warn({ status: problem.status, type: problem.type }, 'request rejected');
  }

  for (const [header, value] of Object.entries(normalised?.headers ?? {})) {
    res.setHeader(header, value);
  }

  res.status(problem.status).type('application/problem+json').send(JSON.stringify(problem));
}
