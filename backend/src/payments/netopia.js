// src/payments/rails/netopia.js
const APP_ORIGIN =
  process.env.APP_ORIGIN ||
  process.env.FRONTEND_URL ||
  "http://localhost:5173";

const API_ORIGIN =
  process.env.API_ORIGIN ||
  process.env.BACKEND_URL ||
  "http://localhost:5000";

/**
 * MOCK: întoarce URL spre API-ul tău care face redirect spre FE.
 * De aici poți migra la integrarea reală Netopia: construiești payload,
 * semnezi, trimiți către mobilPay și primești URL / form pentru redirect.
 */
export async function startNetopia({ subscription, amountRON, description }) {
  // deocamdată ignorăm amountRON/description (mock only)
  const url = `${API_ORIGIN}/api/billing/checkout/netopia/start?subId=${encodeURIComponent(subscription.id)}`;
  return { url, provider: "netopia" };
}
