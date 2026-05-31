export const trackEvent = (eventName, params = {}) => {
  if (typeof window === "undefined") return;
  if (!window.gtag) return;

  window.gtag("event", eventName, params);
};

export const trackAddToCart = (product) => {
  trackEvent("add_to_cart", {
    currency: product?.currency || "RON",
    value: Number(product?.price || 0),
    items: [
      {
        item_id: product?.id,
        item_name: product?.title,
        price: Number(product?.price || 0),
        quantity: 1,
      },
    ],
  });
};

export const trackBeginCheckout = (total) => {
  trackEvent("begin_checkout", {
    currency: "RON",
    value: Number(total || 0),
  });
};

export const trackSignup = () => {
  trackEvent("sign_up", {
    method: "email",
  });
};

export const trackPurchase = (order) => {
  trackEvent("purchase", {
    transaction_id: order?.id,
    value: Number(order?.total || 0),
    currency: order?.currency || "RON",
  });
};