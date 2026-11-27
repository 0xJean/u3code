# Build from repository root:
#   docker build -f infra/hub/Dockerfile -t u3code-hub .
FROM node:24-alpine AS base

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@12.14.0 --activate

# Minimal standalone workspace manifest so Docker installs only Hub runtime deps (no mobile/desktop patches).
RUN printf '%s\n' \
  '{"private":true,"packageManager":"pnpm@12.14.0"}' \
  > package.json && \
  printf '%s\n' \
  'packages:' \
  '  - packages/hub-contracts' \
  '  - infra/hub' \
  'catalog:' \
  '  "@types/node": 24.12.4' \
  '  "@types/ws": 8.18.2' \
  '  effect: 4.1.5' \
  '  jose: 6.2.2' \
  '  vite-plus: 1.8.0' \
  '  ws: 8.22.0' \
  > pnpm-workspace.yaml

COPY packages/hub-contracts/package.json ./packages/hub-contracts/package.json
COPY infra/hub/package.json ./infra/hub/package.json

RUN pnpm install --filter @u3code/hub... --prod --no-frozen-lockfile --ignore-scripts

COPY packages/hub-contracts/src ./packages/hub-contracts/src
COPY infra/hub/src ./infra/hub/src
COPY infra/hub/drizzle ./infra/hub/drizzle

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4310

EXPOSE 4310

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4310/healthz || exit 1

CMD ["node", "infra/hub/src/index.ts"]
