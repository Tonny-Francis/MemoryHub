import 'dotenv/config';

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { env } from './Config/Env.Config.js';
import { logger } from './Config/Logger.Config.js';
import { authMiddleware } from './Middleware/Auth.Middleware.js';
import { authRouter } from './Route/Auth.Route.js';
import { graphRouter } from './Route/Graph.Route.js';
import { ingestRouter } from './Route/Ingest.Route.js';
import { webRouter } from './Route/Web.Route.js';
import { seedAdminIfEmpty } from './Service/Auth.Service.js';
import { initGit, schedulePull } from './Service/Git.Service.js';
import { registerContextTool } from './Tool/Context.Tool.js';
import { registerDecisionTool } from './Tool/Decision.Tool.js';
import { registerSearchTool } from './Tool/Search.Tool.js';
import { registerSemanticSearchTool } from './Tool/SemanticSearch.Tool.js';
import { registerVaultTools } from './Tool/Vault.Tool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'memoryhub',
    version: '0.1.0',
  });

  registerContextTool(server);
  registerDecisionTool(server);
  registerSearchTool(server);
  registerSemanticSearchTool(server);
  registerVaultTools(server);

  return server;
}

async function main(): Promise<void> {
  if (!env.DATABASE_URL) { logger.error('DATABASE_URL is required'); process.exit(1); }
  if (!env.JWT_SECRET) { logger.error('JWT_SECRET is required'); process.exit(1); }

  await initGit();
  schedulePull();
  await seedAdminIfEmpty();

  const app = express();

  app.use(express.json({ limit: '10mb' }));

  // Static UI (built with `npm run build:ui`)
  app.use(express.static(publicDir));

  app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok', service: 'memoryhub', version: '0.1.0' });
  });

  // Auth routes (no middleware — login is public)
  app.use('/api/auth', authRouter());

  // Ingest webhooks — public (signature-verified per route)
  app.use('/api/ingest', ingestRouter());

  // Graph API
  app.use('/api/graph', graphRouter());

  // All other API routes require a valid JWT
  app.use('/api', authMiddleware, webRouter());

  // MCP endpoint — stateless, new server instance per request
  app.post('/mcp', authMiddleware, async (req, res) => {
    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);

    res.on('close', async () => {
      await transport.close();
      await server.close();
    });
  });

  // SPA fallback — serve index.html for all non-API routes
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/mcp') || req.path === '/healthz') {
      return next();
    }
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, 'MemoryHub started');
  });
}

main().catch((err) => {
  logger.error(err, 'Fatal startup error');
  process.exit(1);
});
