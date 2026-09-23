// src/utils/discountCodeAttribution.js

/*
 * Hint de atribuire pentru codul de reducere introdus de client -
 * separat de discountCode.js (care ține DOAR codul, pentru calculul
 * reducerii). Scop: dacă userul apasă "Elimină" pe cod (nu mai
 * participă la preț), influencerul/vendorul căruia îi aparține codul
 * NU trebuie să piardă atribuirea comenzii.
 *
 * sessionStorage, NU localStorage (cerut explicit) - atribuirea prin
 * cod trăiește DOAR pentru sesiunea curentă de cumpărare, spre
 * deosebire de campaignAttribution/influencerAttribution/
 * vendorReferralAttribution (?ref=, localStorage, zile întregi).
 *
 * Tokenul salvat aici e doar un HINT pentru checkout - serverul
 * revalidează mereu fresh din DB (pe discountCodeId/code) înainte să
 * acorde orice atribuire, exact ca la celelalte mecanisme (vezi
 * resolveDiscountCodeAttributionHintValidation, chekoutRoutes.js).
 * NU se are încredere niciodată direct în influencerId/vendorId de
 * aici.
 *
 * IMPORTANT: removeDiscountCode() din Cart.jsx/Checkout.jsx NU
 * cheamă clearStoredDiscountCodeAttribution() - doar
 * clearStoredDiscountCode() (discountCode.js). Hintul se șterge DOAR
 * la (a) introducerea unui alt cod valid (suprascris - ultimul cod
 * valid câștigă) sau (b) plasarea cu succes a comenzii.
 */

const STORAGE_KEY = "artfest.discountCodeAttribution";

/**
 * Citește hint-ul curent - { discountCodeId, code, influencerId,
 * vendorId, type } sau null.
 */
export function getStoredDiscountCodeAttribution() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Scrie hint-ul, DOAR câmpurile strict necesare pentru revalidare
 * server-side - niciun discount/preț/procent aici (acelea rămân
 * strict în discountCodeApplied, stare locală, nepersistată separat).
 *
 * Apelat cu `influencerId` SAU `vendorId` (niciodată ambele - mirror
 * al regulii din DiscountCode, vezi discountCodeValidation.js).
 * Dacă niciunul nu e prezent (cod valid, dar fără owner), se
 * apelează cu `null`/`undefined`, care șterge orice hint anterior -
 * ultimul cod VALID introdus înlocuiește mereu hint-ul precedent.
 */
export function storeDiscountCodeAttribution(hint) {
  try {
    if (!hint || (!hint.influencerId && !hint.vendorId)) {
      sessionStorage.removeItem(STORAGE_KEY);
      return;
    }

    const entry = {
      discountCodeId: hint.discountCodeId || null,
      code: String(hint.code || "").trim() || null,
      influencerId: hint.influencerId || null,
      vendorId: hint.vendorId || null,
      type: hint.influencerId ? "INFLUENCER" : "VENDOR",
    };

    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(entry));
  } catch {
    // sessionStorage indisponibil (mod privat etc.) - degradăm silențios.
  }
}

/**
 * Șters DOAR după plasarea cu succes a comenzii - ca să nu fie
 * reutilizat accidental la comanda următoare din aceeași filă.
 */
export function clearStoredDiscountCodeAttribution() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
