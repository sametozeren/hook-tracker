import { ValidationError, issuesToErrors } from '../../shared/errors.js';

export function validateBody(schema) {
  return function validate(req, res, next) {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      throw new ValidationError(
        'The request body failed validation',
        issuesToErrors(result.error.issues),
      );
    }

    req.validated = result.data;

    next();
  };
}
