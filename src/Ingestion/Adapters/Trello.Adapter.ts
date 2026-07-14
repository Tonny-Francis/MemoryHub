import { env } from '../../Config/Env.Config.js';
import { getLastSeen, setLastSeen } from '../State.js';
import type { IngestItem } from '../types.js';

const DECISION_LIST_NAMES = ['decision', 'decisions', 'adr', 'architecture'];
const DECISION_LABEL_NAMES = ['decision', 'adr', 'architecture'];

interface TrelloLabel {
  id: string;
  name: string;
  color: string;
}

interface TrelloCard {
  id: string;
  name: string;
  desc: string;
  shortUrl: string;
  idMembers: string[];
  labels: TrelloLabel[];
  dateLastActivity: string;
}

interface TrelloList {
  id: string;
  name: string;
}

function trelloFetch<T>(path: string, extra: Record<string, string> = {}): Promise<T> {
  const params = new URLSearchParams({
    key: env.TRELLO_API_KEY ?? '',
    token: env.TRELLO_TOKEN ?? '',
    ...extra,
  });
  return fetch(`https://api.trello.com/1${path}?${params}`, {
    headers: { Accept: 'application/json' },
  }).then(async (r) => {
    if (!r.ok) throw new Error(`Trello API ${r.status}: ${path}`);
    return r.json() as Promise<T>;
  });
}

function projectSlugFromBoardName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

async function pollBoard(boardId: string): Promise<IngestItem[]> {
  const since = await getLastSeen('trello', `board:${boardId}`);

  const [lists, cards] = await Promise.all([
    trelloFetch<TrelloList[]>(`/boards/${boardId}/lists`),
    trelloFetch<TrelloCard[]>(`/boards/${boardId}/cards`, { filter: 'open', fields: 'name,desc,shortUrl,labels,dateLastActivity,idList' }),
  ]);

  const boardInfo = await trelloFetch<{ name: string }>(`/boards/${boardId}`, { fields: 'name' });
  const projectSlug = projectSlugFromBoardName(boardInfo.name);

  const decisionListIds = new Set(
    lists.filter((l) => DECISION_LIST_NAMES.some((n) => l.name.toLowerCase().includes(n))).map((l) => l.id),
  );

  const filtered = cards.filter((card) => {
    if (since && card.dateLastActivity <= since) return false;
    const inDecisionList = decisionListIds.has((card as unknown as Record<string, string>)['idList']);
    const hasDecisionLabel = card.labels.some((l) => DECISION_LABEL_NAMES.some((n) => l.name.toLowerCase().includes(n)));
    return inDecisionList || hasDecisionLabel;
  });

  if (!filtered.length) return [];

  const latest = filtered.reduce((a, b) => (a.dateLastActivity > b.dateLastActivity ? a : b));
  await setLastSeen('trello', `board:${boardId}`, latest.dateLastActivity);

  return filtered.map((card): IngestItem => ({
    id: `trello:${boardId}:${card.id}`,
    source: 'trello',
    projectSlug,
    title: card.name,
    body: card.desc,
    url: card.shortUrl,
    createdAt: card.dateLastActivity,
  }));
}

export async function pollTrello(): Promise<IngestItem[]> {
  if (!env.TRELLO_API_KEY || !env.TRELLO_TOKEN || !env.TRELLO_BOARD_IDS) return [];

  const boardIds = env.TRELLO_BOARD_IDS.split(',').map((s) => s.trim()).filter(Boolean);
  const results: IngestItem[] = [];

  for (const boardId of boardIds) {
    try {
      const items = await pollBoard(boardId);
      results.push(...items);
    } catch (err) {
      console.warn(`[Trello] Failed to poll board ${boardId}:`, err);
    }
  }

  return results;
}

export function handleTrelloWebhook(payload: unknown): IngestItem | null {
  const p = payload as Record<string, unknown>;
  const action = p['action'] as Record<string, unknown> | undefined;
  if (!action) return null;

  const type = action['type'];
  if (type !== 'createCard' && type !== 'updateCard') return null;

  const data = action['data'] as Record<string, unknown>;
  const card = data['card'] as Record<string, unknown>;
  const board = data['board'] as Record<string, unknown>;
  const list = data['list'] as Record<string, string> | undefined;

  const isDecisionList = list && DECISION_LIST_NAMES.some((n) => list['name']?.toLowerCase().includes(n));
  if (!isDecisionList) return null;

  const projectSlug = projectSlugFromBoardName(String(board?.['name'] ?? 'unknown'));

  return {
    id: `trello:webhook:${card['id']}`,
    source: 'trello',
    projectSlug,
    title: String(card['name'] ?? ''),
    body: String(card['desc'] ?? ''),
    url: String(card['shortUrl'] ?? ''),
    createdAt: new Date().toISOString(),
  };
}

// ── Activity tracking (Option A: webhook real-time) ───────────────────────────

export interface ActivityEntry {
  projectSlug: string;
  line: string;
}

const ACTIVITY_EVENTS = new Set([
  'updateCard',        // moved between lists
  'commentCard',       // comment added
  'createCard',        // new card
  'updateChecklistItemStateOnCard', // checklist item completed
  'addMemberToCard',   // member assigned
]);

export function handleTrelloActivityWebhook(payload: unknown): ActivityEntry | null {
  const p = payload as Record<string, unknown>;
  const action = p['action'] as Record<string, unknown> | undefined;
  if (!action) return null;

  const type = String(action['type'] ?? '');
  if (!ACTIVITY_EVENTS.has(type)) return null;

  const data = action['data'] as Record<string, unknown>;
  const card = data['card'] as Record<string, unknown> | undefined;
  const board = data['board'] as Record<string, unknown> | undefined;
  const member = action['memberCreator'] as Record<string, string> | undefined;
  const by = String(member?.['fullName'] ?? member?.['username'] ?? 'unknown');
  const now = new Date().toISOString().slice(11, 16); // HH:MM UTC
  const cardName = String(card?.['name'] ?? '');
  const cardUrl = String(card?.['shortUrl'] ?? '');
  const cardLink = cardUrl ? `[${cardName}](${cardUrl})` : cardName;
  const projectSlug = projectSlugFromBoardName(String(board?.['name'] ?? 'unknown'));

  let line = '';

  if (type === 'updateCard') {
    const listBefore = data['listBefore'] as Record<string, string> | undefined;
    const listAfter = data['listAfter'] as Record<string, string> | undefined;
    if (!listBefore || !listAfter) return null; // not a list move — skip other updateCard events
    line = `## ${now} — Card movido: ${cardLink}\n**${listBefore['name']}** → **${listAfter['name']}** | por ${by}`;
  } else if (type === 'commentCard') {
    const text = String((data['text'] as string | undefined) ?? '').slice(0, 300);
    line = `## ${now} — Comentário em ${cardLink}\n**por ${by}**\n> ${text.replace(/\n/g, '\n> ')}`;
  } else if (type === 'createCard') {
    const list = data['list'] as Record<string, string> | undefined;
    line = `## ${now} — Card criado: ${cardLink}\n**Lista:** ${list?.['name'] ?? '?'} | por ${by}`;
  } else if (type === 'updateChecklistItemStateOnCard') {
    const checkItem = data['checkItem'] as Record<string, unknown> | undefined;
    if (checkItem?.['state'] !== 'complete') return null;
    const itemName = String(checkItem?.['name'] ?? '');
    line = `## ${now} — Checklist concluído em ${cardLink}\n**Item:** ${itemName} | por ${by}`;
  } else if (type === 'addMemberToCard') {
    const assigned = (action['member'] as Record<string, string> | undefined);
    const assignedName = String(assigned?.['fullName'] ?? assigned?.['username'] ?? '?');
    line = `## ${now} — Membro atribuído: ${cardLink}\n**${assignedName}** | por ${by}`;
  }

  if (!line) return null;
  return { projectSlug, line };
}
