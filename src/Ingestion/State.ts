import fs from 'node:fs/promises';
import path from 'node:path';

import { env } from '../Config/Env.Config.js';
import type { IngestionSource } from './types.js';

const STATE_PATH = path.resolve(env.VAULT_DIR, '_ingestion', 'state.json');

type StateMap = Record<string, string>;

async function load(): Promise<StateMap> {
  try {
    const raw = await fs.readFile(STATE_PATH, 'utf-8');
    return JSON.parse(raw) as StateMap;
  } catch {
    return {};
  }
}

async function save(state: StateMap): Promise<void> {
  await fs.mkdir(path.dirname(STATE_PATH), { recursive: true });
  await fs.writeFile(STATE_PATH, JSON.stringify(state, null, 2), 'utf-8');
}

function key(source: IngestionSource, scope: string): string {
  return `${source}:${scope}`;
}

export async function getLastSeen(source: IngestionSource, scope: string): Promise<string | null> {
  const state = await load();
  return state[key(source, scope)] ?? null;
}

export async function setLastSeen(source: IngestionSource, scope: string, id: string): Promise<void> {
  const state = await load();
  state[key(source, scope)] = id;
  await save(state);
}

export async function hasProcessed(source: IngestionSource, id: string): Promise<boolean> {
  const state = await load();
  return !!state[key(source, `processed:${id}`)];
}

export async function markProcessed(source: IngestionSource, id: string): Promise<void> {
  const state = await load();
  state[key(source, `processed:${id}`)] = new Date().toISOString();
  await save(state);
}
