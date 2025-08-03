import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

// Chei în storage
const LS_ACCESS = 'authToken';

// Token în memorie (mai sigur decât să citești mereu din LS)
let inMemoryAccessToken = null;

export function getToken() {
  if (inMemoryAccessToken) return inMemoryAccessToken;
  const t = localStorage.getItem(LS_ACCESS);
  if (t) inMemoryAccessToken = t;
  return inMemoryAccessToken;
}
export function setToken(token, persist = true) {
  inMemoryAccessToken = token;
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

const api = axios.create({ baseURL: `${API_BASE_URL}/api` });

// Atașează automat Bearer dacă există token
api.interceptors.request.use((config) => {
  const t = getToken();
  if (t) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${t}`;
  }
  return config;
});

// Pe 401: curățăm tokenul și redirecționăm la /login (o singură dată pe ciclu)
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
        // redirect soft pentru a nu păstra state-uri ciudate
        if (window.location.pathname !== '/login') {
          window.location.replace('/login');
        }
      }
    }
    return Promise.reject(error);
  }
);

export default api;