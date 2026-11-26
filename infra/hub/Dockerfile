FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-workspace.yaml ./
COPY packages/hub-contracts/package.json ./packages/hub-contracts/
COPY infra/hub/package.json ./infra/hub/

RUN pnpm install --filter @u3code/hub... --no-frozen-lockfile

COPY tsconfig.base.json tsconfig.effect.json ./
COPY packages/hub-contracts ./packages/hub-contracts
COPY infra/hub ./infra/hub

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4310

EXPOSE 4310
CMD ["node", "--experimental-strip-types", "infra/hub/src/index.ts"]
