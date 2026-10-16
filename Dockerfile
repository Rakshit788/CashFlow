# Monorepo build for backend services (api, worker)
FROM node:20-alpine AS base
WORKDIR /app
COPY . .
RUN npm ci
RUN npm run build:packages \
  && npm run build -w @cashflow/api \
  && npm run build -w @cashflow/worker

FROM base AS api
ENV NODE_ENV=production
EXPOSE 3001
CMD ["node", "apps/api/dist/index.js"]

FROM base AS worker
ENV NODE_ENV=production
CMD ["node", "apps/worker/dist/index.js"]
