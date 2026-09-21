FROM node:22-alpine
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production COOKIE_SECURE=true
# Migrations and the (idempotent) demo data run on every start, then the server. PORT is provided by the platform.
CMD ["sh", "-c", "node --import tsx scripts/migrate.ts && node --import tsx scripts/seed.ts && exec node --import tsx src/server/index.ts"]
