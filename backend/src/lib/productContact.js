// backend/src/lib/productContact.js
//
// „Întreabă vânzătorul” din pagina produsului: reguli comune pentru ruta
// /api/product-contact, inbox (vânzător + client) și scutirea de cotă lunară
// pentru sesizările de siguranță. Funcțiile primesc clientul DB ca parametru
// (testabile cu o bază simulată).

export const CONTACT_REASONS = Object.freeze({
  SAFETY: "SAFETY",
  MATERIALS: "MATERIALS",
  OTHER: "OTHER",
});

export const CONTACT_REASON_LABELS = Object.freeze({
  SAFETY: "Siguranța produsului",
  MATERIALS: "Materiale și întreținere",
  OTHER: "Altă întrebare",
});

export const PRODUCT_CONTACT_MESSAGE_MIN = 5;
export const PRODUCT_CONTACT_MESSAGE_MAX = 2000;

/*
 * Limite anti-spam, numărate în baza de date (limitatoarele express din
 * server.js nu se aplică aici în mod fiabil).
 */
export const PRODUCT_CONTACT_LIMITS = Object.freeze({
  newThreadsPerHour: 5,
  newThreadsPerDay: 20,
  messagesPer10Min: 10,
  artfestOnlyPerHour: 5,
});

export const SAFETY_TICKET_CATEGORY = "product_safety";

export function normalizeContactReason(raw) {
  const value = String(raw || "").trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(CONTACT_REASONS, value) ? value : null;
}

export function contactReasonLabel(reason) {
  return CONTACT_REASON_LABELS[reason] || null;
}

export function isSafetyReason(reason) {
  return reason === CONTACT_REASONS.SAFETY;
}

/* Produs vizibil public: aceleași condiții ca pagina publică a produsului. */
export function publicProductWhere(productId) {
  return {
    id: String(productId),
    isActive: true,
    isHidden: false,
    moderationStatus: "APPROVED",
    service: { isActive: true, status: "ACTIVE" },
  };
}

/*
 * Conversație de siguranță -> răspunsul vânzătorului nu consumă și nu e
 * blocat de cota lunară de mesaje. Verificat pe server, din baza de date
 * (nu din ce trimite browserul).
 */
export async function isQuotaExemptThread(db, { threadId, vendorId }) {
  if (!threadId || !vendorId) return false;
  try {
    const row = await db.messageThread.findFirst({
      where: { id: String(threadId), vendorId: String(vendorId), contactReason: CONTACT_REASONS.SAFETY },
      select: { id: true },
    });
    return Boolean(row);
  } catch (e) {
    // coloana lipsește (migrație / client Prisma neactualizat): cota se aplică exact ca înainte
    console.warn("[productContact] scutirea de cotă indisponibilă:", e?.code || e?.name || e);
    return false;
  }
}

/*
 * Baza de date sau clientul Prisma nu au încă coloanele noi
 * (migrația 20261111120000 neaplicată / `prisma generate` nerulat).
 */
export function isProductContactSchemaMissing(error) {
  if (!error) return false;
  if (error.code === "P2021" || error.code === "P2022") return true;
  return (
    error.name === "PrismaClientValidationError" &&
    /productId|contactReason|safetyEscalatedAt|supportTicketId/.test(String(error.message || ""))
  );
}

function firstImage(images) {
  if (!Array.isArray(images)) return null;
  const first = images.find((x) => typeof x === "string" && x.trim());
  return first || null;
}

/*
 * Inbox: adaugă `product` ({ id, title, image }), `contactReason` și
 * `contactReasonLabel` elementelor (identificate prin `threadId` sau `id`).
 * Citire SEPARATĂ de interogarea principală a inbox-ului: dacă coloanele
 * noi lipsesc (migrație neaplicată / client Prisma vechi) sau citirea
 * eșuează, inbox-ul funcționează exact ca înainte, doar fără etichetă.
 * Doar câmpuri publice ale produsului; niciun dat al vânzătorului.
 */
export async function attachProductContext(db, items) {
  const list = (Array.isArray(items) ? items : []).filter(Boolean);
  for (const it of list) {
    it.product = null;
    it.contactReason = null;
    it.contactReasonLabel = null;
  }

  const threadIdOf = (it) => String(it.threadId || it.id || "");
  const threadIds = [...new Set(list.map(threadIdOf).filter(Boolean))];
  if (!threadIds.length) return list;

  let threads = [];
  try {
    threads = await db.messageThread.findMany({
      where: { id: { in: threadIds }, productId: { not: null } },
      select: { id: true, productId: true, contactReason: true },
    });
  } catch (e) {
    console.warn("[productContact] contextul produsului indisponibil:", e?.code || e?.name || e);
    return list;
  }
  if (!threads?.length) return list;

  const byThread = new Map(threads.map((t) => [t.id, t]));
  const productIds = [...new Set(threads.map((t) => t.productId).filter(Boolean))];
  const byProduct = new Map();
  try {
    const rows = await db.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, title: true, images: true },
    });
    for (const row of rows || []) {
      byProduct.set(row.id, { id: row.id, title: row.title || "Produs", image: firstImage(row.images) });
    }
  } catch (e) {
    console.error("[productContact] inbox product lookup:", e?.message || e);
  }

  for (const it of list) {
    const t = byThread.get(threadIdOf(it));
    if (!t) continue;
    it.contactReason = t.contactReason || null;
    it.contactReasonLabel = contactReasonLabel(t.contactReason);
    it.product = byProduct.get(t.productId) || { id: t.productId, title: "Produs indisponibil", image: null };
  }
  return list;
}

export function buildSafetyTicketBody({ product, storeName, threadId, message, artfestOnly }) {
  const lines = [
    `Sesizare privind siguranța produsului „${product?.title || "produs"}” (ID ${product?.id || "-"}).`,
    `Magazin: ${storeName || "-"}`,
    artfestOnly
      ? "Trimisă DOAR către Artfest (nu a ajuns la vânzător)."
      : `Conversația cu vânzătorul: ${threadId || "-"}`,
    `Pagina produsului: /produs/${product?.id || ""}`,
    "",
    "Mesajul clientului:",
    String(message || "").trim(),
  ];
  return lines.join("\n");
}
