# Single, deterministic production image for the Nebula API server.
# It serves the booking apps, published sites and every /api endpoint.
#
# Using a Dockerfile (instead of Railway's Nixpacks auto-detection) gives us:
#   - ONE service, not one-per-workspace-package
#   - the EXACT pnpm version that made the lockfile (no version guessing → no LOCKFILE_CONFIG_MISMATCH)
#   - a build identical to local
FROM node:22-slim

# Claude Code as the customer-facing website editor:
#   - build tools for node-pty (native pty bindings; prebuilds exist but this keeps the install robust),
#   - git (Claude Code likes it; harmless otherwise), procps (useradd/id come with base),
#   - the Claude Code CLI itself, global, so `claude` is on PATH for every terminal session.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ git ca-certificates procps \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g @anthropic-ai/claude-code

# Managed (root-owned) Claude Code policy: customers' sessions may only use file tools — no shell,
# no network — and file edits inside their workspace are auto-accepted. Users run as their own uid
# and cannot change this file. Mirrors SESSION_SETTINGS in api-server/src/lib/claude-terminal.ts.
RUN mkdir -p /etc/claude-code /nebula/home /nebula/ws \
 && printf '%s' '{"permissions":{"deny":["Bash","WebFetch","WebSearch","Agent","Task","NotebookEdit","KillShell","BashOutput","TaskOutput"],"defaultMode":"acceptEdits","disableBypassPermissionsMode":"disable"},"includeCoAuthoredBy":false}' > /etc/claude-code/managed-settings.json \
 && chmod 644 /etc/claude-code/managed-settings.json && chmod 755 /nebula /nebula/home /nebula/ws

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
# On boot we first sync the database schema (drizzle push) against the injected DATABASE_URL so new
# tables/columns exist before the app serves traffic — additive + idempotent, so re-deploys are safe.
# A push failure must NOT block startup (|| true); normally it's a quick no-op when already in sync.
CMD ["sh", "-c", "pnpm --filter @workspace/db run push-force || true; node artifacts/api-server/dist/index.mjs"]
