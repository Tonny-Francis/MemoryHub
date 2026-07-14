import fs from 'node:fs/promises';
import path from 'node:path';

import { env } from '../Config/Env.Config.js';
import { commitAndPush } from './Git.Service.js';

// ── Path helpers ──────────────────────────────────────────────────────────────

export function vaultPath(...parts: string[]): string {
  const base = path.resolve(env.VAULT_DIR);
  const resolved = path.resolve(base, ...parts);
  if (!resolved.startsWith(base + path.sep) && resolved !== base) {
    throw new Error(`Path traversal not allowed: ${parts.join('/')}`);
  }
  return resolved;
}

export function projectPath(slug: string, ...parts: string[]): string {
  return vaultPath('projects', slug, ...parts);
}

// ── Project operations ────────────────────────────────────────────────────────

export interface ProjectMeta {
  slug: string;
  name: string;
  stack?: string;
  owner?: string;
  status?: string;
}

export async function listProjectSlugs(): Promise<string[]> {
  try {
    const dir = vaultPath('projects');
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
  } catch {
    return [];
  }
}

export async function readProjectOverview(slug: string): Promise<string | null> {
  try {
    return await fs.readFile(projectPath(slug, 'overview.md'), 'utf-8');
  } catch {
    return null;
  }
}

export async function ensureProjectDirs(slug: string): Promise<void> {
  for (const sub of ['decisions', 'drafts', 'architecture', 'tasks']) {
    await fs.mkdir(projectPath(slug, sub), { recursive: true });
  }
}

// ── Decision operations ───────────────────────────────────────────────────────

export interface DecisionFile {
  filename: string;
  date: string;
  title: string;
  path: string;
}

export async function listDecisions(slug: string, dir: 'decisions' | 'drafts' = 'decisions'): Promise<DecisionFile[]> {
  try {
    const fullDir = projectPath(slug, dir);
    const files = await fs.readdir(fullDir);
    return files
      .filter((f) => f.endsWith('.md'))
      .sort()
      .reverse()
      .map((f) => ({
        filename: f,
        date: f.slice(0, 10),
        title: f.slice(11).replace(/\.md$/, '').replace(/-/g, ' '),
        path: path.join('projects', slug, dir, f),
      }));
  } catch {
    return [];
  }
}

export async function readFile(relPath: string): Promise<string> {
  return fs.readFile(vaultPath(relPath), 'utf-8');
}

export async function writeFile(relPath: string, content: string, commitMsg?: string): Promise<boolean> {
  const full = vaultPath(relPath);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, 'utf-8');
  return commitAndPush(commitMsg ?? `chore: update ${relPath}`);
}

export async function deleteFile(relPath: string, commitMsg?: string): Promise<void> {
  await fs.unlink(vaultPath(relPath));
  await commitAndPush(commitMsg ?? `chore: delete ${relPath}`);
}

export async function moveFile(from: string, to: string, commitMsg?: string): Promise<void> {
  const src = vaultPath(from);
  const dst = vaultPath(to);
  await fs.mkdir(path.dirname(dst), { recursive: true });
  await fs.rename(src, dst);
  await commitAndPush(commitMsg ?? `chore: move ${from} → ${to}`);
}

// ── Full-text search ──────────────────────────────────────────────────────────

export interface SearchMatch {
  file: string;
  lines: string[];
}

export async function searchVault(query: string, projectSlug?: string): Promise<SearchMatch[]> {
  const results: SearchMatch[] = [];
  const lower = query.toLowerCase();
  const root = projectSlug ? vaultPath('projects', projectSlug) : env.VAULT_DIR;

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        await walk(full);
      } else if (/\.(md|txt|ts|go|js|json|yaml|yml)$/.test(entry.name)) {
        let content: string;
        try {
          content = await fs.readFile(full, 'utf-8');
        } catch {
          continue;
        }

        if (!content.toLowerCase().includes(lower)) continue;

        const matched = content
          .split('\n')
          .map((line, i) => ({ line, i }))
          .filter(({ line }) => line.toLowerCase().includes(lower))
          .slice(0, 5)
          .map(({ line, i }) => `L${i + 1}: ${line.trim()}`);

        results.push({ file: path.relative(env.VAULT_DIR, full), lines: matched });
      }
    }
  }

  await walk(root);
  return results;
}
