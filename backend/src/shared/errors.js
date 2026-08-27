const TYPE_PREFIX = 'urn:hook-tracker:error:';

export class AppError extends Error {
  constructor({ status, type, title, detail, headers, errors }) {
    super(detail ?? title);

    this.name = new.target.name;
    this.status = status;
    this.type = `${TYPE_PREFIX}${type}`;
    this.title = title;
    this.detail = detail;
    this.headers = headers;
    this.errors = errors;
  }
}

export class ValidationError extends AppError {
  constructor(detail, errors) {
    super({ status: 400, type: 'validation-failed', title: 'Validation failed', detail, errors });
  }
}

export class UnauthorizedError extends AppError {
  constructor(detail) {
    super({ status: 401, type: 'unauthorized', title: 'Unauthorized', detail });
  }
}

export class ForbiddenError extends AppError {
  constructor(detail) {
    super({ status: 403, type: 'forbidden', title: 'Forbidden', detail });
  }
}

export class NotFoundError extends AppError {
  constructor(detail) {
    super({ status: 404, type: 'not-found', title: 'Not found', detail });
  }
}

export class ConflictError extends AppError {
  constructor(detail) {
    super({ status: 409, type: 'conflict', title: 'Conflict', detail });
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(detail) {
    super({ status: 413, type: 'payload-too-large', title: 'Payload too large', detail });
  }
}

export class UnprocessableError extends AppError {
  constructor(detail) {
    super({ status: 422, type: 'unprocessable', title: 'Unprocessable request', detail });
  }
}

export class RateLimitedError extends AppError {
  constructor(detail, headers) {
    super({ status: 429, type: 'rate-limited', title: 'Rate limit exceeded', detail, headers });
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(detail, errors) {
    super({
      status: 503,
      type: 'service-unavailable',
      title: 'Service unavailable',
      detail,
      errors,
    });
  }
}

export function toProblem(error, { instance, requestId }) {
  if (error instanceof AppError) {
    return {
      type: error.type,
      title: error.title,
      status: error.status,
      detail: error.detail,
      instance,
      requestId,
      ...(error.errors ? { errors: error.errors } : {}),
    };
  }

  return {
    type: `${TYPE_PREFIX}internal`,
    title: 'Internal server error',
    status: 500,
    instance,
    requestId,
  };
}

export function issuesToErrors(issues) {
  return issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}
