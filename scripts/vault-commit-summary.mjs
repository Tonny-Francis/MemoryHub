#!/usr/bin/env node
/**
 * MemoryHub — Husky post-commit hook
 *
 * Summarizes the latest commit with AI and logs it to the vault activity feed.
 * Never blocks the commit — all errors are silent.
 *
 * Setup in any project:
 *   npm install --save-dev husky
 *   npx husky add .husky/post-commit "node /path/to/memoryhub/scripts/vault-commit-summary.mjs"
 *
 * Required env vars (add to .env or shell profile):
 *   MEMORYHUB_API_URL      e.g. https://memoryhub.example.com
 *   MEMORYHUB_API_TOKEN    JWT token (from /api/auth/login)
 *   MEMORYHUB_PROJECT      project slug in the vault
 *   ANTHROPIC_API_KEY      or OPENAI_API_KEY (one is enough)
 */

import { execSync } from 'node:child_process';

// ── Load env from .env file if present ───────────────────────────────────────
try {
  const fs = await import('node:fs');
  const envFile = process.cwd() + '/.env';
  if (fs.existsSync(envFile)) {
    const lines = fs.readFileSync(envFile, 'utf-8').split('\n');
    for (const line of lines) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
} catch { /* ignore */ }

const API_URL   = process.env.MEMORYHUB_API_URL;
const API_TOKEN = process.env.MEMORYHUB_API_TOKEN;
const PROJECT   = process.env.MEMORYHUB_PROJECT;
const ANTHROPIC = process.env.ANTHROPIC_API_KEY;
const OPENAI    = process.env.OPENAI_API_KEY;

if (!API_URL || !API_TOKEN || !PROJECT || (!ANTHROPIC && !OPENAI)) process.exit(0);

// ── Get commit info ───────────────────────────────────────────────────────────
function git(cmd) {
  try { return execSync(cmd, { encoding: 'utf-8' }).trim(); } catch { return ''; }
}

const hash    = git('git log -1 --format="%H"').slice(0, 12);
const message = git('git log -1 --format="%s"');
const author  = git('git log -1 --format="%an"');
const stat    = git('git diff HEAD~1 HEAD --stat 2>/dev/null || git show --stat HEAD').slice(0, 1200);
const diff    = git('git diff HEAD~1 HEAD -- "*.ts" "*.go" "*.py" "*.js" "*.tsx" 2>/dev/null || git show HEAD -- "*.ts" "*.go" "*.py" "*.js" "*.tsx"').slice(0, 3000);

if (!message) process.exit(0);

// ── Prompt ────────────────────────────────────────────────────────────────────
const prompt = `Summarize this git commit concisely in 2-3 sentences in the same language as the commit message. Focus on WHAT changed and WHY (if inferable). If an architectural decision was made, flag it with "⚠️ Decision:".

Commit: ${message}
Author: ${author}
Hash: ${hash}

Stats:
${stat}

Key changes (excerpt):
${diff.slice(0, 2000)}

Reply with ONLY the summary — no headers, no markdown, just plain text sentences.`;

// ── Call AI ───────────────────────────────────────────────────────────────────
async function summarize() {
  if (ANTHROPIC) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 256,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const d = await res.json();
    return d.content?.[0]?.text?.trim() ?? null;
  }

  if (OPENAI) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 256,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const d = await res.json();
    return d.choices?.[0]?.message?.content?.trim() ?? null;
  }

  return null;
}

// ── Post to vault ─────────────────────────────────────────────────────────────
async function main() {
  const summary = await summarize();
  if (!summary) return;

  const now = new Date().toISOString().slice(11, 16);
  const repoName = git('git remote get-url origin').split('/').pop()?.replace('.git', '') || 'repo';
  const shortMsg = message.slice(0, 80);
  const isDecision = summary.includes('⚠️ Decision:');

  const line = [
    `## ${now} — Commit [${hash}](${git('git remote get-url origin').replace('.git', '')}/commit/${git('git log -1 --format="%H"')})`,
    `**${shortMsg}** | por ${author} | \`${repoName}\``,
    '',
    summary,
  ].join('\n');

  await fetch(`${API_URL}/api/ingest/commit`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ project: PROJECT, line, isDecision, commitHash: hash, message }),
  }).catch(() => {});
}

main().catch(() => {});
