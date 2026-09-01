import { ForbiddenError, NotFoundError } from '../shared/errors.js';
import { ROLES } from '../shared/roles.js';

export function membershipFor(auth, projectId) {
  return auth.memberships.find((membership) => membership.projectId === projectId);
}

// A project the caller does not belong to answers exactly like a project that
// does not exist. A caller who is a member but lacks the role gets 403, because
// they already know the project is there.
export function assertMembership(auth, projectId, role = ROLES.MEMBER) {
  const membership = membershipFor(auth, projectId);

  if (!membership) {
    throw new NotFoundError('No such project');
  }

  if (role === ROLES.OWNER && membership.role !== ROLES.OWNER) {
    throw new ForbiddenError('This action is reserved for the project owner');
  }

  return membership;
}

export function requireProjectRole(role = ROLES.MEMBER) {
  return function authorize(req, res, next) {
    assertMembership(req.auth, req.params.projectId, role);

    next();
  };
}
