// src/scripts/cardPaymentExpiryCheck.mjs
//
// Verificare FĂRĂ MODIFICĂRI a expirării comenzilor CARD neplătite: ce
// comenzi ar expira acum și ce ar fi amânat (plată reușită / în curs).
// Doar citiri - în DB și în Stripe (listare sesiuni, PaymentIntent-uri);
// nicio sesiune expirată, niciun stoc atins, niciun email.
//
// Rulare (din backend/):
//   node src/scripts/cardPaymentExpiryCheck.mjs --start-at=2026-11-01T00:00:00Z

import "dotenv/config";
import { cardPaymentExpiryConfig, runCardPaymentExpiryJob } from "../services/cardPaymentExpiry.js";
import { prisma } from "../db.js";

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const startAt = arg("start-at") || process.env.CARD_PAYMENT_EXPIRY_START_AT;

const config = {
  ...cardPaymentExpiryConfig({ ...process.env, CARD_PAYMENT_EXPIRY_START_AT: startAt || "" }),
  dryRun: true,
};

if (!config.startAt) {
  console.error("Lipsește --start-at=<dată ISO> (comenzile plasate de atunci).");
  process.exit(1);
}

try {
  const { results } = await runCardPaymentExpiryJob({ config, dryRun: true });
  for (const r of results) console.log(`${r.result.padEnd(12)} ${r.orderId}${r.reason ? ` (${r.reason})` : ""}`);
} finally {
  await prisma.$disconnect();
}
