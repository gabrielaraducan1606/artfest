// backend/src/services/sameday.js
import fetch from "node-fetch";

const SAMEDAY_BASE = process.env.SAMEDAY_API_BASE || "https://api.sameday.ro"; // exemplu
const SAMEDAY_KEY = process.env.SAMEDAY_API_KEY || "";
const SAMEDAY_CLIENT = process.env.SAMEDAY_CLIENT || "";
const CURRENCY = "RON";

// === DEMO: quote simplu (flat) ===
// Înlocuiește cu apelurile reale către Sameday (tarifare, servicii, locker).
export async function samedayQuote({ method, to, items, lockerId }) {
  const base = method === "locker" ? 9.99 : 17.99;
  const count = items.reduce((s,i)=>s + Number(i.qty||0), 0);
  const extra = Math.max(0, count - 1) * 2.0; // 2 RON per colet suplimentar
  return { price: Number((base + extra).toFixed(2)), currency: CURRENCY };
}

// === AWB creation (de apelat la fulfilment, nu la checkout) ===
export async function samedayCreateAwb({ shipment, address }) {
  // Exemplu: trimite datele minime: destinatar, telefon, adresă
  // return { awb: "SDY123456789", labelUrl: "..." };

  if (!SAMEDAY_KEY) {
    // sandbox/stub
    return { awb: `SDY-${Date.now()}`, labelUrl: null };
  }

  // TODO: integră efectiv API-ul Sameday aici, cu autentificare & body conform documentației
  // const resp = await fetch(`${SAMEDAY_BASE}/awbs`, { ... });
  // const data = await resp.json();

  return { awb: `SDY-${Date.now()}`, labelUrl: null };
}
