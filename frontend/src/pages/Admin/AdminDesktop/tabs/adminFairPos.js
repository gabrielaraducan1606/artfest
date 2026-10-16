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

// scannerul poate trimite litere mici, spații sau cratime
export function normalizeBarcode(raw) {
  return String(raw ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export const initialPosState = Object.freeze({
  cart: [],
  busy: false,
  error: "",
  lastSale: null,
});

export function posReducer(state, action) {
  switch (action.type) {
    case "SCANNED": {
      const item = action.item;
      if (!item.sellable) {
        return { ...state, error: `${item.title}: ${(item.messages || []).join(" ") || "Produsul nu poate fi vândut."}` };
      }
      const existing = state.cart.find((l) => l.inventoryItemId === item.inventoryItemId);
      if (existing) {
        // același produs scanat din nou => cantitatea crește, în limita stocului
        if (existing.quantity >= item.availableQty) {
          return { ...state, error: `${item.title}: stoc insuficient (disponibil ${item.availableQty}).` };
        }
        return {
          ...state,
          error: "",
          lastSale: null,
          cart: state.cart.map((l) =>
            l.inventoryItemId === item.inventoryItemId ? { ...l, quantity: l.quantity + 1, availableQty: item.availableQty } : l
          ),
        };
      }
      return {
        ...state,
        error: "",
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
          },
        ],
      };
    }
    case "SCAN_ERROR":
      return { ...state, error: action.message };
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
      return { ...state, busy: false, error: "", cart: [], lastSale: action.sale };
    case "SUBMIT_ERROR":
      return { ...state, busy: false, error: action.message };
    case "NEW_SALE":
      return { ...initialPosState };
    default:
      return state;
  }
}

export function canSubmit(state, preview) {
  return !state.busy && state.cart.length > 0 && Boolean(preview?.canConfirm);
}

// corpul cererii: doar id + cantitate (fără preț / comision / vendor)
export function cartPayload(cart) {
  return cart.map((l) => ({ inventoryItemId: l.inventoryItemId, quantity: l.quantity }));
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
