const GUEST_CART_KEY = "artfest_guest_cart";
const MAX_QTY = 99;

function clampQty(value) {
  const parsed = Number.parseInt(value, 10) || 1;

  return Math.max(
    1,
    Math.min(MAX_QTY, parsed)
  );
}

/*
 * Oglindă a normalizeCartData() din backend/src/routes/cartRoutes.js -
 * trim string-uri, elimină câmpuri goale/null/undefined, SORTEAZĂ
 * cheile determinist (altfel {color,size} vs {size,color}, aceeași
 * configurație, ar produce chei diferite).
 */
function normalizeConfigValue(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .map(([key, itemValue]) => [
        String(key || "").trim(),
        typeof itemValue === "string"
          ? itemValue.trim()
          : itemValue,
      ])
      .filter(([key, itemValue]) => {
        if (!key) return false;
        if (itemValue === undefined || itemValue === null) return false;
        if (typeof itemValue === "string" && itemValue.length === 0) {
          return false;
        }
        return true;
      })
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  );
}

/*
 * Identitatea unei linii din coșul guest - echivalentul client-side al
 * buildConfigurationKey() din backend (nu are nevoie de hash, doar de
 * un string determinist și STABIL pentru aceeași configurație).
 */
export function buildGuestConfigurationKey(
  selectedOptions,
  customAnswers,
  repeatedGroupAnswers
) {
  return JSON.stringify({
    selectedOptions: normalizeConfigValue(selectedOptions),
    customAnswers: normalizeConfigValue(customAnswers),
    repeatedGroupAnswers: normalizeConfigValue(repeatedGroupAnswers),
  });
}

export function getGuestCart() {
  try {
    const raw = localStorage.getItem(
      GUEST_CART_KEY
    );

    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((item) => ({
  productId: String(item?.productId || "").trim(),
  qty: clampQty(item?.qty),

  selectedOptions:
    item?.selectedOptions &&
    typeof item.selectedOptions === "object"
      ? item.selectedOptions
      : {},

  customAnswers:
    item?.customAnswers &&
    typeof item.customAnswers === "object"
      ? item.customAnswers
      : {},

  repeatedGroupAnswers:
    item?.repeatedGroupAnswers &&
    typeof item.repeatedGroupAnswers === "object"
      ? item.repeatedGroupAnswers
      : {},

  configurationKey:
    typeof item?.configurationKey === "string"
      ? item.configurationKey
      : "default",
}))
      .filter((item) => item.productId);
  } catch (error) {
    console.error(
      "Nu am putut citi coșul guest:",
      error
    );

    return [];
  }
}

export function saveGuestCart(items) {
  const safeItems = Array.isArray(items)
    ? items
        .map((item) => ({
  productId: String(item?.productId || "").trim(),
  qty: clampQty(item?.qty),

selectedOptions:
  item?.selectedOptions &&
  typeof item.selectedOptions === "object" &&
  !Array.isArray(item.selectedOptions)
    ? item.selectedOptions
    : {},

customAnswers:
  item?.customAnswers &&
  typeof item.customAnswers === "object" &&
  !Array.isArray(item.customAnswers)
    ? item.customAnswers
    : {},

repeatedGroupAnswers:
  item?.repeatedGroupAnswers &&
  typeof item.repeatedGroupAnswers === "object" &&
  !Array.isArray(item.repeatedGroupAnswers)
    ? item.repeatedGroupAnswers
    : {},
  configurationKey:
    item?.configurationKey || "default",
}))
        .filter((item) => item.productId)
    : [];

  localStorage.setItem(
    GUEST_CART_KEY,
    JSON.stringify(safeItems)
  );

  try {
    window.dispatchEvent(
      new CustomEvent("guest-cart-updated", {
        detail: {
          items: safeItems,
          count: safeItems.reduce(
            (sum, item) =>
              sum + Number(item.qty || 0),
            0
          ),
        },
      })
    );

    window.dispatchEvent(
      new CustomEvent("cart:changed")
    );
  } catch {
    // Ignorăm dacă browserul nu suportă CustomEvent.
  }

  return safeItems;
}

export function addToGuestCart(
  productId,
  qty = 1,
  configuration = {}
) {
  const id = String(
    productId || ""
  ).trim();

  if (!id) {
    throw new Error(
      "productId_required"
    );
  }

  const safeQty = clampQty(qty);
  const cart = getGuestCart();
const safeConfiguration =
  configuration &&
  typeof configuration === "object" &&
  !Array.isArray(configuration)
    ? configuration
    : {};

  /*
   * Identitatea reală a liniei - calculată din selectedOptions/
   * customAnswers/repeatedGroupAnswers, NU doar productId. Dacă
   * apelantul trimite deja un configurationKey explicit (rar), îl
   * respectăm; altfel îl calculăm determinist aici.
   */
  const configurationKey =
    typeof safeConfiguration.configurationKey === "string" &&
    safeConfiguration.configurationKey
      ? safeConfiguration.configurationKey
      : buildGuestConfigurationKey(
          safeConfiguration.selectedOptions,
          safeConfiguration.customAnswers,
          safeConfiguration.repeatedGroupAnswers
        );

  const existingIndex =
    cart.findIndex(
      (item) =>
        item.productId === id &&
        (item.configurationKey || "default") === configurationKey
    );

  if (existingIndex >= 0) {
    /*
     * Aceeași configurație (productId + configurationKey identice) -
     * doar cantitatea crește. selectedOptions/customAnswers/
     * repeatedGroupAnswers rămân neschimbate (sunt deja identice,
     * altfel configurationKey ar fi fost diferit).
     */
    cart[existingIndex] = {
  ...cart[existingIndex],

  qty: Math.min(
    MAX_QTY,
    Number(cart[existingIndex].qty || 0) + safeQty
  ),
};
  } else {
 cart.push({
  productId: id,
  qty: safeQty,

  selectedOptions:
    safeConfiguration.selectedOptions || {},

  customAnswers:
    safeConfiguration.customAnswers || {},

  repeatedGroupAnswers:
    safeConfiguration.repeatedGroupAnswers || {},

  configurationKey,
});
  }

  return saveGuestCart(cart);
}

export function updateGuestCartItem(
  productId,
  configurationKey,
  qty
) {
  const id = String(
    productId || ""
  ).trim();

  if (!id) {
    throw new Error(
      "productId_required"
    );
  }

  const key = configurationKey || "default";
  const safeQty = clampQty(qty);

  const updated = getGuestCart().map(
    (item) =>
      item.productId === id &&
      (item.configurationKey || "default") === key
        ? {
            ...item,
            qty: safeQty,
          }
        : item
  );

  return saveGuestCart(updated);
}

export function removeFromGuestCart(
  productId,
  configurationKey
) {
  const id = String(
    productId || ""
  ).trim();

  const key = configurationKey || "default";

  const updated = getGuestCart().filter(
    (item) =>
      !(
        item.productId === id &&
        (item.configurationKey || "default") === key
      )
  );

  return saveGuestCart(updated);
}

export function removeBatchFromGuestCart(
  productIds = []
) {
  const ids = new Set(
    productIds
      .map((id) =>
        String(id || "").trim()
      )
      .filter(Boolean)
  );

  const updated = getGuestCart().filter(
    (item) =>
      !ids.has(item.productId)
  );

  return saveGuestCart(updated);
}

export function clearGuestCart() {
  localStorage.removeItem(
    GUEST_CART_KEY
  );

  try {
    window.dispatchEvent(
      new CustomEvent("guest-cart-updated", {
        detail: {
          items: [],
          count: 0,
        },
      })
    );

    window.dispatchEvent(
      new CustomEvent("cart:changed")
    );
  } catch {
    // Ignorăm dacă browserul nu suportă CustomEvent.
  }
}
export function getGuestCartCount() {
  return getGuestCart().length;
}

export function hasGuestCartItems() {
  return getGuestCart().length > 0;
}