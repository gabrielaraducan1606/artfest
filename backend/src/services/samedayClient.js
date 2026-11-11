// LEGACY - nefolosit (audit pre-test Sameday 2026-10-31): singurul consumator,
// routes/samedayRoutes.js, nu mai e montat. Credentiale globale din env,
// SAMEDAY_BASE implicit = PRODUCȚIE, /api/client/lockers depreciat (PDF v3.6).
// Clientul activ e couriers/providers/sameday/client.js (per CourierAccount).
// Păstrat doar pentru referință - nu îl importa în cod nou.
import fetch from "node-fetch";
import { assertCourierAwbLiveEnabled } from "../couriers/awbLive.js";

const SAMEDAY_BASE = process.env.SAMEDAY_BASE || "https://api.sameday.ro";
const SAMEDAY_USERNAME = process.env.SAMEDAY_USERNAME;
const SAMEDAY_PASSWORD = process.env.SAMEDAY_PASSWORD;
const SAMEDAY_CLIENT_ID = process.env.SAMEDAY_CLIENT_ID;
const SAMEDAY_CLIENT_SECRET = process.env.SAMEDAY_CLIENT_SECRET;

let tokenCache = null;
let tokenExpires = 0;

async function getToken() {
  // BLOCAT (separarea DEMO / production, 2026-11-04): clientul legacy nu respectă
  // SAMEDAY_ACTIVE_ENVIRONMENT (implicit PRODUCȚIE) -> niciun apel, niciodată.
  // Clientul activ: couriers/providers/sameday/client.js.
  throw new Error("Clientul Sameday legacy este dezactivat.");
  // eslint-disable-next-line no-unreachable
  if (tokenCache && Date.now() < tokenExpires) return tokenCache;

  const resp = await fetch(`${SAMEDAY_BASE}/api/authenticate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: SAMEDAY_USERNAME,
      password: SAMEDAY_PASSWORD,
      client_id: SAMEDAY_CLIENT_ID,
      client_secret: SAMEDAY_CLIENT_SECRET,
    }),
  });
  if (!resp.ok) throw new Error(`Auth Sameday ${resp.status}`);
  const data = await resp.json();
  tokenCache = data.access_token;
  tokenExpires = Date.now() + (data.expires_in - 60) * 1000;
  return tokenCache;
}

async function samedayFetch(path, options = {}) {
  const token = await getToken();
  const res = await fetch(`${SAMEDAY_BASE}${path}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Sameday error ${res.status}: ${t}`);
  }
  return res.json();
}

export const samedayClient = {
  /** 📍 Tarife */
  async estimatePrice(payload) {
    return samedayFetch(`/api/shipments/estimate`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  /** 📦 AWB nou */
  async createAwb(payload) {
    assertCourierAwbLiveEnabled();
    return samedayFetch(`/api/shipments`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  /** 📬 Lockere disponibile */
  async getLockers() {
    return samedayFetch(`/api/lockers`, { method: "GET" });
  },

  /** 📍 Județe & localități */
  async getCounties() {
    return samedayFetch(`/api/geography/counties`, { method: "GET" });
  },
  async getLocalities(county) {
    return samedayFetch(`/api/geography/localities?county=${county}`, { method: "GET" });
  },
};

