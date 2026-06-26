# Demo-app image: the Fastify API serving the built React UI (single container,
# SPEC §5). Deploys to the sa-demo EKS cluster (us-west-1). The API connects to
# Temporal Cloud as a client; it does NOT invoke Lambdas (the serverless worker
# does), so it needs only Temporal creds at runtime.
#
# Build context = repo root:  docker build -f infra/docker/Dockerfile -t bmo-demo-app .

# --- build stage ---
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json tsconfig.json ./
COPY packages ./packages
COPY scripts ./scripts
RUN npm ci
RUN npm run build && npm --workspace @bmo/ui run build

# --- runtime stage ---
FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV UI_DIST=/app/packages/ui/dist
# Workspace symlinks under node_modules/@bmo/* resolve into packages/* (both copied).
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/package.json ./package.json
EXPOSE 8080
CMD ["node", "packages/api/dist/server.js"]
