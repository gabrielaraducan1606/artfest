// src/pages/ProductDetails/urlUtils.js
const BACKEND_BASE = (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");

const isHttp = (u = "") => /^https?:\/\//i.test(u);
const isDataOrBlob = (u = "") => /^(data|blob):/i.test(u);

export const resolveFileUrl = (u) => {
  if (!u) return "";
  if (isHttp(u) || isDataOrBlob(u)) return u;
  const path = u.startsWith("/") ? u : `/${u}`;
  return BACKEND_BASE ? `${BACKEND_BASE}${path}` : path;
};

export const withCache = (url, t) => {
  if (!url || !isHttp(url)) return url;
  return url.includes("?") ? `${url}&t=${t}` : `${url}?t=${t}`;
};
