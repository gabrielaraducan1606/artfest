// src/components/services/api.js
import axios from "axios";

/**
 * Dacă ai VITE_API_URL (ex: http://localhost:5000), îl folosim direct.
 * Altfel, folosim "/api" și lăsăm Vite să facă proxy către backend.
 */
const rawBase = (import.meta.env.VITE_API_URL || "").trim().replace(/\/+$/, "");
const baseURL = rawBase ? `${rawBase}/api` : "/api";

// Chei în storage
const LS_ACCESS = "authToken";

// Token în memorie (evită acces repetat la localStorage)
let inMemoryAccessToken = null;

export function getToken() {
  if (inMemoryAccessToken) return inMemoryAccessToken;
  const t = localStorage.getItem(LS_ACCESS);
  if (t) inMemoryAccessToken = t;
  return inMemoryAccessToken;
}

export function setToken(token, persist = true) {
  inMemoryAccessToken = token || null;
  if (persist) {
    if (token) localStorage.setItem(LS_ACCESS, token);
    else localStorage.removeItem(LS_ACCESS);
  } else {
    localStorage.removeItem(LS_ACCESS);
  }
}

export function clearToken() {
  inMemoryAccessToken = null;
  localStorage.removeItem(LS_ACCESS);
}

/** Instanță Axios comună */
const api = axios.create({
  baseURL,
  timeout: 15000,
  withCredentials: true, // safe dacă vei folosi cookie-uri în viitor
});

/** Atașează automat Bearer token dacă există */
api.interceptors.request.use((config) => {
  const t = getToken();
  if (t) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${t}`;
  }
  return config;
});

/** Pe 401: curăță tokenul și du-te la /login (o singură dată pe ciclu) */
let handling401 = false;
api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const status = error?.response?.status;
    if (status === 401 && !handling401) {
      handling401 = true;
      try {
        clearToken();
      } finally {
        handling401 = false;
        if (window.location.pathname !== "/login") {
          window.location.replace("/login");
        }
      }
    }
    return Promise.reject(error);
  },
);

export default api;
