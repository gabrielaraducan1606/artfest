// src/pages/Admin/AdminDesktop/tabs/posProducts.js
//
// POS -> „Adaugă produs” și „Produse / Etichete”: validarea formularului, avertismentul
// de denumire dublată, starea de vânzare explicată și numărul de etichete. Fără React -
// testabil cu node --test. Produsul se salvează prin fluxul EXISTENT de inventar manual
// (POST /labels/promo/inventory-item -> addManualInventoryItem + trimitere), apoi trece
// prin recepție ca orice altă linie; banii la vânzare: 10% Artfest / 90% participant (neschimbat).

// aceleași limite ca serverul (lib/artfestFairManualItem.js, config/artfestFair.js)
export const TITLE_MAX = 200;
export const QTY_MAX = 1000;
export const LABEL_COPIES_MAX = 240;
const PRICE_RE = /^\d{1,7}(?:[.,]\d{1,2})?$/;

/** Denumirea pentru comparare: fără diacritice, litere mici, spații normalizate. */
export function normalizeProductTitle(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Un produs existent al aceluiași proprietar cu aceeași denumire (fără anulate / ciorne), sau null. */
export function findSameTitle(lines, title) {
  const wanted = normalizeProductTitle(title);
  if (!wanted) return null;
  return (
    (Array.isArray(lines) ? lines : []).find(
      (l) => !["CANCELLED", "DRAFT"].includes(l?.status) && normalizeProductTitle(l?.title) === wanted
    ) || null
  );
}

/** „45” / „45,50” -> 4550; altfel null (aceeași regulă ca serverul). */
export function parsePriceRon(value) {
  const text = String(value ?? "").trim().replace(/\s+/g, "");
  if (!PRICE_RE.test(text)) return null;
  const [lei, bani = ""] = text.split(/[.,]/);
  const cents = Number(lei) * 100 + Number((bani + "00").slice(0, 2));
  return cents > 0 ? cents : null;
}

export const OWNER_ARTFEST = "ARTFEST";
export const OWNER_PARTICIPANT = "PARTICIPANT";

/** „Stoc primit fizic”: întreg 1 … QTY_MAX, altfel null. */
export function parseReceivedQty(value) {
  const n = Number(String(value ?? "").trim());
  return Number.isInteger(n) && n >= 1 && n <= QTY_MAX ? n : null;
}

/*
 * Formularul -> { ok, fields, body } pentru POST /pos/products:
 *  - owner ARTFEST (stoc propriu) sau PARTICIPANT (registrationId + magazinul ales, dacă are magazine);
 *  - stocul primit fizic, cu confirmarea explicită (confirmReceived) - obligatorie.
 * `stores` = magazinele participantului ales (pentru „magazin obligatoriu”).
 */
export function validateNewProduct(form, { clientRequestId, stores = [] } = {}) {
  const fields = {};
  const owner = form?.owner;
  const title = String(form?.title ?? "").replace(/\s+/g, " ").trim();
  const price = parsePriceRon(form?.priceRon);
  const qty = parseReceivedQty(form?.receivedQty);
  if (owner !== OWNER_ARTFEST && owner !== OWNER_PARTICIPANT) fields.owner = "Alege proprietarul produsului.";
  if (owner === OWNER_PARTICIPANT) {
    if (!form?.registrationId) fields.owner = "Alege participantul.";
    else if (stores.length && !stores.some((s) => s.serviceId === form?.serviceId)) fields.serviceId = "Alege magazinul participantului.";
  }
  if (!title) fields.title = "Scrie denumirea produsului.";
  else if (title.length > TITLE_MAX) fields.title = `Denumirea poate avea maximum ${TITLE_MAX} de caractere.`;
  if (price === null) fields.priceRon = "Introdu un preț mai mare decât zero (ex. 5 sau 4,50).";
  if (qty === null) fields.receivedQty = `Stocul primit fizic trebuie să fie un număr întreg între 1 și ${QTY_MAX}.`;
  else if (form?.confirmReceived !== true) fields.confirmReceived = `Confirmă că ai primit fizic ${qty} buc.`;
  const ok = Object.keys(fields).length === 0;
  return {
    ok,
    fields,
    body: ok
      ? {
          owner,
          ...(owner === OWNER_PARTICIPANT ? { registrationId: form.registrationId, serviceId: stores.length ? form.serviceId : undefined } : {}),
          clientRequestId,
          title,
          priceRon: String(form.priceRon).trim(),
          receivedQty: qty,
          confirmReceived: true,
        }
      : null,
  };
}

/** Cum se împarte încasarea pentru linia dată (afișare). */
export function ownerSplitText(line) {
  return line?.artfestOwned
    ? "Produs Artfest (stoc propriu): încasarea este integral Artfest."
    : "Produs al participantului: 10% Artfest, 90% vânzătorul.";
}

/** Se poate suplimenta stocul din POS: produs manual, în stoc, proprietar activ. */
export function canAddStock(line) {
  return Boolean(
    line?.isManual && line.status === "RECEIVED" && (line.artfestOwned || !line.registrationStatus || line.registrationStatus === "APPROVED")
  );
}

/** Numărul de etichete ales (1 … 240) sau null. */
export function parseLabelCopies(value) {
  const n = Number(String(value ?? "").trim());
  return Number.isInteger(n) && n >= 1 && n <= LABEL_COPIES_MAX ? n : null;
}

/*
 * Starea de vânzare a unei linii (răspunsul GET /inventory, serializeAdminLine), explicată:
 * { sellable, tone: "ok" | "wait" | "blocked", text }.
 */
export function productSaleState(line) {
  if (!line) return { sellable: false, tone: "blocked", text: "Produs necunoscut." };
  if (line.registrationStatus && line.registrationStatus !== "APPROVED") {
    return { sellable: false, tone: "blocked", text: "Participarea proprietarului nu mai este activă: produsul nu se vinde." };
  }
  switch (line.status) {
    case "DRAFT":
      return { sellable: false, tone: "wait", text: "Ciornă: produsul nu a fost trimis în inventar." };
    case "SUBMITTED":
      return {
        sellable: false,
        tone: "wait",
        text: `Așteaptă recepția (${line.declaredQty} buc. declarate). Nu se poate vinde până nu este recepționat.`,
      };
    case "REJECTED":
      return { sellable: false, tone: "blocked", text: "Refuzat la recepție: nu se vinde." };
    case "CANCELLED":
      return { sellable: false, tone: "blocked", text: "Linie anulată: nu se vinde." };
    case "RECEIVED":
      if (line.saleBlocked) {
        return { sellable: false, tone: "blocked", text: `Blocat de la vânzare${line.saleBlocked.reason ? `: ${line.saleBlocked.reason}` : "."}` };
      }
      if (!(line.availableQty > 0)) return { sellable: false, tone: "blocked", text: "Fără stoc disponibil (0 buc.)." };
      // regula existentă a POS-ului: fără etichetă generată, produsul nu se vinde
      if (line.label?.state === "none") {
        return {
          sellable: false,
          tone: "wait",
          text: `În stoc: ${line.availableQty} buc. Generează eticheta înainte de vânzare (fără etichetă produsul nu se vinde).`,
        };
      }
      return { sellable: true, tone: "ok", text: `De vânzare: ${line.availableQty} buc. disponibile.` };
    default:
      return { sellable: false, tone: "blocked", text: "Produsul nu se poate vinde în acest moment." };
  }
}

/** Termenul de inventar trecut: informare (excepția e doar pentru Admin; vânzătorii rămân limitați). */
export function inventoryClosedMessage(deadlineAt) {
  const when = deadlineAt ? new Date(deadlineAt) : null;
  const text =
    when && !Number.isNaN(when.getTime())
      ? when.toLocaleString("ro-RO", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
      : null;
  return `Termenul pentru inventarul vânzătorilor a trecut${text ? ` (${text})` : ""}. Ca Admin poți adăuga produse și suplimenta stocul în continuare; vânzătorii nu mai pot modifica inventarul.`;
}
