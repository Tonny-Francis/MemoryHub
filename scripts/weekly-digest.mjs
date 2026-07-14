#!/usr/bin/env node
/**
 * MemoryHub Weekly Digest — generates a markdown report from vault data.
 * Runs locally against the cloned vault. No server needed.
 *
 * Usage:
 *   node scripts/weekly-digest.mjs [--project=slug] [--days=7] [--output=digest.md]
 *
 * Env: VAULT_DIR (default: ./vault)
 */

import fs from 'node:fs';
import path from 'node:path';

const VAULT = process.env.VAULT_DIR ?? path.join(process.cwd(), 'vault');
const args = process.argv.slice(2);
const project  = args.find(a => a.startsWith('--project='))?.slice(10);
const days     = parseInt(args.find(a => a.startsWith('--days='))?.slice(7) ?? '7');
const output   = args.find(a => a.startsWith('--output='))?.slice(9);

function readDir(p)   { try { return fs.readdirSync(p); } catch { return []; } }
function readFile(p)  { try { return fs.readFileSync(p, 'utf-8'); } catch { return null; } }

function sinceDate(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

const since    = sinceDate(days);
const today    = new Date().toISOString().slice(0, 10);
const projects = project ? [project] : readDir(path.join(VAULT, 'projects'));

const lines = [
  `# MemoryHub Weekly Digest`,
  `**Period:** ${since} → ${today} (last ${days} days)`,
  `**Generated:** ${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC`,
  '',
];

for (const slug of projects) {
  const projectLines = [];

  // Decisions confirmed this week
  const decisionsDir = path.join(VAULT, 'projects', slug, 'decisions');
  const newDecisions = readDir(decisionsDir)
    .filter(f => f.endsWith('.md') && f.slice(0, 10) >= since)
    .sort();

  if (newDecisions.length) {
    projectLines.push(`### ✅ Decisions confirmed (${newDecisions.length})`);
    for (const f of newDecisions) {
      const content = readFile(path.join(decisionsDir, f));
      const title = content?.split('\n').find(l => l.startsWith('# '))?.replace('# ', '') ?? f.slice(11).replace(/-/g, ' ').replace('.md', '');
      const decisionLine = content?.split('\n').find(l => l.toLowerCase().startsWith('## decision'))
        ? content.split(/## Decision/i)[1]?.split('\n').filter(l => l.trim()).slice(0, 2).join(' ') ?? ''
        : '';
      projectLines.push(`- \`${f.slice(0, 10)}\` **${title}**${decisionLine ? `\n  > ${decisionLine.slice(0, 150)}` : ''}`);
    }
  }

  // Drafts pending
  const draftsDir = path.join(VAULT, 'projects', slug, 'drafts');
  const pendingDrafts = readDir(draftsDir).filter(f => f.endsWith('.md'));
  if (pendingDrafts.length) {
    projectLines.push(`\n### ⏳ Drafts pending review (${pendingDrafts.length})`);
    for (const f of pendingDrafts.slice(0, 5)) {
      projectLines.push(`- ${f.slice(11).replace(/-draft\.md$/, '').replace(/-/g, ' ')}`);
    }
    if (pendingDrafts.length > 5) projectLines.push(`- _...and ${pendingDrafts.length - 5} more_`);
  }

  // Activity highlights
  const activityDir = path.join(VAULT, 'projects', slug, 'activity');
  const activityFiles = readDir(activityDir)
    .filter(f => f.endsWith('.md') && f.slice(0, 10) >= since)
    .sort();

  if (activityFiles.length) {
    let totalEvents = 0;
    const highlights = [];

    for (const f of activityFiles) {
      const content = readFile(path.join(activityDir, f));
      if (!content) continue;
      const entries = content.split(/^## /m).slice(1);
      totalEvents += entries.length;
      // Pick interesting entries: card moves to Done, decisions
      for (const entry of entries) {
        const firstLine = entry.split('\n')[0];
        if (/done|concluí|decision|decidid/i.test(entry)) {
          highlights.push(`  - ${firstLine.slice(0, 100)}`);
        }
      }
    }

    projectLines.push(`\n### 📋 Activity (${totalEvents} events across ${activityFiles.length} days)`);
    if (highlights.length) {
      projectLines.push('**Highlights:**');
      projectLines.push(...highlights.slice(0, 5));
    }
  }

  if (projectLines.length) {
    lines.push(`## ${slug}`);
    lines.push(...projectLines);
    lines.push('');
  }
}

if (lines.length <= 4) {
  lines.push('_No activity recorded in this period._');
}

const digest = lines.join('\n');

if (output) {
  fs.writeFileSync(output, digest, 'utf-8');
  console.log(`Digest written to ${output}`);
} else {
  console.log(digest);
}
