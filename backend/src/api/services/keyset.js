import { ValidationError } from '../../shared/errors.js';

const SEPARATOR = '|';

// Keyset rather than OFFSET: the delivery table grows without bound, and an
// offset scan gets slower with every page the caller walks.
export function encodeCursor({ createdAt, id }) {
  return Buffer.from(`${createdAt.toISOString()}${SEPARATOR}${id}`, 'utf8').toString('base64url');
}

export function decodeCursor(cursor) {
  const [createdAt, id] = Buffer.from(cursor, 'base64url').toString('utf8').split(SEPARATOR);
  const at = new Date(createdAt);

  if (!id || Number.isNaN(at.getTime())) {
    throw new ValidationError('The cursor is malformed', [
      { path: 'cursor', message: 'expected a cursor returned by a previous page' },
    ]);
  }

  return { createdAt: at, id };
}

// createdAt alone is not unique, so the id breaks ties. Without it a page
// boundary that lands inside a group of same-millisecond rows would repeat or
// skip them.
export function olderThan({ createdAt, id }) {
  return {
    OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: id } }],
  };
}

export function paginate(rows, limit) {
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  return {
    page,
    nextCursor: hasMore ? encodeCursor(page[page.length - 1]) : null,
  };
}
