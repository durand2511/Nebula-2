#!/bin/bash
set -a
source "$(dirname "$0")/.env"
set +a

export PORT=5173
export API_PORT=5001
export BASE_PATH=/
export NODE_ENV=development

# Start PostgreSQL
brew services start postgresql@14 2>/dev/null || brew services start postgresql 2>/dev/null

# Build and start api-server
echo "Starting api-server..."
cd "$(dirname "$0")/artifacts/api-server"
node ./build.mjs
PORT=$API_PORT node --enable-source-maps ./dist/index.mjs > /tmp/api-server.log 2>&1 &
echo "api-server PID: $!"

# Start app-builder (Vite)
echo "Starting app-builder..."
cd "$(dirname "$0")/artifacts/app-builder"
/usr/local/lib/node_modules/corepack/shims/pnpm vite --config vite.config.ts --host 0.0.0.0 > /tmp/app-builder.log 2>&1 &
echo "app-builder PID: $!"

echo ""
echo "App running at: http://localhost:5173"
echo "Logs: tail -f /tmp/api-server.log"
