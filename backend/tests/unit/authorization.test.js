import { describe, expect, it } from 'vitest';
import { ROLES, assertMembership, membershipFor } from '../../src/api/authorization.js';
import { slugify } from '../../src/api/services/auth-service.js';

const auth = {
  userId: 'usr_1',
  memberships: [
    { projectId: 'prj_owned', role: 'OWNER' },
    { projectId: 'prj_joined', role: 'MEMBER' },
  ],
};

describe('membershipFor', () => {
  it('finds the membership of a project the caller belongs to', () => {
    expect(membershipFor(auth, 'prj_joined').role).toBe('MEMBER');
    expect(membershipFor(auth, 'prj_other')).toBeUndefined();
  });
});

describe('assertMembership', () => {
  it('accepts a member for a member-level action', () => {
    expect(assertMembership(auth, 'prj_joined').role).toBe('MEMBER');
  });

  it('answers a project the caller does not belong to exactly like a missing one', () => {
    expect(() => assertMembership(auth, 'prj_other')).toThrowError(
      expect.objectContaining({ status: 404 }),
    );
  });

  it('refuses a member for an owner-level action, without hiding the project', () => {
    expect(() => assertMembership(auth, 'prj_joined', ROLES.OWNER)).toThrowError(
      expect.objectContaining({ status: 403 }),
    );
  });

  it('accepts an owner for an owner-level action', () => {
    expect(assertMembership(auth, 'prj_owned', ROLES.OWNER).role).toBe('OWNER');
  });
});

describe('slugify', () => {
  it('builds a url-safe slug with a random suffix, so two projects can share a name', () => {
    const first = slugify('Acme Payments');
    const second = slugify('Acme Payments');

    expect(first).toMatch(/^acme-payments-[0-9a-f]{6}$/);
    expect(first).not.toBe(second);
  });

  it('falls back to a usable slug when the name has no usable characters', () => {
    expect(slugify('***')).toMatch(/^project-[0-9a-f]{6}$/);
  });
});
