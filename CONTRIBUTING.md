# Contributing to MemoryHub

Thanks for your interest in contributing!

## Development setup

```bash
npm install
cd ui && npm install && cd ..
docker compose up postgres -d
npm run db:push
npm run dev
# UI: cd ui && npm run dev
```

## Project structure

```
src/          Backend TypeScript (MCP server, REST API, auth, vault)
ui/           React + Vite frontend
helm/         Helm chart for Kubernetes
prisma/       Database schema
docs/         Diagrams and assets
```

## Guidelines

- **Keep PRs focused** — one feature or fix per PR
- **TypeScript strict** — no `any`, no skipping type errors
- **No breaking changes** to MCP tool signatures without a major version bump
- **Vault path safety** — always use `vaultPath()` / `projectPath()` helpers, never raw `path.join` with user input

## Adding an ingestion adapter

Create `src/Ingestion/{Name}.Adapter.ts` implementing:

```typescript
export interface IngestionAdapter {
  name: string;
  fetchCandidates(since: Date): Promise<DecisionCandidate[]>;
}

export interface DecisionCandidate {
  project: string;       // vault project slug
  title: string;
  rawContent: string;    // source text to extract from
  sourceUrl: string;     // link back to original
  sourceType: 'gitlab' | 'discord' | 'trello';
}
```

Then register it in `src/Ingestion/worker.ts`.

## Reporting issues

Please include:
- MemoryHub version (`/healthz` → `version`)
- Steps to reproduce
- Expected vs actual behaviour
