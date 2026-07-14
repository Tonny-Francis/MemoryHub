# Integração: GitLab

Monitora MRs e commits em busca de decisões arquiteturais e comenta automaticamente
em cada MR com o contexto relevante do vault.

---

## Como funciona

```mermaid
flowchart TD
    A["MR aberto / atualizado\nou push no GitLab"] -->|webhook POST| B["/api/ingest/gitlab"]
    B --> C{"Verifica\nassinatura\nX-Gitlab-Token"}
    C -->|inválida| D["401 — ignorado"]
    C -->|válida| E["handleGitLabWebhook\nparse do payload"]
    E --> F{"Contém keyword\nou label de decisão?"}
    F -->|não| G["ignorado"]
    F -->|sim| H["Extractor\n(Haiku opcional)"]
    H -->|decisão real| I["draft salvo\nprojects/slug/drafts/"]
    H -->|não é decisão| G
    E --> J["commentMrWithContext\nbusca decisões relevantes no vault"]
    J -->|encontrou| K["POST GitLab API\ncomenta no MR"]
    J -->|nenhuma| L["sem comentário"]

    subgraph Polling ["CronJob a cada 6h (polling)"]
        M["pollGitLab()"] --> N["MRs recentes com\ndecision / adr labels"]
        N --> H
        M --> O["Commits com\nkeywords de decisão"]
        O --> H
    end
```

---

## Pré-requisitos

- GitLab (cloud ou self-hosted)
- Token com escopo `read_api` e `api` (para comentar em MRs)
- URL pública do MemoryHub (para receber webhooks)

---

## Configuração

### 1. Criar token no GitLab

Settings → Access Tokens (ou Group/Project tokens):

- **Scopes:** `read_api`, `api`
- **Role:** Reporter ou superior

Salvar o token em `.env`:

```bash
GITLAB_TOKEN=glpat-xxxxxxxxxxxxxxxxxxxx
GITLAB_URL=https://gitlab.com    # ou sua instância self-hosted
GITLAB_PROJECT_IDS=123,456       # IDs numéricos ou "grupo/repo"
GITLAB_WEBHOOK_SECRET=segredo-aleatorio-forte
```

### 2. Registrar webhook no projeto GitLab

Project → Settings → Webhooks:

| Campo | Valor |
|---|---|
| URL | `https://memoryhub.empresa.com/api/ingest/gitlab` |
| Secret token | valor de `GITLAB_WEBHOOK_SECRET` |
| Events | ✅ Push events, ✅ Merge request events |
| SSL verification | ✅ (se tiver TLS válido) |

> Para múltiplos projetos, repetir em cada um. A URL é a mesma.

### 3. (Opcional) Configurar labels de decisão

O adapter detecta MRs com labels: `decision`, `adr`, `architecture`.

No GitLab, criar essas labels em Group → Labels para ficarem disponíveis em todos os projetos:

```
decision  →  cor sugerida: #0075ca
adr       →  cor sugerida: #e4e669
```

---

## Keywords detectadas automaticamente

O adapter captura MRs e commits que contenham qualquer uma destas palavras no título ou descrição:

```
decision  ·  adr  ·  architecture  ·  we decided  ·  chosen
```

Para adicionar keywords customizadas, editar `src/Ingestion/Adapters/GitLab.Adapter.ts`:

```typescript
const DECISION_KEYWORDS = ['decision', 'adr', 'architecture', 'we decided', 'chosen',
  'optamos', 'decidimos', 'escolhemos'];  // adicionar palavras em português
```

---

## MR auto-comment

Quando um MR é aberto, o MemoryHub busca decisões do vault relevantes ao conteúdo do MR
e posta um comentário automático.

**Exemplo de comentário gerado:**

```markdown
🧠 **MemoryHub** — decisões relevantes para este MR:

- `2026-06-28` **gRPC sobre REST para comunicação interna**
- `2026-07-10` **Redis para rate limiting multi-instância**

_Fonte: [MemoryHub](https://memoryhub.empresa.com) — base de conhecimento da equipe_
```

O comentário é postado apenas uma vez por MR (deduplicado por `projectId:mrIid`).

---

## Polling (CronJob)

Além dos webhooks, um CronJob roda a cada 6h e varre os projetos configurados em `GITLAB_PROJECT_IDS`,
buscando MRs e commits recentes. Útil para projetos que não têm webhook configurado ou para
retroalimentar decisões de antes da instalação do MemoryHub.

Rodar manualmente:

```bash
# Via API (requer role ADMIN)
curl -X POST https://memoryhub.empresa.com/api/ingest/run \
  -H "Authorization: Bearer TOKEN"

# Via CLI local
npm run ingestion:run
```

---

## O que é salvo no vault

### Draft de decisão

```markdown
# Draft: Migrar autenticação para OAuth 2.0

**Fonte:** GitLab MR !42 — payments-api
**URL:** https://gitlab.com/org/payments-api/-/merge_requests/42
**Autor:** Tonny Francis
**Data:** 2026-07-14

---

## Contexto
Precisamos suportar SSO corporativo sem manter senhas locais.

## Decisão proposta
Adotar OAuth 2.0 com GitLab como provider, usando biblioteca `golang.org/x/oauth2`.

## Alternativas descartadas
- SAML (complexidade de implementação)
- Auth0 (custo, vendor lock-in)
```

---

## Troubleshooting

**Webhook não chega:** verificar se a URL está acessível publicamente. Testar com:
```bash
curl -X POST https://memoryhub.empresa.com/api/ingest/gitlab \
  -H 'Content-Type: application/json' \
  -d '{"object_kind":"ping"}'
```

**"401 Invalid signature":** o `GITLAB_WEBHOOK_SECRET` no `.env` não bate com o configurado no GitLab.

**Sem auto-comment:** verificar se o token tem escopo `api` (não só `read_api`). Comentar exige POST na API.

**Polling não encontra nada:** verificar `GITLAB_PROJECT_IDS` — deve ser o ID numérico ou o path completo `grupo/repo`.
