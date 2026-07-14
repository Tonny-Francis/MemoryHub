import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { logger } from '../Config/Logger.Config.js';
import { searchVault } from '../Service/Vault.Service.js';

export function registerSearchTool(server: McpServer): void {
  server.tool(
    'search_vault',
    [
      'Full-text search across all vault files.',
      'Returns matching files with line context.',
      'Use to answer questions like "why did we choose X?" or "where is Y documented?".',
      'Optionally scope to a single project for faster, more relevant results.',
    ].join(' '),
    {
      query: z.string().min(1).describe('Search term or question keyword'),
      project: z
        .string()
        .optional()
        .describe('Scope search to a specific project slug. Omit to search all projects.'),
    },
    async ({ query, project }) => {
      try {
        const matches = await searchVault(query, project);
        logger.debug({ query, project, matches: matches.length }, 'search_vault');

        if (matches.length === 0) {
          return {
            content: [{ type: 'text' as const, text: `No matches found for: "${query}"` }],
          };
        }

        const text = matches
          .slice(0, 20)
          .map((m) => `### ${m.file}\n${m.lines.join('\n')}`)
          .join('\n\n---\n\n');

        const header = `Found ${matches.length} file(s) matching "${query}"${project ? ` in ${project}` : ''}:\n\n`;

        return { content: [{ type: 'text' as const, text: header + text }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    }
  );
}
