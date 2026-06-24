# Single, deterministic production image for the Nebula API server.
# It serves the booking apps, published sites and every /api endpoint.
#
# Using a Dockerfile (instead of Railway's Nixpacks auto-detection) gives us:
#   - ONE service, not one-per-workspace-package
#   - the EXACT pnpm version that made the lockfile (no version guessing → no LOCKFILE_CONFIG_MISMATCH)
#   - a build identical to local
FROM node:22-slim

# Exact pnpm version that generated pnpm-lock.yaml (overrides live in pnpm-workspace.yaml, pnpm 10+ style).
RUN corepack enable && corepack prepare pnpm@11.8.0 --activate

WORKDIR /app

# Copy the whole monorepo (a pnpm workspace install needs the lockfile + all package manifests).
# .dockerignore keeps node_modules/.env/.git out so we get a clean, correct-arch install.
COPY . .

# Install workspace deps against the frozen lockfile.
RUN pnpm install --frozen-lockfile

# Build the builder frontend (Vite → artifacts/app-builder/dist/public). BASE_PATH=/ so assets load
# from the domain root; PORT is only required because vite.config validates it at build time.
RUN NODE_ENV=production BASE_PATH=/ PORT=8080 pnpm --filter @workspace/app-builder run build

# Bundle the API server (esbuild → artifacts/api-server/dist). It also serves the frontend above.
RUN pnpm --filter @workspace/api-server run build

# Render/Railway inject PORT at runtime; the server reads process.env.PORT.
CMD ["node", "artifacts/api-server/dist/index.mjs"]
