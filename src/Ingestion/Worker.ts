import { logger } from '../Config/Logger.Config.js';
import { writeFile } from '../Service/Vault.Service.js';
import { pollGitLab } from './Adapters/GitLab.Adapter.js';
import { pollDiscord } from './Adapters/Discord.Adapter.js';
import { pollTrello } from './Adapters/Trello.Adapter.js';
import { extractAdr } from './Extractor.js';
import { hasProcessed, markProcessed } from './State.js';
import type { IngestItem } from './types.js';

export interface WorkerResult {
  checked: number;
  draftsCreated: number;
  skipped: number;
  errors: number;
}

async function processItem(item: IngestItem): Promise<'created' | 'skipped' | 'error'> {
  try {
    if (await hasProcessed(item.source, item.id)) return 'skipped';

    const content = await extractAdr(item);
    if (!content) {
      await markProcessed(item.source, item.id);
      return 'skipped';
    }

    const date = item.createdAt.slice(0, 10);
    const slug = item.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
    const filename = `${date}-${slug}-draft.md`;
    const relPath = `projects/${item.projectSlug}/drafts/${filename}`;

    await writeFile(relPath, content, `ingest(${item.source}): ${item.title.slice(0, 60)}`);
    await markProcessed(item.source, item.id);

    logger.info({ source: item.source, project: item.projectSlug, filename }, 'draft created');
    return 'created';
  } catch (err) {
    logger.error({ err, itemId: item.id }, 'failed to process ingest item');
    return 'error';
  }
}

export async function runWorker(): Promise<WorkerResult> {
  logger.info('ingestion worker starting');

  const [gitlabItems, discordItems, trelloItems] = await Promise.allSettled([
    pollGitLab(),
    pollDiscord(),
    pollTrello(),
  ]);

  const items: IngestItem[] = [
    ...(gitlabItems.status === 'fulfilled' ? gitlabItems.value : (logger.warn({ err: gitlabItems.reason }, 'gitlab poll failed'), [])),
    ...(discordItems.status === 'fulfilled' ? discordItems.value : (logger.warn({ err: discordItems.reason }, 'discord poll failed'), [])),
    ...(trelloItems.status === 'fulfilled' ? trelloItems.value : (logger.warn({ err: trelloItems.reason }, 'trello poll failed'), [])),
  ];

  const result: WorkerResult = { checked: items.length, draftsCreated: 0, skipped: 0, errors: 0 };

  for (const item of items) {
    const outcome = await processItem(item);
    if (outcome === 'created') result.draftsCreated++;
    else if (outcome === 'skipped') result.skipped++;
    else result.errors++;
  }

  logger.info(result, 'ingestion worker done');
  return result;
}

export async function processWebhookItem(item: IngestItem): Promise<WorkerResult> {
  const result: WorkerResult = { checked: 1, draftsCreated: 0, skipped: 0, errors: 0 };
  const outcome = await processItem(item);
  if (outcome === 'created') result.draftsCreated++;
  else if (outcome === 'skipped') result.skipped++;
  else result.errors++;
  return result;
}
