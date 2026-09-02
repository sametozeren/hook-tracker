import { describe, expect, it } from 'vitest';
import { containmentCandidates } from '../../src/api/services/event-service.js';

describe('containmentCandidates', () => {
  it('nests a dotted path into the document the value would sit in', () => {
    expect(containmentCandidates('customer.id', 'abc')).toEqual([{ customer: { id: 'abc' } }]);
  });

  it('offers the number as well as the string, because JSON keeps them apart', () => {
    expect(containmentCandidates('orderId', '1234')).toEqual([
      { orderId: '1234' },
      { orderId: 1234 },
    ]);
  });

  it('offers the boolean for a value written as one', () => {
    expect(containmentCandidates('paid', 'true')).toEqual([{ paid: 'true' }, { paid: true }]);
  });

  it('leaves a value that is only ever a string alone', () => {
    expect(containmentCandidates('status', 'shipped')).toEqual([{ status: 'shipped' }]);
  });

  it('returns nothing for a path with no segments', () => {
    expect(containmentCandidates('.', 'anything')).toEqual([]);
  });
});
