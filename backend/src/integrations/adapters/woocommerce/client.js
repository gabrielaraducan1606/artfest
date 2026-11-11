// backend/src/integrations/adapters/woocommerce/client.js
//
// Client pentru API-ul REST oficial WooCommerce (wc/v3).
//
// Autentificare: cheile REST ale magazinului (consumer key / secret),
// doar prin HTTPS. Implicit în antetul Authorization (Basic); unele
// servere elimină antetul - atunci authMode "query" le trimite ca
// parametri (tot prin HTTPS, conform documentației WooCommerce).
//
// Paginare: per_page (max 100) + antetele X-WP-Total / X-WP-TotalPages.
// Reîncercări: rețea, 429 (cu Retry-After) și 502/503/504, cu pauză
// crescătoare. 401/403/404 și răspunsurile care nu sunt JSON (ex. REST API
// dezactivat sau permalink-uri simple) NU se reîncearcă.

import { IntegrationError } from "../../core/errors.js";

const API_PREFIX = "/wp-json/wc/v3";
const RETRY_STATUSES = new Set([429, 502, 503, 504]);
export const WOO_MAX_PER_PAGE = 100;

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function retryAfterMs(response, attempt) {
  const header = Number(response?.headers?.get?.("retry-after"));
  if (Number.isFinite(header) && header > 0) return Math.min(header * 1000, 60_000);
  return Math.min(1000 * 2 ** attempt, 30_000);
}

/**
 * @param {Object} options
 * @param {string} options.shopUrl                adresa normalizată (connectionStore.normalizeShopUrl)
 * @param {string} options.consumerKey
 * @param {string} options.consumerSecret
 * @param {"basic"|"query"} [options.authMode]
 * @param {typeof fetch} [options.fetchImpl]
 */
export function createWooClient({
  shopUrl,
  consumerKey,
  consumerSecret,
  authMode = "basic",
  fetchImpl = globalThis.fetch,
  timeoutMs = 20_000,
  maxRetries = 3,
  sleep = defaultSleep,
}) {
  if (!consumerKey || !consumerSecret) {
    throw new IntegrationError("woocommerce_credentials_missing", "Lipsesc cheile API WooCommerce (consumer key / secret).");
  }
  const base = new URL(`${String(shopUrl).replace(/\/+$/, "")}${API_PREFIX}`);
  if (base.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(base.hostname)) {
    throw new IntegrationError("insecure_shop_url", "Conexiunea WooCommerce este permisă doar prin https://.");
  }
  const basicAuth = `Basic ${Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64")}`;

  function buildUrl(path, query = {}) {
    const url = new URL(`${base.href}${path}`);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    }
    if (authMode === "query") {
      url.searchParams.set("consumer_key", consumerKey);
      url.searchParams.set("consumer_secret", consumerSecret);
    }
    return url;
  }

  async function request(method, path, { query, body } = {}) {
    const url = buildUrl(path, query);
    const headers = { accept: "application/json" };
    if (authMode !== "query") headers.authorization = basicAuth;
    if (body !== undefined) headers["content-type"] = "application/json";

    for (let attempt = 0; ; attempt += 1) {
      let response;
      try {
        response = await fetchImpl(url, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
          redirect: "error",
        });
      } catch (error) {
        if (attempt < maxRetries) {
          await sleep(Math.min(1000 * 2 ** attempt, 30_000));
          continue;
        }
        throw new IntegrationError("woocommerce_unreachable", "Magazinul WooCommerce nu răspunde. Verifică adresa și încearcă din nou.", {
          status: 502,
          retryable: true,
          details: { reason: error?.name || "network" },
        });
      }

      if (RETRY_STATUSES.has(response.status) && attempt < maxRetries) {
        await sleep(retryAfterMs(response, attempt));
        continue;
      }

      const text = await response.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        throw new IntegrationError(
          "woocommerce_api_unavailable",
          "Magazinul nu a răspuns ca un API WooCommerce. Verifică adresa, permalink-urile și că API-ul REST este activ.",
          { status: 502, details: { httpStatus: response.status } }
        );
      }

      if (response.ok) return { data, headers: response.headers, status: response.status };

      const wooCode = data?.code || null;
      if (response.status === 401) {
        throw new IntegrationError("woocommerce_unauthorized", "Cheile API WooCommerce nu sunt valide.", {
          status: 401,
          details: { wooCode },
        });
      }
      if (response.status === 403) {
        throw new IntegrationError("woocommerce_forbidden", "Cheile API WooCommerce nu au permisiunile necesare.", {
          status: 403,
          details: { wooCode },
        });
      }
      if (response.status === 404) {
        throw new IntegrationError("woocommerce_not_found", "Resursa nu există în magazinul WooCommerce.", {
          status: 404,
          details: { wooCode, path },
        });
      }
      throw new IntegrationError("woocommerce_error", "Magazinul WooCommerce a răspuns cu o eroare.", {
        status: 502,
        retryable: RETRY_STATUSES.has(response.status) || response.status >= 500,
        details: { httpStatus: response.status, wooCode },
      });
    }
  }

  /** O pagină de rezultate + totalurile din antete. */
  async function getPage(path, { page = 1, perPage = WOO_MAX_PER_PAGE, query = {} } = {}) {
    const { data, headers } = await request("GET", path, {
      query: { ...query, page, per_page: Math.min(Math.max(1, perPage), WOO_MAX_PER_PAGE) },
    });
    return {
      items: Array.isArray(data) ? data : [],
      page,
      total: Number(headers.get("x-wp-total")) || 0,
      totalPages: Number(headers.get("x-wp-totalpages")) || 0,
    };
  }

  /** Toate paginile (ex. variațiile unui produs). */
  async function getAll(path, { perPage = WOO_MAX_PER_PAGE, query = {}, maxPages = 100 } = {}) {
    const items = [];
    for (let page = 1; page <= maxPages; page += 1) {
      const result = await getPage(path, { page, perPage, query });
      items.push(...result.items);
      if (!result.totalPages || page >= result.totalPages || !result.items.length) break;
    }
    return items;
  }

  return {
    get: (path, query) => request("GET", path, { query }).then((r) => r.data),
    put: (path, body) => request("PUT", path, { body }).then((r) => r.data),
    post: (path, body) => request("POST", path, { body }).then((r) => r.data),
    delete: (path, query) => request("DELETE", path, { query }).then((r) => r.data),
    getPage,
    getAll,
  };
}
