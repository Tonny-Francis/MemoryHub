<div align="center">

<img src="docs/logo.svg" width="80" height="80" alt="MemoryHub logo" />

# MemoryHub

**Second brain automático para times de engenharia — captura contexto sem o dev precisar documentar**

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Node 20+](https://img.shields.io/badge/node-%3E%3D20-green)
![MCP compatible](https://img.shields.io/badge/MCP-compatible-4f8ef7)
![Docker ready](https://img.shields.io/badge/docker-ready-2496ED?logo=docker&logoColor=white)
![EKS ready](https://img.shields.io/badge/EKS-ready-FF9900?logo=amazonaws&logoColor=white)
![Helm chart](https://img.shields.io/badge/helm-chart-0f1689?logo=helm)

</div>

---

## O problema

Seu time tem dezenas de repositórios. Cada vez que um dev novo toca um serviço — ou você abre um chat de IA — precisa explicar o contexto do zero:

- *"Por que usamos gRPC aqui?"*
- *"Quem é o dono desse serviço?"*
- *"Por que não usamos Redis?"*
- *"Que decisão foi tomada naquela PR do mês passado?"*

A pessoa que sabe está de férias. A decisão foi tomada num thread do Discord há 8 meses. A IA não tem ideia.

**MemoryHub resolve isso automaticamente** — sem o dev precisar documentar nada.

---

## Como funciona (fluxo completo)

```mermaid
flowchart LR
    subgraph Fontes["📥 Fontes automáticas"]
        A["git commit\n(Husky hook)"]
        B["AI chat\n(Claude Code + MCP)"]
        C["GitLab MR / push\n(webhook)"]
        D["Trello cards\n(webhook)"]
        E["Discord\n(bot + Whisper)"]
    end

    subgraph Engine["⚙️ Engine"]
        F["Extractor\nÉ uma decisão?\n(Haiku opcional)"]
        G["Activity Logger\n(append-only)"]
    end

    subgraph Vault["🗄️ Vault (git-backed)"]
        H["drafts/\nrevisar"]
        I["decisions/\nconfirmado"]
        J["activity/\nlog diário"]
    end

    subgraph Consume["🔍 Consumo"]
        K["get_context MCP\n(sessão de IA)"]
        L["search_vault\nfull-text / semântica"]
        M["CLI local\nweekly digest"]
        N["MR auto-comment\ndecisões relevantes"]
    end

    A -->|AI resume commit| F
    B -->|log_decision direto| I
    C --> F
    D --> F
    D --> G
    E --> F

    F -->|sim| H
    F -->|não| G
    G --> J
    H -->|confirm_draft| I

    I --> K
    I --> L
    I --> N
    J --> L
    J --> M
    I --> M
```

### O loop fechado

1. Dev trabalha normalmente (commita, move card no Trello, discute no chat de IA)
2. MemoryHub captura, extrai, classifica — **zero ação do dev**
3. Decisões vão para `drafts/` → humano confirma em 1 clique pela UI
4. Na próxima sessão de IA no mesmo projeto → `get_context` já sabe de tudo

---

## Setup em um projeto existente

```bash
# Dentro do projeto que você quer monitorar (5 minutos):
node /caminho/para/memoryhub/scripts/memoryhub-init.mjs meu-projeto

# Preencher .env gerado com 2 campos:
MEMORYHUB_API_URL=https://memoryhub.empresa.com
MEMORYHUB_API_TOKEN=<jwt de /api/auth/login>
```

O `init` cria automaticamente:

| Arquivo | O que faz |
|---|---|
| `.husky/post-commit` | Cada commit → AI resume → vault activity log |
| `.mcp.json` | Claude Code tem `log_decision`, `get_context`, `search_vault` |
| `CLAUDE.md` | Instrui o Claude a logar decisões sem o dev pedir |
| `.env` stub | Variáveis necessárias pré-preenchidas |

---

## O que é capturado automaticamente

| Evento | O que salva | Quem faz |
|---|---|---|
| `git commit` | Resumo AI + link → activity log | Husky (zero ação do dev) |
| Conversa no Claude Code | Decisão detectada → draft | CLAUDE.md instrui o Claude |
| `get_context` ao abrir arquivo | Traz decisões anteriores relevantes | Claude lê automaticamente |
| GitLab MR aberto | Detecta decisão → draft | Webhook |
| GitLab MR aberto | Comenta com contexto do vault | Auto-comment |
| Card movido / comentado (Trello) | Entry no activity log diário | Webhook |
| Reunião no Discord (voz) | Transcreve por speaker → draft | Bot + Whisper |

---

## Início rápido (local)

```bash
git clone https://github.com/Tonny-Francis/MemoryHub.git
cd MemoryHub

cp .env.example .env
# Editar .env — definir JWT_SECRET e credenciais admin

docker compose up
```

Abrir [http://localhost:8000](http://localhost:8000) e entrar com as credenciais do `.env`.

### Conectar ao Claude Code

```bash
# Obter JWT
curl -s -X POST http://localhost:8000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@exemplo.com","password":"suasenha"}' \
  | jq -r .accessToken
```

Adicionar ao `~/.claude/settings.json` (global) **ou** `.mcp.json` no projeto (recomendado):

```json
{
  "mcpServers": {
    "memoryhub": {
      "type": "http",
      "url": "http://localhost:8000/mcp",
      "headers": {
        "Authorization": "Bearer SEU_TOKEN"
      }
    }
  }
}
```

Pronto — toda sessão de Claude Code nesse projeto já tem os tools disponíveis.

---

## MCP Tools

| Tool | Descrição |
|---|---|
| `get_context` | Contexto compacto do projeto (~800 tokens). Passa `project` ou omite para listar tudo. Aceita `file` para trazer decisões relevantes ao arquivo. |
| `log_decision` | Salva um ADR estruturado em `decisions/`. Chamado automaticamente pelo Claude quando detecta uma decisão. |
| `confirm_draft` | Promove um draft de `drafts/` para `decisions/`. |
| `list_decisions` | Lista decisões confirmadas de um projeto. |
| `read_decision` | Lê o conteúdo completo de uma decisão. |
| `search_vault` | Busca full-text em todos os arquivos do vault. |
| `semantic_search` | Busca por similaridade semântica (requer `OPENAI_API_KEY`). |
| `read_vault_file` | Lê qualquer arquivo do vault pelo caminho relativo. |
| `write_vault_file` | Cria ou atualiza arquivo no vault; auto-commit no git. |

---

## Estrutura do vault

```
vault/
├── _global/
│   ├── teams.md          ← quem cuida de cada repo
│   └── glossary.md       ← termos da empresa
└── projects/
    └── {slug}/
        ├── overview.md   ← stack, dono, status (≤5 linhas — o que get_context lê)
        ├── context.md    ← contexto estendido para a IA
        ├── decisions/    ← ADRs confirmados (commitados no git)
        │   └── 2026-07-14-grpc-sobre-rest.md
        ├── drafts/       ← gerados pela IA, aguardando confirmação humana
        ├── activity/     ← logs diários (commits, cards, MRs)
        │   └── 2026-07-14.md
        └── architecture/ ← diagramas, notas de sistema
```

Cada escrita é commitada em um repo git privado. Histórico completo, sem vendor lock-in.

---

## Ferramentas locais (sem servidor)

```bash
# Busca no vault
node scripts/memoryhub-cli.mjs search "por que grpc"

# Decisões dos últimos 30 dias
node scripts/memoryhub-cli.mjs decisions api-payments --days=30

# Contexto de um arquivo específico
node scripts/memoryhub-cli.mjs context src/auth/middleware.ts

# Digest semanal em markdown
node scripts/weekly-digest.mjs --project=api-payments --output=digest.md
```

---

## Integrações

| Integração | O que captura | Doc completo |
|---|---|---|
| [git commit + Husky](docs/integrations/git-commits.md) | Resumo AI de cada commit → activity log | → |
| [Claude Code (MCP)](docs/integrations/mcp-tools.md) | Decisões durante o chat de IA — sem o dev pedir | → |
| [GitLab](docs/integrations/gitlab.md) | MRs, commits, auto-comment com contexto | → |
| [Trello](docs/integrations/trello.md) | Cards, comentários, checklists em tempo real | → |
| [Discord](docs/integrations/discord.md) | Canais de texto + gravação e transcrição de voz | → |
| [Busca semântica](docs/integrations/semantic-search.md) | pgvector + OpenAI embeddings (opcional) | → |
| [CLI e ferramentas locais](docs/integrations/local-tools.md) | `memoryhub-cli`, `weekly-digest`, `memoryhub-init` | → |

**→ [Ver diagrama geral e variáveis de ambiente](docs/integrations/README.md)**

Todos os candidatos a decisão vão para `drafts/` primeiro. Humano confirma via UI ou `confirm_draft`.

---

## Deploy no Kubernetes

Suporta K3s (VPS), EKS, GKE, AKS e qualquer K8s genérico — o que muda entre plataformas é o ingress controller e a storage class.

**→ [Guia completo de deploy (K3s / EKS / GKE / AKS)](docs/deploy-k8s.md)**

### Início rápido (K3s — mais simples)

```bash
# 1. Secrets
kubectl create secret generic memoryhub-secrets \
  --from-literal=jwtSecret="$(openssl rand -hex 32)" \
  --from-literal=initialAdminEmail="admin@empresa.com" \
  --from-literal=initialAdminPassword="$(openssl rand -base64 16)" \
  --from-literal=gitVaultRepoUrl="https://oauth2:TOKEN@gitlab.com/org/vault.git" \
  --from-literal=gitlabToken="" \
  --from-literal=discordBotToken="" \
  --from-literal=discordChannelIds="" \
  --from-literal=trelloApiKey="" \
  --from-literal=trelloToken=""

# 2. Instalar (K3s usa Traefik como ingress)
helm install memoryhub ./helm/memoryhub \
  --set ingress.className=traefik \
  --set ingress.annotations."cert-manager\.io/cluster-issuer"=letsencrypt-prod \
  --set ingress.host=memoryhub.empresa.com \
  --set ingress.tls=true \
  --set vault.persistence.storageClass=local-path \
  --set postgres.persistence.storageClass=local-path

# 3. Acompanhar o rollout
kubectl rollout status deployment/memoryhub
```

### Footprint mínimo

| Componente | CPU req | Mem req | Limite |
|---|---|---|---|
| memoryhub app | 50m | 128Mi | 300m / 384Mi |
| postgres | 50m | 64Mi | 200m / 256Mi |
| ingestion cronjob | 50m | 64Mi | 200m / 256Mi |

---

## Desenvolvimento

```bash
npm install
cd ui && npm install && cd ..

# Postgres local
docker compose up postgres -d

# Schema (sem arquivos de migration)
npm run db:push

# Backend (porta 8000, hot reload)
npm run dev

# UI dev server (porta 5173, proxy → 8000)
cd ui && npm run dev
```

Build completo (igual ao Docker):

```bash
npm run build:all
npm start
```

---

## Roadmap

- [x] Vault multi-projeto (git-backed, markdown)
- [x] MCP server — `get_context`, `log_decision`, `search_vault`, `confirm_draft` + 5 tools
- [x] Auth — email + JWT + roles (Reader / Writer / Admin)
- [x] Web UI — login, projetos, busca, confirmar/rejeitar drafts
- [x] Helm chart — EKS, Postgres bundled, ingestion CronJob
- [x] GitLab adapter — MR / push webhook + polling + auto-comment no MR
- [x] Discord adapter — bot, polling de canais, gravação de voz + Whisper
- [x] Trello adapter — webhook em tempo real (cards, comentários, checklists)
- [x] Activity log diário — append-only por projeto
- [x] Husky post-commit hook — resumo AI → vault (Haiku ou GPT-4o-mini)
- [x] `memoryhub init` — setup de projeto em 1 comando
- [x] CLI local — `search`, `decisions`, `context`, `activity` (sem servidor)
- [x] Weekly digest script — relatório markdown local
- [x] `get_context` por arquivo — passa o path, recebe decisões relevantes
- [x] Busca semântica — pgvector + OpenAI embeddings (opcional)
- [ ] Slack adapter
- [ ] Confluence / Notion adapter
- [x] Grafo de conhecimento (visualização de conexões entre decisões)

---

## Licença

[MIT](LICENSE) — livre para usar, modificar e distribuir.

---

<div align="center">
  <sub>Feito por <a href="https://github.com/Tonny-Francis">@Tonny-Francis</a></sub>
</div>
