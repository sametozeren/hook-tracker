import { config as loadDotenv } from 'dotenv';
import { defineConfig } from 'prisma/config';

loadDotenv({ path: ['.env', '../.env'], quiet: true });

// `prisma generate` runs during the image build, where DATABASE_URL does not
// exist yet. Declaring the datasource unconditionally makes the config throw at
// load time, so it is attached only when a URL is actually available; the
// commands that need a connection (migrate, seed) always run with one set.
const databaseUrl = process.env.DATABASE_URL;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'node prisma/seed.js',
  },
  ...(databaseUrl ? { datasource: { url: databaseUrl } } : {}),
});
