import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.ts';
import { config } from './config.js';

export function createPrismaClient({ connectionString = config.DATABASE_URL } = {}) {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

export const prisma = createPrismaClient();

export async function pingDatabase(client = prisma) {
  await client.$queryRaw`SELECT 1`;
}

export async function disconnectDatabase(client = prisma) {
  await client.$disconnect();
}
