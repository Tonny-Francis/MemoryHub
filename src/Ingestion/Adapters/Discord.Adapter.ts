import { env } from '../../Config/Env.Config.js';
import { getLastSeen, setLastSeen } from '../State.js';
import type { IngestItem } from '../types.js';

const DECISION_KEYWORDS = ['decided', 'decision', 'adr', 'we will', 'going with', 'chosen', 'adopted', 'rejected', 'architecture'];
const MIN_LENGTH = 80;

interface DiscordMessage {
  id: string;
  content: string;
  author: { username: string; global_name?: string };
  timestamp: string;
  channel_id: string;
}

function discordFetch<T>(path: string): Promise<T> {
  return fetch(`https://discord.com/api/v10${path}`, {
    headers: {
      Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
  }).then(async (r) => {
    if (!r.ok) throw new Error(`Discord API ${r.status}: ${path}`);
    return r.json() as Promise<T>;
  });
}

async function pollChannel(channelId: string, projectSlug: string): Promise<IngestItem[]> {
  const since = await getLastSeen('discord', `channel:${channelId}`);
  const params = new URLSearchParams({ limit: '50' });
  if (since) params.set('after', since);

  const messages = await discordFetch<DiscordMessage[]>(`/channels/${channelId}/messages?${params}`);
  if (!messages.length) return [];

  const sorted = [...messages].sort((a, b) => a.id.localeCompare(b.id));
  await setLastSeen('discord', `channel:${channelId}`, sorted[sorted.length - 1].id);

  return sorted
    .filter((m) => {
      if (m.content.length < MIN_LENGTH) return false;
      const lower = m.content.toLowerCase();
      return DECISION_KEYWORDS.some((kw) => lower.includes(kw));
    })
    .map((m): IngestItem => ({
      id: `discord:${channelId}:${m.id}`,
      source: 'discord',
      projectSlug,
      title: m.content.split('\n')[0].slice(0, 100),
      body: m.content,
      author: m.author.global_name ?? m.author.username,
      createdAt: m.timestamp,
    }));
}

export async function pollDiscord(channelProjectMap: Record<string, string> = {}): Promise<IngestItem[]> {
  if (!env.DISCORD_BOT_TOKEN || !env.DISCORD_CHANNEL_IDS) return [];

  const channelIds = env.DISCORD_CHANNEL_IDS.split(',').map((s) => s.trim()).filter(Boolean);
  const results: IngestItem[] = [];

  for (const channelId of channelIds) {
    const projectSlug = channelProjectMap[channelId] ?? 'general';
    try {
      const items = await pollChannel(channelId, projectSlug);
      results.push(...items);
    } catch (err) {
      console.warn(`[Discord] Failed to poll channel ${channelId}:`, err);
    }
  }

  return results;
}
