# Build from the monorepo root: fly deploy --dockerfile apps/coordinator/Dockerfile
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN corepack prepare pnpm@11.15.1 --activate \
 && pnpm install --frozen-lockfile \
 && pnpm --filter @sieveworks/protocol --filter @sieveworks/chain --filter @sieveworks/merkle --filter @sieveworks/wasm-runtime --filter @sieveworks/coordinator build \
 && pnpm --filter @sieveworks/coordinator deploy --legacy --prod /app

FROM node:22-slim
WORKDIR /app
COPY --from=build /app .
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
CMD ["node", "dist/index.js"]
