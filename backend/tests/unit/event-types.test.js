import { describe, expect, it } from 'vitest';
import { isValidEventType, subscriptionMatches } from '../../src/shared/event-types.js';

describe('isValidEventType', () => {
  it('accepts lowercase, dot, dash and underscore separated names', () => {
    for (const value of ['order.created', 'invoice.paid', 'user_signup', 'a-b.c1']) {
      expect(isValidEventType(value)).toBe(true);
    }
  });

  it('rejects uppercase, separators at the edges and doubled separators', () => {
    for (const value of ['Order.Created', '.order', 'order.', 'order..created', 'order created']) {
      expect(isValidEventType(value)).toBe(false);
    }
  });

  it('rejects anything longer than 64 characters', () => {
    expect(isValidEventType('a'.repeat(64))).toBe(true);
    expect(isValidEventType('a'.repeat(65))).toBe(false);
  });
});

describe('subscriptionMatches', () => {
  it('treats an empty list as every event type of the project', () => {
    expect(subscriptionMatches([], 'order.created')).toBe(true);
    expect(subscriptionMatches(undefined, 'anything')).toBe(true);
  });

  it('matches an exact entry only', () => {
    expect(subscriptionMatches(['order.created'], 'order.created')).toBe(true);
    expect(subscriptionMatches(['order.created'], 'order.paid')).toBe(false);
  });

  it('matches one trailing segment for a wildcard entry', () => {
    expect(subscriptionMatches(['order.*'], 'order.created')).toBe(true);
    expect(subscriptionMatches(['order.*'], 'order.paid')).toBe(true);
    expect(subscriptionMatches(['order.*'], 'order.line.added')).toBe(false);
    expect(subscriptionMatches(['order.*'], 'invoice.paid')).toBe(false);
    expect(subscriptionMatches(['order.*'], 'order')).toBe(false);
  });

  it('refuses a bare star, because an empty list already says that', () => {
    expect(subscriptionMatches(['*'], 'order.created')).toBe(false);
  });

  it('matches when any entry of the list matches', () => {
    expect(subscriptionMatches(['invoice.paid', 'order.*'], 'order.created')).toBe(true);
  });
});
