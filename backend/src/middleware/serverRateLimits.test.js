// Limitatoarele globale din server.js: cheia corectă (IP-ul clientului, nu
// obiectul req), modul observe implicit (fără blocare), enforce per IP,
// login per email ca protecția efectivă de până acum.
//
// Rulare: node --test src/middleware/serverRateLimits.test.js

import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";

import {
  createIpModeLimiter,
  createServerRateLimiters,
  loginRateLimitKey,
  rateLimitIpKey,
  resolveIpLimitMode,
} from "./serverRateLimits.js";

const quietLogger = { warn() {}, info() {}, error() {} };

async function withApp(middlewares, fn) {
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  app.use("/api", ...middlewares);
  app.all("/api/*splat", (_req, res) => res.json({ ok: true }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const hit = (base, ip, path = "/api/x", init = {}) =>
  fetch(`${base}${path}`, { ...init, headers: { "x-forwarded-for": ip, ...(init.headers || {}) } });

test("modul implicit este observe; valori necunoscute => observe", () => {
  assert.equal(resolveIpLimitMode(undefined), "observe");
  assert.equal(resolveIpLimitMode("ENFORCE"), "enforce");
  assert.equal(resolveIpLimitMode("off"), "off");
  assert.equal(resolveIpLimitMode("orice"), "observe");
});

test("cheia IP e stringul IP (nu req), IPv6 grupat pe /56", () => {
  assert.equal(rateLimitIpKey({ ip: "203.0.113.5" }), "203.0.113.5");
  assert.equal(rateLimitIpKey({ ip: "::ffff:203.0.113.5" }), "203.0.113.5");
  assert.equal(
    rateLimitIpKey({ ip: "2001:db8:abcd:12ff::1" }),
    rateLimitIpKey({ ip: "2001:db8:abcd:1200::9" })
  );
  assert.notEqual(rateLimitIpKey({ ip: "203.0.113.5" }), rateLimitIpKey({ ip: "203.0.113.6" }));
});

test("login: cheie per email (normalizat), fără email => IP", () => {
  assert.equal(loginRateLimitKey({ ip: "1.2.3.4", body: { email: " Ana@Example.com " } }), "email:ana@example.com");
  assert.equal(loginRateLimitKey({ ip: "1.2.3.4", body: {} }), "ip:1.2.3.4");
});

test("enforce: același IP e blocat după limită, alt IP nu", async () => {
  const limiter = createIpModeLimiter({ name: "t", windowMs: 60_000, max: 3, mode: "enforce", logger: quietLogger });
  await withApp([limiter], async (base) => {
    for (let i = 0; i < 3; i += 1) assert.equal((await hit(base, "198.51.100.1")).status, 200);
    const blocked = await hit(base, "198.51.100.1");
    assert.equal(blocked.status, 429);
    assert.equal((await blocked.json()).error, "rate_limited");
    assert.equal((await hit(base, "198.51.100.2")).status, 200);
  });
});

test("observe (implicit): limita e numărată și jurnalizată, dar nu blochează", async () => {
  const warnings = [];
  const logger = { ...quietLogger, warn: (...a) => warnings.push(a) };
  const limiter = createIpModeLimiter({ name: "t", windowMs: 60_000, max: 2, mode: "observe", logger });
  await withApp([limiter], async (base) => {
    for (let i = 0; i < 5; i += 1) assert.equal((await hit(base, "198.51.100.1")).status, 200);
  });
  assert.equal(warnings.length, 1, "un singur avertisment pe minut");
  assert.match(warnings[0][0], /would block/);
  assert.equal(JSON.stringify(warnings).includes("198.51.100.1"), false, "fără IP în jurnal");
});

test("off: nu numără și nu blochează", async () => {
  const limiter = createIpModeLimiter({ name: "t", windowMs: 60_000, max: 1, mode: "off", logger: quietLogger });
  await withApp([limiter], async (base) => {
    for (let i = 0; i < 3; i += 1) assert.equal((await hit(base, "198.51.100.1")).status, 200);
  });
});

test("createServerRateLimiters: login blocat per email (20 / 10 min implicit), alt email trece", async () => {
  const { authLoginLimiter, mode } = createServerRateLimiters({ env: { RATE_AUTH_LOGIN_MAX: "2" }, logger: quietLogger });
  assert.equal(mode, "observe");
  await withApp([authLoginLimiter], async (base) => {
    const login = (ip, email) =>
      hit(base, ip, "/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
    assert.equal((await login("198.51.100.1", "a@example.com")).status, 200);
    assert.equal((await login("198.51.100.9", "A@example.com")).status, 200);
    assert.equal((await login("198.51.100.7", "a@example.com")).status, 429, "același email, alt IP: protecția per email rămâne");
    assert.equal((await login("198.51.100.1", "b@example.com")).status, 200);
  });
});

test("createServerRateLimiters: în observe, /api nu blochează nici peste limită", async () => {
  const { apiChain } = createServerRateLimiters({ env: { RATE_API_MAX: "2" }, logger: quietLogger });
  await withApp(apiChain, async (base) => {
    for (let i = 0; i < 4; i += 1) assert.equal((await hit(base, "198.51.100.1")).status, 200);
  });
});

test("createServerRateLimiters: RATE_LIMIT_IP_MODE=enforce blochează /api per IP", async () => {
  const { apiChain, mode } = createServerRateLimiters({
    env: { RATE_API_MAX: "2", RATE_LIMIT_IP_MODE: "enforce" },
    logger: quietLogger,
  });
  assert.equal(mode, "enforce");
  await withApp(apiChain, async (base) => {
    assert.equal((await hit(base, "198.51.100.1")).status, 200);
    assert.equal((await hit(base, "198.51.100.1")).status, 200);
    assert.equal((await hit(base, "198.51.100.1")).status, 429);
    assert.equal((await hit(base, "198.51.100.3")).status, 200);
  });
});
