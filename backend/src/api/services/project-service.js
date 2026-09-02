import { ConflictError, NotFoundError, UnprocessableError } from '../../shared/errors.js';
import { newId } from '../../shared/ids.js';
import { ROLES } from '../../shared/roles.js';
import { resolveSafeTarget } from '../../shared/ssrf.js';
import { slugify } from './auth-service.js';

function projectView(project) {
  return {
    id: project.id,
    name: project.name,
    slug: project.slug,
    alertWebhookUrl: project.alertWebhookUrl,
    createdAt: project.createdAt,
  };
}

export function createProjectService({ prisma, config, resolveTarget = resolveSafeTarget }) {
  // The alert URL is typed by an owner, so it is guarded exactly as an endpoint
  // URL is: a target the delivery pipeline would refuse is not a target the
  // alert channel may reach either.
  async function assertAlertTarget(url) {
    try {
      await resolveTarget(url, {
        allowPrivate: config.SSRF_ALLOW_PRIVATE,
        allowlistHosts: config.SSRF_ALLOWLIST_HOSTS,
        blockedPorts: config.SSRF_BLOCKED_PORTS,
      });
    } catch (error) {
      throw new UnprocessableError(`The URL is not an allowed alert target: ${error.message}`);
    }
  }

  return {
    async list({ memberships }) {
      const projects = await prisma.project.findMany({
        where: { id: { in: memberships.map((membership) => membership.projectId) } },
        orderBy: { createdAt: 'asc' },
      });

      const roleOf = new Map(
        memberships.map((membership) => [membership.projectId, membership.role]),
      );

      return {
        projects: projects.map((project) => ({
          ...projectView(project),
          role: roleOf.get(project.id),
        })),
      };
    },

    async create({ userId, name }) {
      const projectId = newId('project');

      const [project] = await prisma.$transaction([
        prisma.project.create({ data: { id: projectId, name, slug: slugify(name) } }),
        prisma.membership.create({ data: { userId, projectId, role: ROLES.OWNER } }),
      ]);

      return { ...projectView(project), role: ROLES.OWNER };
    },

    async update({ projectId, name, alertWebhookUrl }) {
      if (typeof alertWebhookUrl === 'string') {
        await assertAlertTarget(alertWebhookUrl);
      }

      const data = {
        ...(name === undefined ? {} : { name }),
        ...(alertWebhookUrl === undefined ? {} : { alertWebhookUrl }),
      };

      const project = await prisma.project.update({ where: { id: projectId }, data });

      return projectView(project);
    },

    async members({ projectId }) {
      const memberships = await prisma.membership.findMany({
        where: { projectId },
        include: { user: true },
        orderBy: { createdAt: 'asc' },
      });

      return {
        members: memberships.map((membership) => ({
          userId: membership.userId,
          email: membership.user.email,
          name: membership.user.name,
          role: membership.role,
          joinedAt: membership.createdAt,
        })),
      };
    },

    // v1 has no invitation flow, so a member must already have an account. The
    // response says so plainly instead of pretending the member was added.
    async addMember({ projectId, email, role }) {
      const user = await prisma.user.findUnique({ where: { email } });

      if (!user) {
        throw new UnprocessableError('No account with this email exists yet');
      }

      const existing = await prisma.membership.findUnique({
        where: { userId_projectId: { userId: user.id, projectId } },
      });

      if (existing) {
        throw new ConflictError('This user is already a member of the project');
      }

      const membership = await prisma.membership.create({
        data: { userId: user.id, projectId, role },
      });

      return { userId: user.id, email: user.email, name: user.name, role: membership.role };
    },

    async removeMember({ projectId, userId }) {
      const membership = await prisma.membership.findUnique({
        where: { userId_projectId: { userId, projectId } },
      });

      if (!membership) {
        throw new NotFoundError('No such member');
      }

      if (membership.role === ROLES.OWNER) {
        const owners = await prisma.membership.count({
          where: { projectId, role: ROLES.OWNER },
        });

        if (owners === 1) {
          throw new ConflictError(
            'The last owner cannot be removed; promote another member to owner first',
          );
        }
      }

      await prisma.membership.delete({ where: { userId_projectId: { userId, projectId } } });
    },
  };
}
