import { describe, expect, it } from 'vitest';
import { assertId, isId, newId } from '../../src/shared/ids.js';

describe('ids', () => {
  it('prefixes an id by entity kind', () => {
    expect(newId('delivery')).toMatch(/^dlv_[0-9a-z]{24}$/);
    expect(newId('endpoint')).toMatch(/^ep_[0-9a-z]{24}$/);
  });

  it('generates distinct values', () => {
    const ids = new Set(Array.from({ length: 100 }, () => newId('event')));

    expect(ids.size).toBe(100);
  });

  it('rejects an unknown kind', () => {
    expect(() => newId('webhook')).toThrow(/Unknown id kind/);
  });

  it('recognises only the matching prefix', () => {
    const id = newId('delivery');

    expect(isId('delivery', id)).toBe(true);
    expect(isId('event', id)).toBe(false);
    expect(isId('delivery', 'dlv_short')).toBe(false);
    expect(isId('delivery', undefined)).toBe(false);
  });

  it('fails loudly on a wrong-entity id', () => {
    expect(() => assertId('event', newId('delivery'))).toThrow(/Expected a evt_ id/);
  });
});
