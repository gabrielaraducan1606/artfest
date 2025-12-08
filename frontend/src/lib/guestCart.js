// guestCart.js — coș local pentru utilizatorii neautentificați

const KEY = "guest_cart";

/* ===========================
   Helper — citește coșul
=========================== */
function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
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
   API compatibil Cart.jsx
=========================== */
export const guestCart = {
  /* -------------------------
     Adaugă cantitate la produs
  -------------------------- */
  add(productId, qty = 1) {
    const cart = load();
    cart[productId] = (cart[productId] || 0) + qty;
    save(cart);
  },

  /* -------------------------
     Setează cantitatea exactă
  -------------------------- */
  set(productId, qty) {
    const cart = load();

    if (qty <= 0) {
      delete cart[productId];
    } else {
      cart[productId] = qty;
    }

    save(cart);
  },

  /* -------------------------
     Alias NECESAR pentru Cart.jsx
     (Cart.jsx folosește guestCart.update)
  -------------------------- */
  update(productId, qty) {
    this.set(productId, qty);
  },

  /* -------------------------
     Elimină produs
  -------------------------- */
  remove(productId) {
    const cart = load();
    delete cart[productId];
    save(cart);
  },

  /* -------------------------
     Golește tot coșul
  -------------------------- */
  clear() {
    save({});
  },

  /* -------------------------
     Returnează obiect {productId: qty}
     (folosit intern, dar Cart.jsx nu îl cheamă direct)
  -------------------------- */
  getAll() {
    return load();
  },

  /* -------------------------
     Cantitatea unui produs
  -------------------------- */
  getQty(productId) {
    const cart = load();
    return cart[productId] || 0;
  },

  /* -------------------------
     🔥 METODĂ OBLIGATORIE pentru Cart.jsx:
     returnează listă de forma:
     [ { productId, qty }, ... ]
  -------------------------- */
  list() {
    const cart = load();
    return Object.entries(cart).map(([productId, qty]) => ({
      productId,
      qty,
    }));
  }
};
