# ── Stage 1: Build UI ────────────────────────────────────────────────────────
FROM node:20-alpine AS ui-builder
WORKDIR /app/ui
COPY ui/package*.json ./
RUN npm ci
COPY ui/ ./
RUN npm run build

# ── Stage 2: Build backend ────────────────────────────────────────────────────
FROM node:20-slim AS backend-builder
WORKDIR /app
COPY package*.json ./
COPY prisma/ ./prisma/
RUN npm ci
RUN npx prisma generate
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ── Stage 3: Runtime ─────────────────────────────────────────────────────────
FROM node:20-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production

RUN apt-get update -qq && apt-get upgrade -y --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Only production deps
COPY package*.json ./
COPY prisma/ ./prisma/
RUN npm ci --omit=dev && npx prisma generate

# Backend build output
COPY --from=backend-builder /app/dist ./dist

# UI build → served as static from Express
COPY --from=ui-builder /app/public ./public

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "require('http').get('http://localhost:8000/healthz', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "dist/server.js"]
