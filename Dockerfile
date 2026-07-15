# ── Stage 1: Build UI ────────────────────────────────────────────────────────
FROM node:20-alpine AS ui-builder
WORKDIR /app/ui
COPY ui/package*.json ./
RUN npm ci
COPY ui/ ./
RUN npm run build

# ── Stage 2: Build backend ────────────────────────────────────────────────────
FROM node:20-alpine AS backend-builder
WORKDIR /app
COPY package*.json ./
COPY prisma/ ./prisma/
RUN npm ci
RUN npx prisma generate
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ── Stage 3: Runtime ─────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production

# Patch Alpine OS vulnerabilities (libssl/libcrypto)
RUN apk upgrade --no-cache libcrypto3 libssl3

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
  CMD wget -qO- http://localhost:8000/healthz || exit 1

CMD ["node", "dist/server.js"]
