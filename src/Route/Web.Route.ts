import { Router } from 'express';
import { z } from 'zod';

import { db } from '../Config/Db.Config.js';
import { requireRole } from '../Middleware/Auth.Middleware.js';
import { createUser } from '../Service/Auth.Service.js';
import { pull } from '../Service/Git.Service.js';
import { embeddingEnabled, semanticSearch } from '../Service/Embedding.Service.js';
import {
  deleteFile,
  ensureProjectDirs,
  listDecisions,
  listProjectSlugs,
  moveFile,
  readFile,
  readProjectOverview,
  searchVault,
  writeFile,
} from '../Service/Vault.Service.js';

export function webRouter(): Router {
  const router = Router();

  // ── Projects ──────────────────────────────────────────────────────────────

  router.get('/projects', async (_req, res) => {
    const slugs = await listProjectSlugs();
    const dbProjects = await db.project.findMany({ orderBy: { name: 'asc' } });

    const projects = await Promise.all(
      slugs.map(async (slug) => {
        const db = dbProjects.find((p) => p.slug === slug);
        const overview = await readProjectOverview(slug);
        return { slug, name: db?.name ?? slug, stack: db?.stack, owner: db?.owner, overview };
      })
    );

    res.json(projects);
  });

  router.post('/projects', requireRole('ADMIN'), async (req, res) => {
    const schema = z.object({
      slug: z.string().regex(/^[a-z0-9-]+$/),
      name: z.string().min(1),
      description: z.string().optional(),
      repoUrl: z.string().url().optional(),
      owner: z.string().optional(),
      stack: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const { slug, ...data } = parsed.data;
    await ensureProjectDirs(slug);

    const overview = [
      `# ${data.name}`,
      '',
      `**Stack:** ${data.stack ?? 'not specified'}`,
      `**Owner:** ${data.owner ?? 'not specified'}`,
      `**Repo:** ${data.repoUrl ?? 'not specified'}`,
      `**Status:** active`,
      '',
      data.description ?? 'No description yet.',
    ].join('\n');

    await writeFile(`projects/${slug}/overview.md`, overview, `project: create ${slug}`);

    const project = await db.project.upsert({
      where: { slug },
      create: { slug, ...data },
      update: data,
    });

    res.status(201).json(project);
  });

  router.get('/projects/:slug', async (req, res) => {
    const { slug } = req.params;
    const overview = await readProjectOverview(slug);
    if (!overview) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const [decisions, drafts, dbProject] = await Promise.all([
      listDecisions(slug, 'decisions'),
      listDecisions(slug, 'drafts'),
      db.project.findUnique({ where: { slug } }),
    ]);
    res.json({ slug, ...dbProject, overview, decisions, drafts });
  });

  // ── Decisions ─────────────────────────────────────────────────────────────

  router.get('/projects/:slug/decisions', async (req, res) => {
    const decisions = await listDecisions(req.params.slug, 'decisions');
    res.json(decisions);
  });

  router.get('/projects/:slug/decisions/:filename', async (req, res) => {
    try {
      const content = await readFile(`projects/${req.params.slug}/decisions/${req.params.filename}`);
      res.json({ content });
    } catch {
      res.status(404).json({ error: 'Not found' });
    }
  });

  router.put('/projects/:slug/decisions/:filename', requireRole('WRITER', 'ADMIN'), async (req, res) => {
    const schema = z.object({ content: z.string().min(1) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
    const { slug, filename } = req.params;
    await writeFile(`projects/${slug}/decisions/${filename}`, parsed.data.content, `decision: edit ${slug}/${filename}`);
    res.json({ ok: true });
  });

  router.post('/projects/:slug/decisions', requireRole('WRITER', 'ADMIN'), async (req, res) => {
    const schema = z.object({
      topic: z.string().min(1),
      content: z.string().min(1),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const { slug } = req.params;
    const date = parsed.data.date ?? new Date().toISOString().slice(0, 10);
    const slug2 = parsed.data.topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const filename = `${date}-${slug2}.md`;
    const relPath = `projects/${slug}/decisions/${filename}`;
    await writeFile(relPath, parsed.data.content, `decision: ${slug}/${filename}`);
    res.status(201).json({ path: relPath, filename });
  });

  // ── Drafts ────────────────────────────────────────────────────────────────

  router.get('/projects/:slug/drafts', async (req, res) => {
    const drafts = await listDecisions(req.params.slug, 'drafts');
    res.json(drafts);
  });

  router.post('/projects/:slug/drafts', requireRole('WRITER', 'ADMIN'), async (req, res) => {
    const schema = z.object({
      topic: z.string().min(1),
      content: z.string().min(1),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const { slug } = req.params;
    const date = parsed.data.date ?? new Date().toISOString().slice(0, 10);
    const draftSlug = parsed.data.topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
    const filename = `${date}-${draftSlug}-draft.md`;
    const relPath = `projects/${slug}/drafts/${filename}`;
    await writeFile(relPath, parsed.data.content, `draft: ${slug}/${filename}`);
    res.status(201).json({ path: relPath, filename });
  });

  router.get('/projects/:slug/drafts/:filename', async (req, res) => {
    try {
      const content = await readFile(`projects/${req.params.slug}/drafts/${req.params.filename}`);
      res.json({ content });
    } catch {
      res.status(404).json({ error: 'Not found' });
    }
  });

  router.put('/projects/:slug/drafts/:filename', requireRole('WRITER', 'ADMIN'), async (req, res) => {
    const schema = z.object({ content: z.string().min(1) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
    const { slug, filename } = req.params;
    await writeFile(`projects/${slug}/drafts/${filename}`, parsed.data.content, `draft: edit ${slug}/${filename}`);
    res.json({ ok: true });
  });

  router.post('/projects/:slug/drafts/:filename/confirm', requireRole('WRITER', 'ADMIN'), async (req, res) => {
    const { slug, filename } = req.params;
    const from = `projects/${slug}/drafts/${filename}`;
    const to = `projects/${slug}/decisions/${(filename as string).replace('-draft', '')}`;
    await moveFile(from, to, `decision: confirm draft ${slug}/${filename}`);
    res.json({ confirmed: to });
  });

  router.delete('/projects/:slug/drafts/:filename', requireRole('WRITER', 'ADMIN'), async (req, res) => {
    const { slug, filename } = req.params;
    await deleteFile(`projects/${slug}/drafts/${filename}`, `draft: reject ${slug}/${filename}`);
    res.json({ ok: true });
  });

  // ── Search ────────────────────────────────────────────────────────────────

  router.get('/search', async (req, res) => {
    const q = req.query.q as string | undefined;
    const project = req.query.project as string | undefined;
    const mode = req.query.mode as string | undefined;
    if (!q) {
      res.status(400).json({ error: 'Missing query param q' });
      return;
    }

    if (mode === 'semantic' && embeddingEnabled()) {
      const limit = Math.min(Number(req.query.limit ?? 10), 50);
      const matches = await semanticSearch(q, project, limit);
      res.json({ mode: 'semantic', results: matches });
      return;
    }

    const matches = await searchVault(q, project);
    res.json({ mode: 'fulltext', results: matches });
  });

  // ── Vault sync ────────────────────────────────────────────────────────────

  router.post('/vault/sync', requireRole('ADMIN'), async (_req, res) => {
    const result = await pull();
    res.json({ result });
  });

  // ── Users (admin only) ────────────────────────────────────────────────────

  router.get('/users', requireRole('ADMIN'), async (_req, res) => {
    const users = await db.user.findMany({
      select: { id: true, email: true, name: true, role: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    res.json(users);
  });

  router.post('/users', requireRole('ADMIN'), async (req, res) => {
    const schema = z.object({
      email: z.string().email(),
      password: z.string().min(8),
      name: z.string().min(1),
      role: z.enum(['READER', 'WRITER', 'ADMIN']).default('WRITER'),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      const user = await createUser(parsed.data.email, parsed.data.password, parsed.data.name, parsed.data.role);
      res.status(201).json(user);
    } catch {
      res.status(409).json({ error: 'Email already in use' });
    }
  });

  return router;
}
