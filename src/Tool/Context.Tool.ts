import fs from 'node:fs/promises';
import path from 'node:path';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { env } from '../Config/Env.Config.js';
import { logger } from '../Config/Logger.Config.js';
import { listDecisions, listProjectSlugs, vaultPath } from '../Service/Vault.Service.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function safeRead(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, 'utf-8');
  } catch {
    return null;
  }
}

function parseOverviewMeta(overview: string): Record<string, string> {
  const meta: Record<string, string> = {};
  for (const line of overview.split('\n')) {
    const match = line.match(/^\*\*(.+?):\*\*\s*(.+)/);
    if (match) meta[match[1].toLowerCase()] = match[2].trim();
  }
  return meta;
}

function firstLine(content: string): string {
  return content.split('\n').find((l) => l.trim())?.trim() ?? '';
}

async function buildProjectContext(slug: string): Promise<string> {
  const [overview, context, tasks] = await Promise.all([
    safeRead(path.join(env.VAULT_DIR, 'projects', slug, 'overview.md')),
    safeRead(path.join(env.VAULT_DIR, 'projects', slug, 'context.md')),
    safeRead(path.join(env.VAULT_DIR, 'projects', slug, 'tasks', 'backlog.md')),
  ]);

  const decisions = await listDecisions(slug, 'decisions');
  const drafts = await listDecisions(slug, 'drafts');

  const sections: string[] = [`# ${slug} — context\n_${new Date().toISOString().slice(0, 10)}_`];

  // Overview meta (stack, owner, status — compact)
  if (overview) {
    const meta = parseOverviewMeta(overview);
    const metaLines = ['stack', 'owner', 'repo', 'status']
      .filter((k) => meta[k])
      .map((k) => `**${k.charAt(0).toUpperCase() + k.slice(1)}:** ${meta[k]}`);
    if (metaLines.length) sections.push(metaLines.join('  \n'));
  }

  // Last 3 confirmed decisions — title only + date (no full content)
  if (decisions.length) {
    const lines = decisions.slice(0, 3).map((d) => `- \`${d.date}\` **${d.title}**`);
    if (drafts.length) lines.push(`- _${drafts.length} draft(s) pending confirmation_`);
    sections.push(`## Key Decisions\n${lines.join('\n')}`);
  }

  // context.md — if present and short, include it; otherwise summarize
  if (context) {
    const trimmed = context.trim();
    if (trimmed.length < 600) {
      sections.push(`## Context\n${trimmed}`);
    } else {
      // Only include first 500 chars with a pointer
      sections.push(`## Context\n${trimmed.slice(0, 500)}…\n_(full: projects/${slug}/context.md)_`);
    }
  }

  // Open tasks — titles only
  if (tasks) {
    const openTasks = tasks
      .split('\n')
      .filter((l) => l.match(/^\s*-\s*\[\s*\]/))
      .slice(0, 5)
      .map((l) => l.trim());
    if (openTasks.length) {
      sections.push(`## Open Tasks (${openTasks.length})\n${openTasks.join('\n')}`);
    }
  }

  return sections.join('\n\n');
}

// ── Tool ──────────────────────────────────────────────────────────────────────

export function registerContextTool(server: McpServer): void {
  server.tool(
    'get_context',
    [
      'Returns compact project context (~800 tokens max) for the current session.',
      'Pass the project slug (e.g. "api-payments"). If omitted, returns a list of all projects.',
      'Call this at the START of a session when working on a specific repository.',
      'Returns: stack, owner, last 3 decisions (titles only), open tasks, and key context.',
    ].join(' '),
    {
      project: z
        .string()
        .optional()
        .describe('Project slug (e.g. "api-payments"). Omit to list all projects.'),
      file: z
        .string()
        .optional()
        .describe('File path being edited (e.g. "src/auth/middleware.ts"). Filters decisions relevant to that module.'),
    },
    async ({ project, file }) => {
      if (!project) {
        const slugs = await listProjectSlugs();
        const globalTeams = await safeRead(vaultPath('_global', 'teams.md'));
        const lines = [
          `# MemoryHub — ${slugs.length} project(s)`,
          slugs.map((s) => `- ${s}`).join('\n'),
          globalTeams ? `\n## Teams\n${firstLine(globalTeams)}` : '',
        ].filter(Boolean);
        return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
      }

      let ctx = await buildProjectContext(project);

      if (file) {
        // Extract meaningful keywords from the file path to filter relevant decisions
        const keywords = file
          .replace(/\\/g, '/')
          .split('/')
          .flatMap((seg) => seg.replace(/\.[^.]+$/, '').split(/[-_.]/))
          .map((k) => k.toLowerCase())
          .filter((k) => k.length > 2 && !['src', 'lib', 'app', 'pkg', 'test', 'spec', 'index', 'main', 'mod', 'utils', 'helpers', 'types'].includes(k));

        if (keywords.length) {
          const decisions = await listDecisions(project, 'decisions');
          const relevant: string[] = [];

          for (const d of decisions) {
            try {
              const content = await fs.readFile(
                path.join(env.VAULT_DIR, 'projects', project, 'decisions', d.filename),
                'utf-8',
              );
              const lower = `${d.title} ${content}`.toLowerCase();
              if (keywords.some((kw) => lower.includes(kw))) {
                relevant.push(`- \`${d.date}\` **${d.title}**\n  ${content.split('\n').find((l) => l.startsWith('##') && l.toLowerCase().includes('decision'))?.replace(/^#+\s*/, '') ?? ''}`);
              }
            } catch { /* skip */ }
          }

          if (relevant.length) {
            ctx += `\n\n## Decisions relevant to \`${file}\`\n${relevant.slice(0, 5).join('\n')}`;
          } else {
            ctx += `\n\n_No decisions found matching \`${file}\` path keywords: ${keywords.join(', ')}_`;
          }
        }
      }

      logger.debug({ project, file }, 'get_context');
      return { content: [{ type: 'text' as const, text: ctx }] };
    }
  );
}
