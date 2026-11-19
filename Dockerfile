FROM node:26-bookworm-slim AS workspace
WORKDIR /workspace
RUN npm install --global pnpm@11.3.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json

FROM workspace AS build
RUN pnpm install --frozen-lockfile --filter @finscope/api
COPY apps/api/tsconfig*.json apps/api/
COPY apps/api/src apps/api/src
RUN pnpm --filter @finscope/api build

FROM workspace AS dependencies
RUN pnpm install --frozen-lockfile --prod --filter @finscope/api

FROM node:26-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /workspace
COPY --from=dependencies /workspace/node_modules ./node_modules
COPY --from=dependencies /workspace/apps/api/node_modules ./apps/api/node_modules
COPY --from=dependencies /workspace/apps/api/package.json ./apps/api/package.json
COPY --from=build /workspace/apps/api/dist ./apps/api/dist
USER node
EXPOSE 3000
CMD ["node", "--enable-source-maps", "apps/api/dist/index.js"]
