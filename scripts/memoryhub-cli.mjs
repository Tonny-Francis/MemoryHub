#!/usr/bin/env node
/**
 * MemoryHub local CLI — queries the cloned vault directly, no server needed.
 *
 * Usage:
 *   node scripts/memoryhub-cli.mjs search "why grpc"
 *   node scripts/memoryhub-cli.mjs decisions api-payments [--days 30]
 *   node scripts/memoryhub-cli.mjs context src/auth/middleware.ts
 *   node scripts/memoryhub-cli.mjs activity api-payments [--days 7]
 *
 * Env:
 *   VAULT_DIR  path to your local vault clone (default: ./vault)
 */

import fs from 'node:fs';
import path from 'node:path';

const VAULT = process.env.VAULT_DIR ?? path.join(process.cwd(), 'vault');
const [,, cmd, ...rest] = process.argv;

function color(c, s) {
  const codes = { reset:'\x1b[0m', bold:'\x1b[1m', dim:'\x1b[2m', green:'\x1b[32m', cyan:'\x1b[36m', yellow:'\x1b[33m', red:'\x1b[31m' };
  return `${codes[c] ?? ''}${s}${codes.reset}`;
}

function readDir(p) {
  try { return fs.readdirSync(p); } catch { return []; }
}

function readFile(p) {
  try { return fs.readFileSync(p, 'utf-8'); } catch { return null; }
}

function walkMd(dir, results = []) {
  for (const entry of readDir(dir)) {
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if (stat.isDirectory() && !entry.startsWith('.')) walkMd(full, results);
    else if (entry.endsWith('.md')) results.push(full);
  }
  return results;
}

function sinceDate(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

// ── Commands ──────────────────────────────────────────────────────────────────

function cmdSearch(args) {
  const query = args.filter(a => !a.startsWith('--')).join(' ').toLowerCase();
  const project = args.find(a => a.startsWith('--project='))?.slice(10);
  if (!query) { console.error('Usage: search <query> [--project=slug]'); process.exit(1); }

  const root = project ? path.join(VAULT, 'projects', project) : path.join(VAULT, 'projects');
  const files = walkMd(root);
  let found = 0;

  for (const file of files) {
    const content = readFile(file);
    if (!content?.toLowerCase().includes(query)) continue;
    const rel = path.relative(VAULT, file);
    const lines = content.split('\n')
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => l.toLowerCase().includes(query))
      .slice(0, 3)
      .map(({ l, i }) => `  ${color('dim', `L${i+1}:`)} ${l.trim()}`);
    console.log(`\n${color('cyan', rel)}`);
    console.log(lines.join('\n'));
    found++;
  }

  console.log(`\n${color('dim', `${found} file(s) matched "${query}"`)}`);
}

function cmdDecisions(args) {
  const project = args.find(a => !a.startsWith('--'));
  const days = parseInt(args.find(a => a.startsWith('--days='))?.slice(7) ?? '0');
  const since = days ? sinceDate(days) : null;

  const projects = project ? [project] : readDir(path.join(VAULT, 'projects'));

  for (const slug of projects) {
    const dir = path.join(VAULT, 'projects', slug, 'decisions');
    const files = readDir(dir).filter(f => f.endsWith('.md')).sort().reverse();
    const filtered = since ? files.filter(f => f.slice(0, 10) >= since) : files;
    if (!filtered.length) continue;

    console.log(`\n${color('bold', slug)}`);
    for (const f of filtered) {
      const date = f.slice(0, 10);
      const title = f.slice(11).replace(/-/g, ' ').replace('.md', '');
      console.log(`  ${color('dim', date)}  ${title}`);
    }
  }
}

function cmdContext(args) {
  const filePath = args.find(a => !a.startsWith('--')) ?? '';
  const project = args.find(a => a.startsWith('--project='))?.slice(10);

  const keywords = filePath
    .replace(/\\/g, '/')
    .split('/')
    .flatMap(seg => seg.replace(/\.[^.]+$/, '').split(/[-_.]/))
    .map(k => k.toLowerCase())
    .filter(k => k.length > 2 && !['src','lib','app','pkg','test','spec','index','main','mod','utils','helpers','types'].includes(k));

  if (!keywords.length) { console.error('No meaningful keywords extracted from path'); process.exit(1); }
  console.log(`${color('dim', 'Keywords:')} ${keywords.join(', ')}\n`);

  const projects = project ? [project] : readDir(path.join(VAULT, 'projects'));
  let found = 0;

  for (const slug of projects) {
    const dir = path.join(VAULT, 'projects', slug, 'decisions');
    for (const f of readDir(dir).filter(f => f.endsWith('.md'))) {
      const content = readFile(path.join(dir, f));
      if (!content) continue;
      const lower = content.toLowerCase();
      if (!keywords.some(kw => lower.includes(kw))) continue;
      const title = f.slice(11).replace(/-/g, ' ').replace('.md', '');
      const excerpt = content.split('\n').filter(l => l.trim() && !l.startsWith('#')).slice(0, 2).join(' ');
      console.log(`${color('cyan', slug + '/')}${color('bold', f.slice(0, 10))} ${title}`);
      console.log(`  ${color('dim', excerpt.slice(0, 120))}\n`);
      found++;
    }
  }

  if (!found) console.log(color('dim', 'No decisions found for these keywords.'));
}

function cmdActivity(args) {
  const project = args.find(a => !a.startsWith('--'));
  const days = parseInt(args.find(a => a.startsWith('--days='))?.slice(7) ?? '7');
  const since = sinceDate(days);

  const projects = project ? [project] : readDir(path.join(VAULT, 'projects'));

  for (const slug of projects) {
    const dir = path.join(VAULT, 'projects', slug, 'activity');
    const files = readDir(dir)
      .filter(f => f.endsWith('.md') && f.slice(0, 10) >= since)
      .sort().reverse();
    if (!files.length) continue;

    console.log(`\n${color('bold', slug)} — last ${days} days`);
    for (const f of files) {
      const content = readFile(path.join(dir, f));
      if (!content) continue;
      const entries = content.split(/^## /m).filter(Boolean).length - 1;
      console.log(`  ${color('cyan', f.slice(0, 10))}  ${entries} event(s)`);
      // Print first 3 entry titles
      const titles = content.match(/^## .+/mg)?.slice(0, 3) ?? [];
      for (const t of titles) console.log(`    ${color('dim', t.replace(/^## /, ''))}`);
    }
  }
}

function help() {
  console.log(`
${color('bold', 'MemoryHub CLI')} — local vault queries (no server needed)

  ${color('cyan', 'search')} <query> [--project=slug]
  ${color('cyan', 'decisions')} [project] [--days=N]
  ${color('cyan', 'context')} <file-path> [--project=slug]
  ${color('cyan', 'activity')} [project] [--days=7]

${color('dim', 'Env: VAULT_DIR (default: ./vault)')}
`);
}

switch (cmd) {
  case 'search':     cmdSearch(rest);    break;
  case 'decisions':  cmdDecisions(rest); break;
  case 'context':    cmdContext(rest);   break;
  case 'activity':   cmdActivity(rest);  break;
  default:           help();
}
