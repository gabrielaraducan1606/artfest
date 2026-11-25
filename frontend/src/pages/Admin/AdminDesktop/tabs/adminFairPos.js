// src/pages/Admin/AdminDesktop/tabs/adminFairPos.js
//
// POS-ul Târgului Artfest (MVP): starea coșului, fără React (testabilă cu
// node --test). Coșul ține doar inventoryItemId + cantitate + date de afișare;
// banii (preț, reduceri, comision, net vendor) vin EXCLUSIV de la server
// (preview / vânzare).

export const POS_API = "/api/admin/artfest-fair/pos";

export const PAYMENT_LABEL = { CASH: "Numerar", CARD: "Card" };

export const SALE_STATUS_LABEL = {
  COMPLETED: "Finalizată",
  VOIDED: "Anulată",
  PARTIALLY_RETURNED: "Returnată parțial",
  RETURNED: "Returnată",
};

export function formatLei(cents) {
  const value = Number(cents || 0) / 100;
  return `${value.toFixed(2).replace(".", ",")} lei`;
}

// scannerul poate trimite litere mici, spații, cratime sau caractere de final (CR, LF, Tab):
// aceeași regulă ca serverul (normalizeScannedBarcode)
export function normalizeBarcode(raw) {
  return String(raw ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/* ===================== Scanner (USB / Bluetooth, mod tastatură) ===================== */

// formatul codului de pe etichetă - același ca pe server (BARCODE_RE din recepție):
// AF + 8 caractere fără 0/1/I/L/O/U/Y/Z
export const FAIR_BARCODE_RE = /^AF[2-9ABCDEFGHJKMNPQRSTVWX]{8}$/;

/** AF7K3M9QXT -> „AF-7K3M-9QXT” (cum apare pe etichetă) */
export function formatBarcodeDisplay(code) {
  const raw = String(code || "");
  return raw.length === 10 ? `${raw.slice(0, 2)}-${raw.slice(2, 6)}-${raw.slice(6)}` : raw;
}

export const PROMO_QR_MESSAGE =
  "Ai scanat QR-ul de promovare (duce la pagina magazinului / artfest.ro), nu codul produsului. " +
  "Scanează codul de bare de pe eticheta produsului (AF-XXXX-XXXX).";

/*
 * Ce s-a citit în câmpul de scanare:
 *  - "empty": nimic (ex. al doilea Enter / Tab trimis de scanner) => ignorat;
 *  - "promo": QR-ul de promovare (adresă web) => explicație, fără cerere la server;
 *  - "code": codul normalizat; `valid` = are formatul codurilor de produs.
 */
export function classifyScan(raw) {
  const text = String(raw ?? "").trim();
  const barcode = normalizeBarcode(text);
  if (!barcode) return { kind: "empty" };
  if (/:\/\/|www\.|artfest\.ro|\/magazin\//i.test(text) || /^(HTTPS?|WWW)/.test(barcode) || barcode.includes("ARTFESTRO")) {
    return { kind: "promo" };
  }
  return { kind: "code", barcode, valid: FAIR_BARCODE_RE.test(barcode), raw: text };
}

export function invalidCodeMessage(scan) {
  const shown = String(scan?.raw || scan?.barcode || "").slice(0, 40);
  return `Cod negăsit: „${shown}” nu este un cod de produs Artfest. Codurile de pe etichete au forma AF-XXXX-XXXX.`;
}

/** Mesajul pentru o scanare eșuată la server / în rețea. */
export function scanErrorMessage(err, barcode) {
  const display = formatBarcodeDisplay(barcode);
  const status = Number(err?.status) || 0;
  if (!status) {
    return `Eroare de conexiune: codul ${display} nu a fost verificat. Verifică internetul și scanează din nou.`;
  }
  if (status === 404) return `Cod negăsit: ${display} nu există în inventarul târgului.`;
  if (status === 401 || status === 403) return "Sesiunea de Admin a expirat sau nu ai acces. Autentifică-te din nou.";
  if (status >= 500) return `Eroare de server la verificarea codului ${display}. Scanează din nou.`;
  return err?.data?.message || `Codul ${display} nu a putut fi verificat.`;
}

/** De ce nu se poate adăuga produsul scanat (mesajele serverului, cu cazurile frecvente explicate). */
export function unsellableMessage(item) {
  const reasons = Array.isArray(item?.reasons) ? item.reasons : [];
  if (reasons.includes("not_received")) {
    return `${item.title}: produs nerecepționat - nu este în stocul târgului. Se poate vinde după recepție.`;
  }
  if (reasons.includes("insufficient_stock")) {
    return `${item.title}: lipsă stoc (disponibil ${Math.max(0, Number(item.availableQty) || 0)}).`;
  }
  return `${item.title}: ${(item.messages || []).join(" ") || "Produsul nu poate fi vândut."}`;
}

/*
 * Unde a ajuns o tastă (evenimentul keydown, pentru scannerul în mod tastatură):
 *  - "scanner":    câmpul de scanare;
 *  - "dialog":     o fereastră deschisă - nu ne atingem;
 *  - "posNumeric": prețul / cantitatea din coș (data-pos-numeric) - doar cifre;
 *  - "text":       alt câmp editabil - nu furăm focusul;
 *  - "other":      pagina, un buton, o bifă.
 */
export function keyTargetKind(target, scanner) {
  if (!target) return "other";
  if (target === scanner) return "scanner";
  if (typeof target.closest === "function" && target.closest('[role="dialog"], dialog')) return "dialog";
  if (target.dataset?.posNumeric != null) return "posNumeric";
  const tag = String(target.tagName || "").toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) return "text";
  if (tag === "INPUT") {
    const type = String(target.type || "text").toLowerCase();
    return ["checkbox", "radio", "button", "submit", "reset", "file", "range", "color", "image"].includes(type) ? "other" : "text";
  }
  return "other";
}

/*
 * Tasta trebuie mutată în câmpul de scanare?
 *  - din afara câmpurilor (pagină, buton, bifă): orice caracter (nu spațiul, care apasă butonul) -
 *    focusul se mută SINCRON, fără să se piardă primele caractere ale scanării;
 *  - din preț / cantitate: doar literele (un cod începe mereu cu „AF”; acolo literele nu sunt valide),
 *    deci cifrele, virgula, ștergerea rămân în câmpul editat;
 *  - din alt câmp text sau dintr-o fereastră: niciodată.
 */
export function shouldRedirectToScanner(event, kind) {
  if (!event || event.ctrlKey || event.metaKey || event.altKey) return false;
  const key = String(event.key || "");
  if (key.length !== 1 || key === " ") return false;
  if (kind === "other") return true;
  if (kind === "posNumeric") return /^[a-z]$/i.test(key);
  return false;
}

export const initialPosState = Object.freeze({
  cart: [],
  busy: false,
  error: "",
  // confirmarea ultimei scanări reușite („Adăugat în coș: …”)
  notice: "",
  lastSale: null,
});

/**
 * De ce NU se adaugă produsul scanat în coșul dat ("" = se adaugă o bucată).
 * Aceeași regulă pentru reducer și pentru rezultatul arătat în fereastra camerei.
 */
export function scanRejectMessage(cart, item) {
  if (!item?.sellable) return unsellableMessage(item);
  const existing = (cart || []).find((l) => l.inventoryItemId === item.inventoryItemId);
  if (existing && existing.quantity >= item.availableQty) {
    return `${item.title}: stoc insuficient (disponibil ${item.availableQty}).`;
  }
  return "";
}

export function posReducer(state, action) {
  switch (action.type) {
    case "SCANNED": {
      const item = action.item;
      const rejected = scanRejectMessage(state.cart, item);
      if (rejected) return { ...state, notice: "", error: rejected };
      const existing = state.cart.find((l) => l.inventoryItemId === item.inventoryItemId);
      if (existing) {
        // același produs scanat din nou => cantitatea crește, în limita stocului
        return {
          ...state,
          error: "",
          notice: `Adăugat în coș: ${item.title} (cantitate ${existing.quantity + 1})`,
          lastSale: null,
          cart: state.cart.map((l) =>
            l.inventoryItemId === item.inventoryItemId ? { ...l, quantity: l.quantity + 1, availableQty: item.availableQty } : l
          ),
        };
      }
      return {
        ...state,
        error: "",
        notice: `Adăugat în coș: ${item.title}`,
        lastSale: null,
        cart: [
          ...state.cart,
          {
            inventoryItemId: item.inventoryItemId,
            title: item.title,
            variantLabel: item.variantLabel || null,
            vendorName: item.vendor?.name || null,
            barcodeDisplay: item.barcodeDisplay,
            priceCents: item.priceCents,
            availableQty: item.availableQty,
            quantity: 1,
            // prețul efectiv se poate introduce la casă (orice participant aprobat; doar vânzarea curentă);
            // banii: comision 10% / vendor 90% din prețul efectiv, calculați pe server
            pricingModel: item.pricingModel || "COMMISSION",
            canEditPrice: Boolean(item.canEditPrice),
            labelPriceCents: item.blankPriceLabel ? null : item.labelPriceCents ?? item.priceCents,
            // eticheta fără preț tipărit: prețul scris cu pixul se introduce aici
            blankPriceLabel: Boolean(item.blankPriceLabel),
            // prețul de vânzare actual (prețul final); peste el, prețul introdus cere confirmare
            salePriceCents: item.salePriceCents ?? item.priceCents,
            aboveLabelConfirmed: false,
            vendorPriceCents: item.vendorPriceCents ?? null,
            suggestedPriceCents: item.suggestedPriceCents ?? null,
            // eticheta are alt preț decât cel actual: se vinde cu prețul introdus la casă (fără retipărire);
            // pornim de la prețul tipărit, pe care îl vede clientul
            requiresPrice: Boolean(item.requiresPrice),
            priceInput: item.requiresPrice && item.labelPriceCents != null ? centsToInput(item.labelPriceCents) : "",
          },
        ],
      };
    }
    case "SET_PRICE":
      return {
        ...state,
        error: "",
        // prețul nou anulează confirmarea anterioară (se confirmă exact prețul afișat)
        cart: state.cart.map((l) =>
          l.inventoryItemId === action.inventoryItemId ? { ...l, priceInput: String(action.value ?? ""), aboveLabelConfirmed: false } : l
        ),
      };
    case "CONFIRM_ABOVE_LABEL":
      return {
        ...state,
        error: "",
        cart: state.cart.map((l) => (l.inventoryItemId === action.inventoryItemId ? { ...l, aboveLabelConfirmed: Boolean(action.value) } : l)),
      };
    case "SCAN_ERROR":
      return { ...state, notice: "", error: action.message };
    case "SET_QTY": {
      const qty = Math.trunc(Number(action.quantity));
      return {
        ...state,
        error: "",
        cart: state.cart.map((l) =>
          l.inventoryItemId === action.inventoryItemId ? { ...l, quantity: Math.max(1, Math.min(Number.isFinite(qty) ? qty : 1, l.availableQty)) } : l
        ),
      };
    }
    case "INC":
      return posReducer(state, {
        type: "SET_QTY",
        inventoryItemId: action.inventoryItemId,
        quantity: (state.cart.find((l) => l.inventoryItemId === action.inventoryItemId)?.quantity || 0) + 1,
      });
    case "DEC":
      return posReducer(state, {
        type: "SET_QTY",
        inventoryItemId: action.inventoryItemId,
        quantity: (state.cart.find((l) => l.inventoryItemId === action.inventoryItemId)?.quantity || 2) - 1,
      });
    case "REMOVE":
      return { ...state, error: "", cart: state.cart.filter((l) => l.inventoryItemId !== action.inventoryItemId) };
    case "SUBMIT_START":
      return { ...state, busy: true, error: "" };
    case "SUBMIT_SUCCESS":
      // succes: coș gol, vânzarea afișată; focusul revine pe scanner (componenta)
      return { ...state, busy: false, error: "", notice: "", cart: [], lastSale: action.sale };
    case "SUBMIT_ERROR":
      return { ...state, busy: false, error: action.message };
    case "NEW_SALE":
      return { ...initialPosState };
    default:
      return state;
  }
}

/** 4290 -> „42,90” (valoarea din câmpul de preț) */
export function centsToInput(cents) {
  return (Number(cents || 0) / 100).toFixed(2).replace(".", ",");
}

/** „40”, „40,5”, „40.50” -> 4050 bani; gol -> null; invalid -> NaN. */
export function parseLeiToCents(raw) {
  const text = String(raw ?? "").trim().replace(/\s/g, "").replace(",", ".");
  if (!text) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return Number.NaN;
  return Math.round(Number(text) * 100);
}

/** Prețul introdus depășește prețul de vânzare de pe etichetă? */
export function isAboveLabel(line) {
  if (line.blankPriceLabel) return false; // nu există preț tipărit de comparat
  const price = parseLeiToCents(line.priceInput);
  return Number.isInteger(price) && price > 0 && line.salePriceCents != null && price > line.salePriceCents;
}

/** Problemele câmpurilor completate în coș (blochează încasarea până la corectare). */
export function cartInputProblems(cart) {
  const problems = [];
  for (const l of cart) {
    const price = parseLeiToCents(l.priceInput);
    if (Number.isNaN(price) || price === 0) problems.push(`${l.title}: prețul efectiv nu este valid.`);
    if (l.requiresPrice && price === null) {
      problems.push(
        l.blankPriceLabel
          ? `${l.title}: introdu prețul scris pe etichetă.`
          : `${l.title}: eticheta are alt preț, introdu prețul efectiv.`
      );
    }
    if (isAboveLabel(l) && !l.aboveLabelConfirmed) problems.push(`${l.title}: confirmă prețul mai mare decât cel de pe etichetă.`);
  }
  return problems;
}

/*
 * Încasarea e permisă doar pe totalul afișat: preview-ul trebuie să fie calculat
 * pentru EXACT coșul curent (inclusiv prețurile editate).
 */
export function canSubmit(state, preview, signature = null) {
  if (state.busy || !state.cart.length || !preview?.canConfirm) return false;
  if (cartInputProblems(state.cart).length) return false;
  return signature === null || preview.signature === signature;
}

// corpul cererii: id + cantitate; prețul efectiv DOAR când e completat
// (comisionul și suma vendorului se calculează pe server)
export function cartPayload(cart) {
  return cart.map((l) => {
    const line = { inventoryItemId: l.inventoryItemId, quantity: l.quantity };
    if (!l.canEditPrice) return line;
    const price = parseLeiToCents(l.priceInput);
    if (Number.isInteger(price) && price > 0) {
      line.effectiveUnitPriceCents = price;
      if (isAboveLabel(l) && l.aboveLabelConfirmed) line.aboveLabelConfirmed = true;
    }
    return line;
  });
}

export function cartSignature(cart) {
  return JSON.stringify(cartPayload(cart));
}

export function newIdempotencyKey() {
  try {
    return crypto.randomUUID();
  } catch {
    return `k-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

/* ===================== Retururi / anulări (clienți) ===================== */

export const DISPOSITION_LABEL = {
  RESTOCKED: "Returnat, revandabil (revine în stoc)",
  NOT_RESTOCKED: "Returnat, nevandabil (deteriorat)",
  NOT_RETURNED: "Rambursare fără produs",
};

export const RETURN_TYPE_LABEL = { VOID: "Anulare", RETURN: "Retur" };

// dispozițiile pentru care Admin alege explicit cine suportă rambursarea (+ motiv)
export const RESPONSIBILITY_REQUIRED = new Set(["NOT_RESTOCKED", "NOT_RETURNED"]);

export const RESPONSIBILITY_LABEL = { VENDOR: "Vendor", ARTFEST: "Artfest" };

// textul de impact afișat în preview, pe linie
export function impactText(line) {
  if (line.refundResponsibility === "ARTFEST") {
    return `Vendor neafectat. Rambursare suportată de Artfest: ${formatLei(line.artfestBorneRefundCents)}`;
  }
  if (line.responsibilityRequired && !line.refundResponsibility) return "Alege cine suportă rambursarea.";
  return `Net vendor afectat: -${formatLei(line.vendorNetImpactCents)}`;
}

// ciorna returului: o linie pentru fiecare linie de vânzare cu bucăți nereturnate
export function initialReturnDraft(sale) {
  return {
    reason: "",
    refundMethod: sale?.paymentMethod === "CARD" ? "CARD" : "CASH",
    lines: (sale?.lines || [])
      .filter((l) => l.quantity - (l.returnedQty || 0) > 0)
      .map((l) => ({
        saleLineId: l.id,
        title: l.title,
        variantLabel: l.variantLabel || null,
        vendorName: l.vendorName || null,
        quantity: l.quantity,
        returnedQty: l.returnedQty || 0,
        qty: 0,
        disposition: "RESTOCKED",
        note: "",
        refundResponsibility: "",
        responsibilityReason: "",
      })),
  };
}

// corpul cererii: doar liniile cu cantitate > 0; banii se calculează pe server.
// Responsabilul + motivul se trimit DOAR pentru NOT_RESTOCKED / NOT_RETURNED.
export function returnPayload(draft) {
  return {
    reason: draft.reason.trim(),
    refundMethod: draft.refundMethod,
    lines: draft.lines
      .filter((l) => Number(l.qty) > 0)
      .map((l) => ({
        saleLineId: l.saleLineId,
        quantity: Number(l.qty),
        disposition: l.disposition,
        ...(l.note.trim() ? { conditionNote: l.note.trim() } : {}),
        ...(RESPONSIBILITY_REQUIRED.has(l.disposition)
          ? {
              ...(l.refundResponsibility ? { refundResponsibility: l.refundResponsibility } : {}),
              ...(l.responsibilityReason.trim() ? { responsibilityReason: l.responsibilityReason.trim() } : {}),
            }
          : {}),
      })),
  };
}

// ce lipsește încă din formular (afișat lângă butonul de confirmare)
export function returnDraftProblems(draft) {
  const problems = [];
  const chosen = draft.lines.filter((l) => Number(l.qty) > 0);
  if (!chosen.length) problems.push("Alege cel puțin o bucată de returnat.");
  for (const l of chosen) {
    if (!Number.isInteger(Number(l.qty)) || Number(l.qty) > l.quantity - l.returnedQty) {
      problems.push(`${l.title}: se pot returna cel mult ${l.quantity - l.returnedQty} buc.`);
    }
    if (RESPONSIBILITY_REQUIRED.has(l.disposition)) {
      if (!l.refundResponsibility) problems.push(`${l.title}: alege cine suportă rambursarea.`);
      if (l.responsibilityReason.trim().length < 3) problems.push(`${l.title}: scrie motivul pentru cine suportă rambursarea.`);
    }
  }
  if (draft.reason.trim().length < 3) problems.push("Scrie motivul returului.");
  return problems;
}
