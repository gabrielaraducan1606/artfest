// guestCart.js — coș local pentru utilizatorii neautentificați

const KEY = "guest_cart";

/* ===========================
   Helper — normalizează obiecte
=========================== */
function normalizeObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value;
}

/* ===========================
   Helper — citește coșul
=========================== */
function load() {
  try {
    const raw = localStorage.getItem(KEY);

    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);

    /*
     * Format nou:
     * [
     *   {
     *     productId,
     *     qty,
     *     selectedOptions,
     *     customAnswers,
     *     configurationKey
     *   }
     * ]
     */
    if (Array.isArray(parsed)) {
      return parsed
        .filter((item) => item && item.productId)
        .map((item) => ({
          productId: String(item.productId),
          qty: Math.max(1, Number.parseInt(item.qty, 10) || 1),
          selectedOptions: normalizeObject(item.selectedOptions),
          customAnswers: normalizeObject(item.customAnswers),
          configurationKey: item.configurationKey || "default",
        }));
    }

    /*
     * Migrare automată din formatul vechi:
     * {
     *   productId: qty
     * }
     */
    if (parsed && typeof parsed === "object") {
      return Object.entries(parsed)
        .filter(([productId]) => productId)
        .map(([productId, qty]) => ({
          productId,
          qty: Math.max(1, Number.parseInt(qty, 10) || 1),
          selectedOptions: {},
          customAnswers: {},
          configurationKey: "default",
        }));
    }

    return [];
  } catch {
    return [];
  }
}

/* ===========================
   Helper — scrie coșul
=========================== */
function save(cart) {
  try {
    localStorage.setItem(KEY, JSON.stringify(cart));
  } catch {
    /* ignorăm erorile de storage */
  }
}

/* ===========================
   Helper — normalizează qty
=========================== */
function normalizeQty(qty) {
  const parsed = Number.parseInt(qty, 10);

  if (!Number.isFinite(parsed)) {
    return 1;
  }

  return Math.min(99, Math.max(0, parsed));
}

/* ===========================
   API compatibil Cart.jsx
=========================== */
export const guestCart = {
  /* -------------------------
     Adaugă produs/configurație
  -------------------------- */
  add(
    productId,
    qty = 1,
    {
      selectedOptions = {},
      customAnswers = {},
      configurationKey = "default",
    } = {}
  ) {
    const cart = load();
    const normalizedQty = Math.max(1, normalizeQty(qty));
    const normalizedKey = configurationKey || "default";

    const existing = cart.find(
      (item) =>
        item.productId === String(productId) &&
        item.configurationKey === normalizedKey
    );

    if (existing) {
      existing.qty = Math.min(99, existing.qty + normalizedQty);
    } else {
      cart.push({
        productId: String(productId),
        qty: normalizedQty,
        selectedOptions: normalizeObject(selectedOptions),
        customAnswers: normalizeObject(customAnswers),
        configurationKey: normalizedKey,
      });
    }

    save(cart);
  },

  /* -------------------------
     Setează cantitatea exactă
  -------------------------- */
  set(productId, configurationKey = "default", qty) {
    const cart = load();
    const normalizedKey = configurationKey || "default";
    const normalizedQty = normalizeQty(qty);

    const index = cart.findIndex(
      (item) =>
        item.productId === String(productId) &&
        item.configurationKey === normalizedKey
    );

    if (index === -1) {
      return;
    }

    if (normalizedQty <= 0) {
      cart.splice(index, 1);
    } else {
      cart[index].qty = normalizedQty;
    }

    save(cart);
  },

  /* -------------------------
     Alias pentru Cart.jsx
  -------------------------- */
  update(productId, configurationKey = "default", qty) {
    this.set(productId, configurationKey, qty);
  },

  /* -------------------------
     Elimină o configurație
  -------------------------- */
  remove(productId, configurationKey = "default") {
    const cart = load();
    const normalizedKey = configurationKey || "default";

    const nextCart = cart.filter(
      (item) =>
        !(
          item.productId === String(productId) &&
          item.configurationKey === normalizedKey
        )
    );

    save(nextCart);
  },

  /* -------------------------
     Elimină toate configurațiile
     unui produs
  -------------------------- */
  removeProduct(productId) {
    const cart = load();

    const nextCart = cart.filter(
      (item) => item.productId !== String(productId)
    );

    save(nextCart);
  },

  /* -------------------------
     Golește tot coșul
  -------------------------- */
  clear() {
    save([]);
  },

  /* -------------------------
     Returnează lista completă
  -------------------------- */
  getAll() {
    return load();
  },

  /* -------------------------
     Cantitatea unei configurații
  -------------------------- */
  getQty(productId, configurationKey = "default") {
    const cart = load();
    const normalizedKey = configurationKey || "default";

    const item = cart.find(
      (entry) =>
        entry.productId === String(productId) &&
        entry.configurationKey === normalizedKey
    );

    return item?.qty || 0;
  },

  /* -------------------------
     Cantitatea totală a produsului,
     indiferent de configurație
  -------------------------- */
  getProductQty(productId) {
    return load()
      .filter((item) => item.productId === String(productId))
      .reduce((sum, item) => sum + Number(item.qty || 0), 0);
  },

  /* -------------------------
     Returnează lista pentru API
  -------------------------- */
  list() {
    return load();
  },
};