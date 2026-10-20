# ---- Builder
FROM node:20-slim AS builder
WORKDIR /app

# Puppeteer (PDF: facturi, etichetele Târgului) descarcă Chrome la `npm ci`
# (postinstall). Implicit în ~/.cache/puppeteer = /root/.cache, ÎN AFARA /app,
# deci etapa runner (care copiază doar /app) rămânea fără Chrome:
# "Could not find Chrome (ver. ...)". Îl ținem în /app.
ENV PUPPETEER_CACHE_DIR=/app/.cache/puppeteer

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
# același director ca la build: aici caută Puppeteer Chrome la rulare
ENV PUPPETEER_CACHE_DIR=/app/.cache/puppeteer
EXPOSE 8080

# bibliotecile de sistem cerute de Chrome headless (lipsesc din imaginea slim)
# + fonturi cu diacritice românești pentru PDF-uri
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates fonts-dejavu-core fonts-liberation \
    libasound2 libatk-bridge2.0-0 libatk1.0-0 libatspi2.0-0 libcairo2 libcups2 libdbus-1-3 libdrm2 \
    libexpat1 libgbm1 libglib2.0-0 libnspr4 libnss3 libpango-1.0-0 libudev1 libx11-6 libxcb1 \
    libxcomposite1 libxdamage1 libxext6 libxfixes3 libxkbcommon0 libxrandr2 \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app ./

# rulează migrațiile (idempotent) și pornește serverul
CMD ["bash", "-lc", "npx prisma migrate deploy && node server.js"]
