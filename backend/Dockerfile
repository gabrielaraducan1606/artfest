# ---- Builder: instalează deps + generează Prisma Client
FROM node:20-slim AS builder
WORKDIR /app

# Instalează deps separat pentru cache mai bun
COPY backend/package*.json ./
RUN npm ci --omit=dev

# Copiază restul codului + prisma
COPY backend/ ./

# Generează Prisma Client (folosește schema din backend/prisma/schema.prisma)
RUN npx prisma generate

# ---- Runner minimal
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# Copiază node_modules și codul
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app ./

# Migrațiile le rulăm la start, apoi pornim serverul
# Pentru producție: folosește "migrate deploy" (idempotent)
CMD [ "bash", "-lc", "npx prisma migrate deploy && node server.js" ]
