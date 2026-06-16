export const GOOGLE_ADS_PURCHASE_CONVERSION_ID =
  "AW-18196187164/MUkKCJu2u7YcEJyQz-RD";

function pushToDataLayer(eventName, params = {}) {
  if (typeof window === "undefined") return;

  window.dataLayer = window.dataLayer || [];

  window.dataLayer.push({
    event: eventName,
    ...params,
  });
}

export const trackEvent = (eventName, params = {}) => {
  if (typeof window === "undefined") return;

  // Dacă există gtag, trimitem direct către GA4 / Ads
  if (typeof window.gtag === "function") {
    window.gtag("event", eventName, params);
    return;
  }

  // Dacă site-ul folosește GTM, trimitem în dataLayer
  pushToDataLayer(eventName, params);
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
  const value = Number(order?.total || 0);
  const currency = order?.currency || "RON";
  const transactionId = order?.id || "";

  trackEvent("purchase", {
    transaction_id: transactionId,
    value,
    currency,
  });

  trackEvent("conversion", {
    send_to: GOOGLE_ADS_PURCHASE_CONVERSION_ID,
    value,
    currency,
    transaction_id: transactionId,
  });
};