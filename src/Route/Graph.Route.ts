import * as fs from 'node:fs';
import * as path from 'node:path';

import { Router } from 'express';

import { env } from '../Config/Env.Config.js';
import { authMiddleware } from '../Middleware/Auth.Middleware.js';

export interface GraphNode {
  id: string;
  label: string;
  project: string;
  date: string;
  path: string;
  type: 'decision' | 'draft';
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  weight: number;
  keywords: string[];
}

const STOPWORDS = new Set([
  'that','with','this','from','have','will','been','were','they','their',
  'when','where','what','which','para','como','mais','uma','que','por',
  'não','com','são','mas','the','and','for','use','our','was','all',
  'using','used','also','about','would','could','should','than','into',
  'over','other','only','same','some','such','both','each','more','then',
  'there','these','those','after','before','first','decision','draft',
  'context','rationale','alternatives','consequences','adopted','rejected',
  'decisão','alternativas','contexto','consequências',
]);

function extractKeywords(text: string): string[] {
  return [...new Set(
    text
      .toLowerCase()
      .replace(/[#*`\[\]()\-_|>]/g, ' ')
      .replace(/https?:\/\/\S+/g, '')
      .replace(/\d{4}-\d{2}-\d{2}/g, '')
      .split(/\s+/)
      .filter(w => w.length > 4 && !STOPWORDS.has(w)),
  )].slice(0, 50);
}

function readDir(p: string): string[] {
  try { return fs.readdirSync(p); } catch { return []; }
}

function readFile(p: string): string {
  try { return fs.readFileSync(p, 'utf-8'); } catch { return ''; }
}

function titleFromContent(content: string, filename: string): string {
  return (
    content.split('\n').find(l => l.startsWith('# '))
      ?.replace(/^# (Draft: )?/, '') ??
    filename.slice(11).replace(/-/g, ' ').replace(/\.md$/, '')
  );
}

export function graphRouter(): Router {
  const router = Router();

  router.get('/', authMiddleware, (req, res) => {
    const projectFilter = req.query.project as string | undefined;
    const projectsDir = path.join(env.VAULT_DIR, 'projects');
    const allProjects = readDir(projectsDir);
    const projects = projectFilter ? allProjects.filter(p => p === projectFilter) : allProjects;

    const nodes: GraphNode[] = [];
    const keywordMap = new Map<string, string[]>();

    for (const slug of projects) {
      const base = path.join(projectsDir, slug);

      for (const [type, subdir] of [['decision', 'decisions'], ['draft', 'drafts']] as const) {
        for (const file of readDir(path.join(base, subdir)).filter(f => f.endsWith('.md'))) {
          const filePath = path.join(base, subdir, file);
          const content = readFile(filePath);
          const id = `${slug}/${subdir}/${file}`;
          keywordMap.set(id, extractKeywords(content));
          nodes.push({
            id,
            label: titleFromContent(content, file),
            project: slug,
            date: file.slice(0, 10),
            path: id,
            type,
          });
        }
      }
    }

    // Build edges: at least 2 shared significant keywords
    const edges: GraphEdge[] = [];
    const ids = nodes.map(n => n.id);
    for (let i = 0; i < ids.length; i++) {
      const kwA = new Set(keywordMap.get(ids[i]) ?? []);
      for (let j = i + 1; j < ids.length; j++) {
        const shared = (keywordMap.get(ids[j]) ?? []).filter(k => kwA.has(k));
        if (shared.length >= 2) {
          edges.push({
            id: `e${i}-${j}`,
            source: ids[i],
            target: ids[j],
            weight: shared.length,
            keywords: shared.slice(0, 6),
          });
        }
      }
    }

    res.json({ nodes, edges });
  });

  return router;
}
