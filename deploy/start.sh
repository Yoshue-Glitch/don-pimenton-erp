#!/bin/sh
# Arranque del contenedor todo-en-uno: Hardhat (red local) + API + Web.
# La red Hardhat vive en memoria: si el contenedor se reinicia, la API vuelve
# a desplegar los contratos (AUTO_DEPLOY_CONTRACTS=1). Los datos del ERP
# persisten en PostgreSQL.
set -e
APP=${APP_DIR:-/app}
CHAIN_PORT=${CHAIN_PORT:-8545}
API_PORT=${API_PORT:-4000}
export CHAIN_RPC_URL="http://127.0.0.1:${CHAIN_PORT}"
export CHAIN_ARTIFACTS_DIR="${APP}/blockchain/artifacts/contracts"
export CHAIN_DEPLOYMENT_FILE="${APP}/blockchain/deployments/none.json"
export UPLOAD_DIR="${UPLOAD_DIR:-${APP}/backend/uploads}"
export AUTO_DEPLOY_CONTRACTS=1

echo "[1/4] Iniciando red blockchain local (Hardhat) en :${CHAIN_PORT}"
cd "${APP}/blockchain" && ./node_modules/.bin/hardhat node --hostname 127.0.0.1 --port "${CHAIN_PORT}" > /tmp/hardhat.log 2>&1 &
node -e '
const url = process.env.CHAIN_RPC_URL;
let n = 0;
const ping = () => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) })
  .then(() => process.exit(0)).catch(() => (++n > 90 ? process.exit(1) : setTimeout(ping, 1000)));
ping();'

echo "[2/4] Migraciones y datos de demostración (solo si la base está vacía)"
cd "${APP}/backend" && ./node_modules/.bin/prisma migrate deploy && node dist/prisma/seed.js --if-empty

echo "[3/4] API en :${API_PORT}"
PORT="${API_PORT}" node dist/src/server.js &

echo "[4/4] Web en :${PORT:-3000}"
cd "${APP}/frontend" && exec ./node_modules/.bin/next start -H 0.0.0.0 -p "${PORT:-3000}"
