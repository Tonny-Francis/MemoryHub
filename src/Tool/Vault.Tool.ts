import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { logger } from '../Config/Logger.Config.js';
import { readFile, writeFile } from '../Service/Vault.Service.js';

export function registerVaultTools(server: McpServer): void {
  // ── read_vault_file ───────────────────────────────────────────────────────
  server.tool(
    'read_vault_file',
    'Reads any file from the vault by relative path (e.g. "projects/api-payments/context.md").',
    { path: z.string().describe('Relative path from vault root') },
    async ({ path: filePath }) => {
      try {
        const content = await readFile(filePath);
        logger.debug({ path: filePath }, 'read_vault_file');
        return { content: [{ type: 'text' as const, text: content }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    }
  );

  // ── write_vault_file ──────────────────────────────────────────────────────
  server.tool(
    'write_vault_file',
    [
      'Creates or updates any file in the vault. Commits and pushes to git automatically.',
      'Use for: updating context.md, architecture notes, task lists, or any knowledge artifact.',
      'Example paths: "projects/api-payments/context.md", "projects/api-payments/architecture/overview.md".',
    ].join(' '),
    {
      path: z.string().describe('Relative path from vault root'),
      content: z.string().describe('Full file content (Markdown recommended)'),
      commit_message: z.string().optional().describe('Git commit message (auto-generated if omitted)'),
    },
    async ({ path: filePath, content, commit_message }) => {
      try {
        await writeFile(filePath, content, commit_message);
        logger.info({ path: filePath }, 'write_vault_file');
        return { content: [{ type: 'text' as const, text: `Written: ${filePath}` }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    }
  );
}
