# ---- Builder
FROM node:20-slim AS builder
WORKDIR /app

# fișierele sunt deja în contextul backend/
COPY package*.json ./
RUN npm ci --omit=dev

COPY . .
RUN npx prisma generate

# ---- Runner
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app ./

# rulează migrațiile (idempotent) și pornește serverul
CMD ["bash", "-lc", "npx prisma migrate deploy && node server.js"]
