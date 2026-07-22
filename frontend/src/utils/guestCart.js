const GUEST_CART_KEY = "artfest_guest_cart";
const MAX_QTY = 99;

function clampQty(value) {
  const parsed = Number.parseInt(value, 10) || 1;

  return Math.max(
    1,
    Math.min(MAX_QTY, parsed)
  );
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
  const existingIndex =
    cart.findIndex(
      (item) =>
        item.productId === id
    );

  if (existingIndex >= 0) {
    cart[existingIndex] = {
  ...cart[existingIndex],

  qty: Math.min(
    MAX_QTY,
    Number(cart[existingIndex].qty || 0) + safeQty
  ),

  selectedOptions:
    safeConfiguration.selectedOptions ||
    cart[existingIndex].selectedOptions ||
    {},

  customAnswers:
    safeConfiguration.customAnswers ||
    cart[existingIndex].customAnswers ||
    {},

  configurationKey:
    safeConfiguration.configurationKey ||
    cart[existingIndex].configurationKey ||
    "default",
};
  } else {
 cart.push({
  productId: id,
  qty: safeQty,

  selectedOptions:
    safeConfiguration.selectedOptions || {},

  customAnswers:
    safeConfiguration.customAnswers || {},

  configurationKey:
    safeConfiguration.configurationKey || "default",
});
  }

  return saveGuestCart(cart);
}

export function updateGuestCartItem(
  productId,
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

  const safeQty = clampQty(qty);

  const updated = getGuestCart().map(
    (item) =>
      item.productId === id
        ? {
            ...item,
            qty: safeQty,
          }
        : item
  );

  return saveGuestCart(updated);
}

export function removeFromGuestCart(
  productId
) {
  const id = String(
    productId || ""
  ).trim();

  const updated = getGuestCart().filter(
    (item) =>
      item.productId !== id
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