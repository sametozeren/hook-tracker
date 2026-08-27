import { ValidationError, issuesToErrors } from '../../shared/errors.js';

function parse(schema, value, source) {
  const result = schema.safeParse(value);

  if (!result.success) {
    throw new ValidationError(
      `The request ${source} failed validation`,
      issuesToErrors(result.error.issues),
    );
  }

  return result.data;
}

export function validateBody(schema) {
  return function validate(req, res, next) {
    req.validated = parse(schema, req.body, 'body');

    next();
  };
}

export function validateQuery(schema) {
  return function validate(req, res, next) {
    req.validatedQuery = parse(schema, req.query, 'query string');

    next();
  };
}
