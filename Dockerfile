# Imagen todo-en-uno para publicar la demo (p. ej. en Render): Hardhat + API + Web.
# La base de datos PostgreSQL es externa (variable DATABASE_URL).
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

COPY blockchain/package*.json blockchain/
RUN cd blockchain && npm ci --legacy-peer-deps
COPY backend/package*.json backend/
RUN cd backend && npm ci
COPY frontend/package*.json frontend/
RUN cd frontend && npm ci

COPY blockchain blockchain
RUN cd blockchain && npx hardhat compile
COPY backend backend
RUN cd backend && rm -f .env && npx prisma generate && npm run build
COPY frontend frontend
ARG API_URL=http://127.0.0.1:4000
RUN cd frontend && API_URL=$API_URL npx next build
COPY deploy deploy

ENV NODE_ENV=production PORT=3000
EXPOSE 3000
CMD ["sh", "/app/deploy/start.sh"]
