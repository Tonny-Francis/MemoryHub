<div align="center">
  <img src="docs/logo.svg" width="80" height="80" alt="MemoryHub logo" />
  <h1>MemoryHub</h1>
  <p><strong>Engineering knowledge base as MCP — multi-project second brain for software teams</strong></p>

  <p>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"/></a>
    <img src="https://img.shields.io/badge/node-%3E%3D20-green" alt="Node 20+"/>
    <img src="https://img.shields.io/badge/helm-chart-0f1689?logo=helm" alt="Helm chart"/>
    <img src="https://img.shields.io/badge/MCP-compatible-4f8ef7" alt="MCP compatible"/>
    <img src="https://img.shields.io/badge/docker-ready-2496ED?logo=docker&logoColor=white" alt="Docker ready"/>
    <img src="https://img.shields.io/badge/EKS-ready-FF9900?logo=amazonaws&logoColor=white" alt="EKS ready"/>
  </p>

  <br/>
</div>

---

## The problem

Your team has 50, 100, 200+ repositories. Every time a new developer touches a service — or you open an AI chat — someone has to explain the context from scratch:

- *"Why did we choose gRPC here?"*
- *"Who owns this service?"*
- *"What's the auth strategy in this repo?"*
- *"Was there a reason we didn't use Redis?"*

The person who knows is on vacation. The decision was made in a Discord thread 8 months ago. The AI assistant has no idea.

**MemoryHub fixes this.** It's an MCP server that gives every AI session instant, compact context about any project — without the dev having to ask, copy-paste docs, or ping anyone.

---

## How it works

<img src="docs/context-flow.svg" alt="Context flow: dev opens chat → get_context auto-runs → AI answers → decision logged" width="100%"/>

1. **Dev opens a chat** on any repo → the MCP `get_context` tool runs automatically (~800 tokens, not 8000)
2. **AI already knows** the stack, key decisions, open tasks, and architecture of that project
3. **Questions get answered** from the vault: *"why gRPC?"*, *"who owns this?"*, *"what's the retry strategy?"*
4. **Decisions are captured** — manually via `log_decision` during sessions, or automatically from GitLab MRs, Discord threads, and Trello cards

---

## Architecture

<img src="docs/architecture.svg" alt="MemoryHub system architecture" width="100%"/>

### Key design decisions

| Decision | Rationale |
|---|---|
| **`get_context` returns ≤ 800 tokens** | Not raw file dumps. Compact summary: stack, last 3 decisions (titles only), open tasks. |
| **Git-backed vault** | All knowledge lives in a private git repo. Full history, no vendor lock-in, works offline. |
| **Drafts → confirmation flow** | AI-extracted decisions go to `drafts/` first. Humans confirm via Web UI or `confirm_draft` tool. |
| **Single Docker image** | UI + backend in one container. No separate frontend deploy. |
| **Postgres in-cluster** | No RDS needed. StatefulSet with PVC. One `helm install` and you're done. |

---

## Features

- **MCP server** — works with Claude Code, Cursor, and any MCP-compatible AI client
- **Multi-project vault** — 100+ repos, each with isolated context, decisions, and architecture docs
- **Compact context** — `get_context` returns ≤800 tokens; not raw file dumps
- **Structured ADRs** — decisions stored as [Architecture Decision Records](https://adr.github.io/) with context, rationale, alternatives, and consequences
- **Auto-ingestion** from GitLab (MRs/commits), Discord (decision channels), and Trello (labeled cards)
- **Human-in-the-loop** — AI-generated drafts require human confirmation before becoming facts
- **Full-text search** — across all projects or scoped to one
- **Web UI** — login, browse projects, search, confirm/reject drafts
- **Auth** — email + password + JWT (15min access, 7d refresh) with roles: Reader / Writer / Admin
- **Git-backed vault** — private git repo with full commit history; push/pull on every write
- **Single Docker image** — UI and backend built together; one container to run
- **Helm chart** — production-ready deploy on EKS (or any K8s); Postgres included

---

## MCP tools

| Tool | Description |
|---|---|
| `get_context` | Returns compact project context (~800 tokens). Pass `project` slug or omit to list all projects. Call at session start. |
| `log_decision` | Saves a structured ADR (context, decision, alternatives, consequences) to `decisions/`. |
| `list_decisions` | Lists all confirmed decisions for a project, with optional draft listing. |
| `read_decision` | Reads the full content of a specific decision file. |
| `confirm_draft` | Promotes an AI-generated draft from `drafts/` to `decisions/`. |
| `search_vault` | Full-text search across all vault files. Optionally scoped to a project. |
| `read_vault_file` | Reads any vault file by relative path. |
| `write_vault_file` | Creates or updates any vault file, auto-commits to git. |

---

## Vault structure

```
vault/
├── _global/
│   ├── teams.md          ← who owns which repos
│   └── glossary.md       ← company-wide terminology
└── projects/
    └── {slug}/
        ├── overview.md   ← stack, owner, status (≤5 lines — what get_context reads)
        ├── context.md    ← extended context for the AI
        ├── decisions/    ← confirmed ADRs (committed to git)
        │   └── 2026-07-14-grpc-over-rest.md
        ├── drafts/       ← AI-generated, pending human confirmation
        │   └── 2026-07-14-remove-lodash-draft.md
        ├── architecture/ ← diagrams, ADL, system notes
        └── tasks/
            └── backlog.md
```

Every file is committed to a private git repo on every write. Full history. No lock-in.

---

## Quick start

### Local (Docker Compose)

```bash
git clone https://github.com/tonnysousa/memoryhub
cd memoryhub

cp .env.example .env
# Edit .env — set JWT_SECRET, admin credentials

docker compose up
```

Open [http://localhost:8000](http://localhost:8000) and sign in with your credentials from `.env`.

### Connect Claude Code

Get a JWT token:

```bash
curl -s -X POST http://localhost:8000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"changeme123"}' \
  | jq -r .accessToken
```

Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "memoryhub": {
      "type": "http",
      "url": "http://localhost:8000/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_ACCESS_TOKEN"
      }
    }
  }
}
```

Now every chat session has `get_context` available. Call it at the start of a session:

```
get_context({ project: "api-payments" })
```

Or omit the project to list everything:

```
get_context()
```

---

## Deploy on EKS

PostgreSQL runs **in-cluster** by default — no RDS setup needed.

```bash
# 1. Create the secrets (no databaseUrl — postgres is bundled)
kubectl create secret generic memoryhub-secrets \
  --from-literal=jwtSecret="$(openssl rand -hex 32)" \
  --from-literal=initialAdminEmail="admin@company.com" \
  --from-literal=initialAdminPassword="$(openssl rand -base64 16)" \
  --from-literal=gitVaultRepoUrl="https://oauth2:glpat-TOKEN@gitlab.com/org/vault.git" \
  --from-literal=gitlabToken="glpat-..." \
  --from-literal=discordBotToken="..." \
  --from-literal=discordChannelIds="123456789,987654321" \
  --from-literal=trelloApiKey="..." \
  --from-literal=trelloToken="..." \
  --from-literal=anthropicApiKey="sk-ant-..."

# 2. Install the Helm chart
helm install memoryhub ./helm/memoryhub \
  --set ingress.host=memoryhub.company.com \
  --set "ingress.annotations.alb\.ingress\.kubernetes\.io/certificate-arn=arn:aws:acm:..."

# 3. Watch the rollout
kubectl rollout status deployment/memoryhub
```

To use an external database instead of bundled Postgres:

```bash
helm install memoryhub ./helm/memoryhub \
  --set postgres.enabled=false \
  --set ingress.host=memoryhub.company.com
# And add databaseUrl to memoryhub-secrets
```

### Resource footprint (minimal by default)

| Component | CPU request | Memory request | Limit |
|---|---|---|---|
| memoryhub app | 50m | 128Mi | 300m / 384Mi |
| postgres | 50m | 64Mi | 200m / 256Mi |
| ingestion cronjob | 50m | 64Mi | 200m / 256Mi |

---

## Adding a project

Via the Web UI (Admin role) or MCP tool:

```
# Option A — MCP tool
write_vault_file({
  path: "projects/api-payments/overview.md",
  content: "# api-payments\n\n**Stack:** Go, PostgreSQL, gRPC\n**Owner:** backend-team\n**Repo:** gitlab.com/company/api-payments\n**Status:** production\n"
})

# Option B — REST API
curl -X POST http://memoryhub.company.com/api/projects \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"slug":"api-payments","name":"API Payments","stack":"Go, PostgreSQL, gRPC","owner":"backend-team"}'
```

---

## Ingestion sources

MemoryHub watches your existing tools and extracts decision candidates automatically.

| Source | What it reads | How |
|---|---|---|
| **GitLab** | Merge Request titles, descriptions, comments | Webhooks + polling via GitLab API |
| **Discord** | Messages in monitored channels (`#decisions`, `#architecture`), pinned messages | Discord Bot (read-only) |
| **Trello** | Cards with label "Decision" or "ADR" | Trello Webhooks |

All extracted candidates go to `projects/{slug}/drafts/` with a link to the source. A human confirms via the Web UI or `confirm_draft` MCP tool before they become permanent knowledge.

---

## Development

```bash
# Install deps
npm install
cd ui && npm install && cd ..

# Start postgres (or use docker compose up postgres)
docker compose up postgres -d

# Push schema (dev — creates tables without migration files)
npm run db:push

# Start backend (port 8000, hot reload)
npm run dev

# Start UI dev server (port 5173, proxies /api to 8000)
cd ui && npm run dev
```

Run the full build (what Docker does):

```bash
npm run build:all   # builds UI → public/ then compiles TS → dist/
npm start
```

---

## Contributing

Pull requests are welcome. For major changes please open an issue first.

1. Fork the repo
2. Create a branch: `git checkout -b feat/your-feature`
3. Commit with a clear message
4. Open a PR describing the change and why

Please keep PRs focused — one thing at a time.

---

## Roadmap

- [x] Multi-project vault (git-backed)
- [x] MCP server with `get_context`, `log_decision`, `search_vault`, `confirm_draft`
- [x] Auth (email + JWT + roles)
- [x] Web UI (login, projects, search, drafts)
- [x] Helm chart (EKS, bundled Postgres, ingestion CronJob)
- [ ] GitLab ingestion worker
- [ ] Discord bot adapter
- [ ] Trello webhook adapter
- [ ] Semantic search (pgvector + embeddings)
- [ ] Slack adapter
- [ ] Confluence / Notion adapter

---

## License

[MIT](LICENSE) — free to use, modify, and distribute.

---

<div align="center">
  <sub>Built with ❤️ by <a href="https://github.com/tonnysousa">@tonnysousa</a> · <a href="https://nexusops.com.br">Nexus Ops</a></sub>
</div>
