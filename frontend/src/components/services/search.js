import api from "./api";

// Sugestii (deja le folosești în useAutosuggest)
export async function getSuggestions(q, signal) {
  const { data } = await api.get("/search/suggestions", { params: { q }, signal });
  return data; // [{ id, value, label, parts? }]
}

// Rezultatele de căutare
export async function searchAll({ q, page = 1, limit = 24, sort = "relevance" }, signal) {
  const { data } = await api.get("/search", {
    params: { q, page, limit, sort },
    signal,
  });
  // așteptăm un răspuns de forma:
  // { items: [{ id, type: 'product'|'shop', title, image, price, slug }], total, page, pages }
  return data;
}
