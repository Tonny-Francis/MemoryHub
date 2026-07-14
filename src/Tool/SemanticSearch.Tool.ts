import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { embeddingEnabled, semanticSearch } from '../Service/Embedding.Service.js';
import { searchVault } from '../Service/Vault.Service.js';

export function registerSemanticSearchTool(server: McpServer): void {
  server.tool(
    'semantic_search',
    'Search vault decisions by meaning/semantics. Uses vector embeddings when available (OPENAI_API_KEY set), otherwise falls back to full-text search.',
    {
      query: z.string().describe('Natural language query — e.g. "why did we choose gRPC?"'),
      project: z.string().optional().describe('Limit search to a specific project slug'),
      limit: z.number().int().min(1).max(50).default(10).describe('Max results to return'),
    },
    async ({ query, project, limit }) => {
      if (embeddingEnabled()) {
        const matches = await semanticSearch(query, project, limit);

        if (!matches.length) {
          return {
            content: [{ type: 'text', text: 'No semantically similar decisions found.' }],
          };
        }

        const lines = matches.map((m, i) => {
          const excerpt = m.content.slice(0, 300).replace(/\n+/g, ' ');
          return `${i + 1}. [${(m.similarity * 100).toFixed(1)}%] ${m.path}\n   ${excerpt}`;
        });

        return {
          content: [
            {
              type: 'text',
              text: `Found ${matches.length} semantically similar result(s):\n\n${lines.join('\n\n')}`,
            },
          ],
        };
      }

      // Fallback: full-text grep
      const results = await searchVault(query, project);
      if (!results.length) {
        return {
          content: [{ type: 'text', text: 'No results found (full-text fallback — set OPENAI_API_KEY for semantic search).' }],
        };
      }

      const lines = results
        .slice(0, limit)
        .map((r, i) => `${i + 1}. ${r.file}\n   ${r.lines.slice(0, 2).join(' | ')}`);

      return {
        content: [
          {
            type: 'text',
            text: `Found ${results.length} result(s) [full-text, no OPENAI_API_KEY set]:\n\n${lines.join('\n\n')}`,
          },
        ],
      };
    },
  );
}
