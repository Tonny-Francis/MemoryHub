import crypto from 'node:crypto';

import { Router } from 'express';

import { env } from '../Config/Env.Config.js';
import { logger } from '../Config/Logger.Config.js';
import { commentMrWithContext, handleGitLabWebhook } from '../Ingestion/Adapters/GitLab.Adapter.js';
import { handleTrelloActivityWebhook, handleTrelloWebhook } from '../Ingestion/Adapters/Trello.Adapter.js';
import { processWebhookItem, runWorker } from '../Ingestion/Worker.js';
import { authMiddleware, requireRole } from '../Middleware/Auth.Middleware.js';
import { appendFile, listDecisions } from '../Service/Vault.Service.js';
import { z } from 'zod';

function verifyGitLabSignature(body: string, token: string | undefined): boolean {
  if (!env.GITLAB_WEBHOOK_SECRET) return true;
  return token === env.GITLAB_WEBHOOK_SECRET;
}

function verifyTrelloSignature(body: string, signature: string | undefined, callbackUrl: string): boolean {
  if (!env.TRELLO_TOKEN) return true;
  const hash = crypto.createHmac('sha1', env.TRELLO_TOKEN).update(body + callbackUrl).digest('base64');
  return hash === signature;
}

export function ingestRouter(): Router {
  const router = Router();

  router.post('/gitlab', async (req, res) => {
    const token = req.headers['x-gitlab-token'] as string | undefined;
    const rawBody = JSON.stringify(req.body);

    if (!verifyGitLabSignature(rawBody, token)) {
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    const item = handleGitLabWebhook(req.body);
    if (!item) {
      res.json({ ok: true, action: 'ignored' });
      return;
    }

    // Auto-comment on MR with relevant vault decisions (fire-and-forget)
    const payload = req.body as Record<string, unknown>;
    if (payload['object_kind'] === 'merge_request') {
      const attrs = payload['object_attributes'] as Record<string, unknown>;
      const projectId = String((payload['project'] as Record<string, string>)?.['path_with_namespace'] ?? '');
      const mrIid = Number(attrs['iid']);
      if (projectId && mrIid) {
        const decisions = await listDecisions(item.projectSlug, 'decisions');
        const mrText = `${attrs['title']} ${attrs['description'] ?? ''}`.toLowerCase();
        const relevant = decisions.filter((d) =>
          d.title.split(' ').some((word) => word.length > 3 && mrText.includes(word.toLowerCase()))
        ).slice(0, 5).map((d) => ({
          date: d.date,
          title: d.title,
          path: d.path,
        }));
        commentMrWithContext(projectId, mrIid, relevant).catch(() => {});
      }
    }

    const result = await processWebhookItem(item);
    logger.info({ result, source: 'gitlab' }, 'webhook processed');
    res.json({ ok: true, ...result });
  });

  router.post('/trello', async (req, res) => {
    const signature = req.headers['x-trello-webhook'] as string | undefined;
    const callbackUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    const rawBody = JSON.stringify(req.body);

    if (!verifyTrelloSignature(rawBody, signature, callbackUrl)) {
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    // 1. Try to extract a decision draft first
    const item = handleTrelloWebhook(req.body);
    if (item) {
      const result = await processWebhookItem(item);
      logger.info({ result, source: 'trello' }, 'decision webhook processed');
      res.json({ ok: true, type: 'decision', ...result });
      return;
    }

    // 2. Try to log as activity entry
    const activity = handleTrelloActivityWebhook(req.body);
    if (activity) {
      const date = new Date().toISOString().slice(0, 10);
      const relPath = `projects/${activity.projectSlug}/activity/${date}.md`;
      const header = `# Activity Log — ${date}\n\n`;
      const entry = `${activity.line}\n\n`;

      try {
        // Ensure file starts with header if it doesn't exist yet
        const { readFile: readVault } = await import('../Service/Vault.Service.js');
        let existing = '';
        try { existing = await readVault(relPath); } catch { /* new file */ }
        if (!existing) await appendFile(relPath, header, `activity: init ${date} for ${activity.projectSlug}`);
        await appendFile(relPath, entry, `activity: ${activity.projectSlug} ${date}`);
        logger.info({ project: activity.projectSlug, date }, 'activity entry logged');
        res.json({ ok: true, type: 'activity', project: activity.projectSlug });
      } catch (err) {
        logger.error({ err }, 'failed to write activity entry');
        res.status(500).json({ error: 'Failed to write activity' });
      }
      return;
    }

    res.json({ ok: true, action: 'ignored' });
  });

  // HEAD is required by Trello to validate the webhook URL
  router.head('/trello', (_req, res) => res.sendStatus(200));

  // Commit summary from Husky hook
  router.post('/commit', authMiddleware, async (req, res) => {
    const schema = z.object({
      project:     z.string().min(1),
      line:        z.string().min(1),
      message:     z.string().min(1),
      commitHash:  z.string().optional(),
      isDecision:  z.boolean().default(false),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: 'Invalid body' }); return; }

    const { project, line, message, commitHash, isDecision } = parsed.data;
    const date = new Date().toISOString().slice(0, 10);
    const relPath = `projects/${project}/activity/${date}.md`;
    const header = `# Activity Log — ${date}\n\n`;

    try {
      const { readFile: readVault, appendFile: appendVault } = await import('../Service/Vault.Service.js');
      let existing = '';
      try { existing = await readVault(relPath); } catch { /* new file */ }
      if (!existing) await appendVault(relPath, header, `activity: init ${date} for ${project}`);
      await appendVault(relPath, `${line}\n\n`, `activity: commit ${commitHash?.slice(0, 8) ?? ''} ${project}`);

      // If AI flagged a decision, save as draft too
      if (isDecision) {
        const { writeFile } = await import('../Service/Vault.Service.js');
        const draftSlug = message.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
        const filename = `${date}-${draftSlug}-draft.md`;
        const content = `# Draft: ${message}\n\n**Source:** git commit \`${commitHash}\`\n**Date:** ${date}\n\n---\n\n${line}`;
        await writeFile(`projects/${project}/drafts/${filename}`, content, `draft: commit ${commitHash?.slice(0, 8)}`);
      }

      res.json({ ok: true, date, isDecision });
    } catch (err) {
      logger.error({ err }, 'commit activity write failed');
      res.status(500).json({ error: 'write failed' });
    }
  });

  router.post('/run', authMiddleware, requireRole('ADMIN'), async (_req, res) => {
    const result = await runWorker();
    res.json(result);
  });

  return router;
}
