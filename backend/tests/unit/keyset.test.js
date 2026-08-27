import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor, olderThan, paginate } from '../../src/api/services/keyset.js';

const row = { createdAt: new Date('2026-08-27T10:00:00.000Z'), id: 'dlv_2' };

describe('cursors', () => {
  it('round-trips a row', () => {
    const decoded = decodeCursor(encodeCursor(row));

    expect(decoded.id).toBe('dlv_2');
    expect(decoded.createdAt.toISOString()).toBe('2026-08-27T10:00:00.000Z');
  });

  it('rejects a cursor that did not come from a previous page', () => {
    expect(() => decodeCursor('bm9uc2Vuc2U')).toThrowError(
      expect.objectContaining({ status: 400 }),
    );
  });
});

describe('olderThan', () => {
  it('breaks ties on the id, so a page boundary inside one millisecond is stable', () => {
    expect(olderThan(row)).toEqual({
      OR: [{ createdAt: { lt: row.createdAt } }, { createdAt: row.createdAt, id: { lt: 'dlv_2' } }],
    });
  });
});

describe('paginate', () => {
  const rows = [
    { createdAt: new Date('2026-08-27T10:00:02.000Z'), id: 'dlv_3' },
    { createdAt: new Date('2026-08-27T10:00:01.000Z'), id: 'dlv_2' },
    { createdAt: new Date('2026-08-27T10:00:00.000Z'), id: 'dlv_1' },
  ];

  it('returns a cursor only when the extra row proves there is more', () => {
    const full = paginate(rows, 2);

    expect(full.page).toHaveLength(2);
    expect(decodeCursor(full.nextCursor).id).toBe('dlv_2');

    const last = paginate(rows, 3);

    expect(last.page).toHaveLength(3);
    expect(last.nextCursor).toBeNull();
  });
});
