FROM node:22-slim
WORKDIR /app
ARG API_URL=http://api:4000
ENV API_URL=$API_URL NEXT_TELEMETRY_DISABLED=1
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx next build
EXPOSE 3000
CMD ["npx", "next", "start", "-p", "3000"]
