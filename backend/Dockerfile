# Contexto de construcción: raíz del repositorio (necesita los artefactos de /blockchain)
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app/blockchain
COPY blockchain/package*.json ./
RUN npm ci --legacy-peer-deps
COPY blockchain/ ./
RUN npx hardhat compile
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci
COPY backend/ ./
RUN npx prisma generate
EXPOSE 4000
# Migra, carga datos demo solo si la BD está vacía (despliega contratos) e inicia la API
CMD ["sh", "-c", "npx prisma migrate deploy && npx tsx prisma/seed.ts --if-empty && npx tsx src/server.ts"]
