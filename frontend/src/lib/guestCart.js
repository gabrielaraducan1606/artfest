// Coșul vizitatorului în localStorage: { items: [{ productId, qty }] }
const KEY = "guest_cart_v1";

// clamp helper
const clampQty = (n) => Math.max(1, Math.min(99, Number(n) || 1));

function notify() {
  try {
    window.dispatchEvent(new CustomEvent("cart:changed"));
  } catch { /* ignore */ }
}

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { items: [] };
    const parsed = JSON.parse(raw);
    const items = Array.isArray(parsed.items) ? parsed.items : [];
    // normalizăm & clamp
    const norm = items
      .map((x) => ({
        productId: String(x.productId || "").trim(),
        qty: clampQty(x.qty),
      }))
      .filter((x) => x.productId);
    return { items: norm };
  } catch {
    return { items: [] };
  }
}

function write(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch { /* ignore */ }
}

export const guestCart = {
  list() {
    return read().items;
  },

  count() {
    return read().items.reduce((s, x) => s + Number(x.qty || 0), 0);
  },

  add(productId, qty = 1) {
    const state = read();
    const pid = String(productId || "").trim();
    if (!pid) return state.items;

    const addQty = clampQty(qty);
    const i = state.items.findIndex((x) => x.productId === pid);
    if (i >= 0) {
      state.items[i].qty = clampQty((state.items[i].qty || 0) + addQty);
    } else {
      state.items.push({ productId: pid, qty: addQty });
    }
    write(state);
    notify();
    return state.items;
  },

  update(productId, qty) {
    const state = read();
    const pid = String(productId || "").trim();
    if (!pid) return state.items;

    const newQty = clampQty(qty);
    const i = state.items.findIndex((x) => x.productId === pid);
    if (i >= 0) {
      state.items[i].qty = newQty;
    } else {
      state.items.push({ productId: pid, qty: newQty });
    }
    write(state);
    notify();
    return state.items;
  },

  remove(productId) {
    const state = read();
    const pid = String(productId || "").trim();
    state.items = state.items.filter((x) => x.productId !== pid);
    write(state);
    notify();
    return state.items;
  },

  clear() {
    write({ items: [] });
    notify();
  },
};
