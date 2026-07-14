#!/usr/bin/env node
/**
 * MemoryHub project initializer
 *
 * Configures a project for automatic context capture:
 *   - Husky post-commit hook (git commit → AI summary → vault)
 *   - .mcp.json (Claude Code gets MemoryHub tools)
 *   - CLAUDE.md snippet (AI auto-logs decisions)
 *   - .env entries (non-secret stubs)
 *
 * Usage (run inside the target project directory):
 *   node /path/to/memoryhub/scripts/memoryhub-init.mjs <project-slug>
 *
 * Example:
 *   node ~/memoryhub/scripts/memoryhub-init.mjs payments-api
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

// ── Args ──────────────────────────────────────────────────────────────────────
const slug = process.argv[2];
if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
  console.error('Usage: memoryhub-init.mjs <project-slug>  (lowercase, hyphens only)');
  process.exit(1);
}

const MEMORYHUB_DIR = path.dirname(new URL(import.meta.url).pathname).replace('/scripts', '');
const COMMIT_HOOK   = path.join(MEMORYHUB_DIR, 'scripts', 'vault-commit-summary.mjs');
const TARGET        = process.cwd();

function color(c, s) {
  const codes = { reset:'\x1b[0m', bold:'\x1b[1m', dim:'\x1b[2m', green:'\x1b[32m', cyan:'\x1b[36m', yellow:'\x1b[33m', red:'\x1b[31m' };
  return `${codes[c] ?? ''}${s}${codes.reset}`;
}

function step(label, fn) {
  try {
    fn();
    console.log(`  ${color('green', '✓')} ${label}`);
  } catch (err) {
    console.log(`  ${color('red', '✗')} ${label}: ${err.message}`);
  }
}

function readFile(p)  { try { return fs.readFileSync(p, 'utf-8'); } catch { return null; } }
function writeFile(p, content) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content, 'utf-8'); }
function appendUnique(filePath, marker, content) {
  const existing = readFile(filePath) ?? '';
  if (existing.includes(marker)) return false;
  writeFile(filePath, existing + content);
  return true;
}

console.log(`\n${color('bold', 'MemoryHub Init')} — configurando ${color('cyan', slug)}\n`);

// ── 1. Husky ──────────────────────────────────────────────────────────────────
step('Husky post-commit hook', () => {
  const pkgPath = path.join(TARGET, 'package.json');
  const pkg     = JSON.parse(readFile(pkgPath) ?? '{}');

  // Check if husky is already installed
  const hasHusky = pkg.devDependencies?.husky || pkg.dependencies?.husky
    || fs.existsSync(path.join(TARGET, 'node_modules', 'husky', 'package.json'));

  if (!hasHusky) {
    console.log(`     ${color('dim', 'installing husky...')}`);
    execSync('npm install --save-dev husky --silent', { cwd: TARGET, stdio: 'pipe' });
    execSync('npx husky init', { cwd: TARGET, stdio: 'pipe' });
  }

  const hookPath = path.join(TARGET, '.husky', 'post-commit');
  const hookLine = `node "${COMMIT_HOOK}"`;
  const existing = readFile(hookPath) ?? '';

  if (!existing.includes('vault-commit-summary')) {
    const content = existing.trim()
      ? `${existing.trimEnd()}\n${hookLine}\n`
      : `#!/bin/sh\n${hookLine}\n`;
    writeFile(hookPath, content);
    fs.chmodSync(hookPath, 0o755);
  }
});

// ── 2. .mcp.json ─────────────────────────────────────────────────────────────
step('.mcp.json (Claude Code MCP tools)', () => {
  const mcpPath = path.join(TARGET, '.mcp.json');
  let mcp = JSON.parse(readFile(mcpPath) ?? '{"mcpServers":{}}');

  if (!mcp.mcpServers) mcp.mcpServers = {};

  if (!mcp.mcpServers.memoryhub) {
    mcp.mcpServers.memoryhub = {
      command: 'node',
      args: [path.join(MEMORYHUB_DIR, 'dist', 'server.js'), '--mcp'],
      env: {
        DATABASE_URL:          '${DATABASE_URL}',
        JWT_SECRET:            '${JWT_SECRET}',
        VAULT_DIR:             '${VAULT_DIR}',
        MEMORYHUB_PROJECT:     slug,
      },
    };
    writeFile(mcpPath, JSON.stringify(mcp, null, 2) + '\n');
  }
});

// ── 3. CLAUDE.md ─────────────────────────────────────────────────────────────
step('CLAUDE.md (instrui AI a capturar decisões)', () => {
  const claudeMdPath = path.join(TARGET, 'CLAUDE.md');
  const marker       = '<!-- memoryhub -->';

  const snippet = `

${marker}
## MemoryHub — captura automática de contexto

Este projeto usa MemoryHub para documentação automática. Siga estas regras **sempre**:

### Quando logar uma decisão
Chame \`log_decision\` (via MCP) quando:
- Recomendar uma biblioteca, framework ou padrão arquitetural
- Decidir como estruturar uma feature, API ou schema
- Escolher entre alternativas técnicas
- Identificar um tradeoff importante

**Formato mínimo:**
\`\`\`
log_decision({
  title: "título curto da decisão",
  decision: "o que foi decidido",
  rationale: "por que essa escolha",
  alternatives: "o que foi descartado"
})
\`\`\`

### Quando buscar contexto
Antes de sugerir algo, chame \`get_context\` com o arquivo atual para ver decisões anteriores relevantes.

### O dev não vai pedir — faça automaticamente
O objetivo é zero esforço do dev. Se você detectar uma decisão sendo tomada no chat, log agora.
`;

  const added = appendUnique(claudeMdPath, marker, snippet);
  if (!added) { /* already present */ }
});

// ── 4. .env stubs ─────────────────────────────────────────────────────────────
step('.env (variáveis necessárias)', () => {
  const envPath = path.join(TARGET, '.env');
  const marker  = '# MemoryHub';

  const stub = `
# MemoryHub
MEMORYHUB_API_URL=http://localhost:8000
MEMORYHUB_API_TOKEN=    # jwt gerado em /api/auth/login
MEMORYHUB_PROJECT=${slug}
# ANTHROPIC_API_KEY=    # opcional — resumo de commits com Haiku
# OPENAI_API_KEY=       # opcional — busca semântica + Whisper
`;

  appendUnique(envPath, marker, stub);
});

// ── 5. .gitignore guard ───────────────────────────────────────────────────────
step('.gitignore (protege .mcp.json e .env)', () => {
  const ignorePath = path.join(TARGET, '.gitignore');
  const existing   = readFile(ignorePath) ?? '';

  const entries = [];
  if (!existing.includes('.env')) entries.push('.env');
  // .mcp.json pode ter paths absolutos locais — melhor não commitar
  if (!existing.includes('.mcp.json')) entries.push('.mcp.json');

  if (entries.length) {
    fs.appendFileSync(ignorePath, '\n# MemoryHub\n' + entries.join('\n') + '\n', 'utf-8');
  }
});

// ── Done ──────────────────────────────────────────────────────────────────────
console.log(`
${color('bold', 'Pronto!')} Próximos passos:

  ${color('cyan', '1.')} Preencha ${color('yellow', '.env')} com sua URL e token do MemoryHub
  ${color('cyan', '2.')} Abra Claude Code neste projeto — os MCP tools já estarão disponíveis
  ${color('cyan', '3.')} Qualquer commit irá logar um resumo automaticamente no vault

  ${color('dim', 'Teste agora:')}
     git commit -m "chore: test memoryhub hook"

  ${color('dim', 'Ver contexto do projeto:')}
     node ${MEMORYHUB_DIR}/scripts/memoryhub-cli.mjs decisions ${slug}
`);
