import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(8000),

  DATABASE_URL: z.string().min(1),

  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  INITIAL_ADMIN_EMAIL: z.string().email().optional(),
  INITIAL_ADMIN_PASSWORD: z.string().min(8).optional(),
  INITIAL_ADMIN_NAME: z.string().default('Admin'),

  VAULT_DIR: z.string().default('/data/vault'),
  GIT_VAULT_REPO_URL: z.string().optional(),
  GIT_SYNC_INTERVAL_MS: z.coerce.number().default(5 * 60 * 1000),
  GIT_USER_NAME: z.string().default('MemoryHub'),
  GIT_USER_EMAIL: z.string().default('memoryhub@localhost'),

  GITLAB_URL: z.string().default('https://gitlab.com'),
  GITLAB_TOKEN: z.string().optional(),
  GITLAB_WEBHOOK_SECRET: z.string().optional(),

  DISCORD_BOT_TOKEN: z.string().optional(),
  DISCORD_CHANNEL_IDS: z.string().optional(),

  TRELLO_API_KEY: z.string().optional(),
  TRELLO_TOKEN: z.string().optional(),
  TRELLO_BOARD_IDS: z.string().optional(),

  ANTHROPIC_API_KEY: z.string().optional(),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
