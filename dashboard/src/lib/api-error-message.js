const FALLBACK = 'The request failed. Try again, or check the API logs.';

// The API answers a non-member with 404, not 403 (assertMembership), so a 404 on
// a project-scoped write can also mean "you are no longer in this project".
export function describeApiError(error, byStatus = {}) {
  if (!error) {
    return '';
  }

  const override = byStatus[error.status];

  if (override) {
    return override;
  }

  const fieldMessage = typeof error.fieldErrors === 'function' ? firstField(error) : '';

  return fieldMessage || error.detail || error.message || FALLBACK;
}

function firstField(error) {
  const values = Object.values(error.fieldErrors());

  return values.length > 0 ? values[0] : '';
}
