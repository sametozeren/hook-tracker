import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../generated/prisma/client.ts';
import { config } from './config.js';

// The generated client is imported here and nowhere else, so the raw-query
// builder travels with it rather than giving a second module its own import.
export { Prisma };

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
