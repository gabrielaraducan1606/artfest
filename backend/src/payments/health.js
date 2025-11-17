// src/payments/health.js
let lastStripeOk = true;
let lastNetopiaOk = true;

// În producție poți verifica endpoint-uri reale sau statistici de erori.
export async function isStripeHealthy()  { return lastStripeOk; }
export async function isNetopiaHealthy() { return lastNetopiaOk; }

// Hook-uri pentru debug/admin/cron
export function setStripeHealth(ok)  { lastStripeOk  = !!ok; }
export function setNetopiaHealth(ok) { lastNetopiaOk = !!ok; }
