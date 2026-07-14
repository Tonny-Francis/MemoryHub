import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { logger } from '../Config/Logger.Config.js';
import { listDecisions, moveFile, readFile, writeFile } from '../Service/Vault.Service.js';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function buildADR(params: {
  title: string;
  context: string;
  decision: string;
  alternatives: string;
  consequences: string;
  date: string;
  project: string;
}): string {
  return [
    `# ${params.title}`,
    '',
    `**Date:** ${params.date}`,
    `**Status:** accepted`,
    `**Project:** ${params.project}`,
    '',
    '## Context',
    params.context,
    '',
    '## Decision',
    params.decision,
    '',
    '## Alternatives Considered',
    params.alternatives,
    '',
    '## Consequences',
    params.consequences,
  ].join('\n');
}

export function registerDecisionTool(server: McpServer): void {
  // ── log_decision ──────────────────────────────────────────────────────────
  server.tool(
    'log_decision',
    [
      'Saves a structured ADR (Architecture Decision Record) to the vault.',
      'Use whenever a technical, architectural, or product decision is made during a session.',
      'The decision is saved to projects/{project}/decisions/YYYY-MM-DD-{topic}.md.',
    ].join(' '),
    {
      project: z.string().min(1).describe('Project slug (e.g. "api-payments")'),
      topic: z.string().min(1).describe('Short topic slug (e.g. "grpc-over-rest", "escolha-banco")'),
      title: z.string().min(1).describe('Human-readable title (e.g. "Adopt gRPC for internal services")'),
      context: z.string().min(1).describe('What problem or situation triggered this decision'),
      decision: z.string().min(1).describe('What was decided'),
      alternatives: z.string().default('None documented.').describe('Alternatives that were considered'),
      consequences: z.string().min(1).describe('Positive and negative trade-offs'),
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .describe('Date override YYYY-MM-DD (defaults to today)'),
    },
    async (params) => {
      try {
        const date = params.date ?? todayStr();
        const filename = `${date}-${slugify(params.topic)}.md`;
        const relPath = `projects/${params.project}/decisions/${filename}`;
        const content = buildADR({ ...params, date });

        await writeFile(relPath, content, `decision: ${params.project}/${filename}`);
        logger.info({ project: params.project, filename }, 'log_decision');

        return {
          content: [{ type: 'text' as const, text: `Decision saved: ${relPath}` }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    }
  );

  // ── list_decisions ────────────────────────────────────────────────────────
  server.tool(
    'list_decisions',
    'Lists all confirmed decisions for a project. Returns filenames, dates, and titles.',
    {
      project: z.string().min(1).describe('Project slug'),
      include_drafts: z.boolean().optional().default(false).describe('Also list pending drafts'),
    },
    async ({ project, include_drafts }) => {
      try {
        const decisions = await listDecisions(project, 'decisions');
        const drafts = include_drafts ? await listDecisions(project, 'drafts') : [];

        const lines: string[] = [`# ${project} — Decisions (${decisions.length})\n`];
        for (const d of decisions) lines.push(`- \`${d.date}\` **${d.title}** → ${d.filename}`);

        if (drafts.length) {
          lines.push(`\n## Drafts pending confirmation (${drafts.length})`);
          for (const d of drafts) lines.push(`- \`${d.date}\` ${d.title} → ${d.filename}`);
        }

        return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    }
  );

  // ── read_decision ─────────────────────────────────────────────────────────
  server.tool(
    'read_decision',
    'Reads the full content of a specific decision file.',
    {
      project: z.string().min(1).describe('Project slug'),
      filename: z.string().min(1).describe('Decision filename (e.g. "2026-07-01-grpc.md")'),
    },
    async ({ project, filename }) => {
      try {
        const content = await readFile(`projects/${project}/decisions/${filename}`);
        return { content: [{ type: 'text' as const, text: content }] };
      } catch {
        return {
          content: [{ type: 'text' as const, text: `Decision not found: ${filename}` }],
          isError: true,
        };
      }
    }
  );

  // ── confirm_draft ─────────────────────────────────────────────────────────
  server.tool(
    'confirm_draft',
    [
      'Confirms a draft decision generated by the ingestion worker.',
      'Moves it from projects/{project}/drafts/ to projects/{project}/decisions/.',
      'Use after reviewing a draft and deciding it accurately captures a real decision.',
    ].join(' '),
    {
      project: z.string().min(1).describe('Project slug'),
      filename: z.string().min(1).describe('Draft filename to confirm'),
    },
    async ({ project, filename }) => {
      try {
        const from = `projects/${project}/drafts/${filename}`;
        const to = `projects/${project}/decisions/${filename.replace(/-draft/, '')}`;
        await moveFile(from, to, `decision: confirm ${project}/${filename}`);
        logger.info({ project, filename }, 'confirm_draft');
        return { content: [{ type: 'text' as const, text: `Confirmed: ${to}` }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    }
  );
}
