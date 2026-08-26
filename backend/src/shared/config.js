import { config as loadDotenv } from 'dotenv';
import { formatEnvIssues, parseEnv } from './env-schema.js';

loadDotenv({ path: ['.env', '../.env'], quiet: true });

const parsed = parseEnv(process.env);

if (!parsed.success) {
  process.stderr.write(
    `Invalid environment configuration:\n${formatEnvIssues(parsed.error)}\n\nSee .env.example and docs/architecture.md §16.\n`,
  );
  process.exit(1);
}

export const config = Object.freeze(parsed.data);
export const isProduction = config.NODE_ENV === 'production';
