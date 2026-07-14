/**
 * MemoryHub Voice Recorder — run locally when needed, Ctrl+C to stop & process.
 *
 * Usage:
 *   node dist/voice-recorder.js \
 *     --guild   <GUILD_ID> \
 *     --channel <VOICE_CHANNEL_ID> \
 *     --project <PROJECT_SLUG> \
 *     --title   "Sprint planning decisions" \
 *     --api     https://memoryhub.example.com \
 *     --token   <JWT_TOKEN>
 *
 * Env vars (alternative to flags):
 *   DISCORD_BOT_TOKEN, MEMORYHUB_API_URL, MEMORYHUB_API_TOKEN
 */

import 'dotenv/config';
import { env } from './Config/Env.Config.js';
import { logger } from './Config/Logger.Config.js';
import { runRecorder } from './VoiceRecorder/Recorder.js';

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

function require_arg(name: string, envVar?: string): string {
  const val = arg(name) ?? (envVar ? process.env[envVar] : undefined);
  if (!val) {
    console.error(`Missing required argument: --${name}${envVar ? ` (or env ${envVar})` : ''}`);
    process.exit(1);
  }
  return val;
}

const guildId    = require_arg('guild',   'DISCORD_GUILD_ID');
const channelId  = require_arg('channel', 'DISCORD_VOICE_CHANNEL_ID');
const projectSlug = require_arg('project', 'MEMORYHUB_PROJECT');
const sessionTitle = arg('title') ?? `Voice session ${new Date().toISOString().slice(0, 16)}`;
const apiUrl     = require_arg('api',     'MEMORYHUB_API_URL');
const apiToken   = require_arg('token',   'MEMORYHUB_API_TOKEN');
const botToken   = require_arg('bot-token', 'DISCORD_BOT_TOKEN');

if (!env.OPENAI_API_KEY) {
  logger.warn('OPENAI_API_KEY not set — transcription will fail. Add it to .env');
  process.exit(1);
}

logger.info({
  project: projectSlug,
  session: sessionTitle,
  api: apiUrl,
}, 'Starting voice recorder');

runRecorder({ botToken, guildId, channelId, projectSlug, sessionTitle, apiUrl, apiToken })
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, 'Voice recorder crashed');
    process.exit(1);
  });
