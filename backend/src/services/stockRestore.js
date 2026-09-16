// src/services/stockRestore.js
//
// Sursă canonică UNICĂ pentru restaurarea stocului la anulare
// (vendor/admin/user cancel), reutilizată identic în toate cele 3
// flow-uri - nu mai există 3 implementări separate.
//
// Regulă (audit 2026-09-14, fără snapshot istoric la checkout):
// checkout-ul decrementează readyQty DOAR când, la acel moment,
// availability === "READY" && readyQty !== null. Nu există niciun
// câmp/tabel care să înregistreze starea produsului la momentul
// exact al checkout-ului (ShipmentItem nu are un asemenea snapshot,
// nu există un model de stock-movement/inventory-log în schema).
//
// Din acest motiv, restaurarea se bazează pe STAREA CURENTĂ a
// produsului (singura informație certă disponibilă), cu o regulă
// deliberat conservatoare: restaurăm DOAR dacă produsul e ÎN
// CONTINUARE stock-tracked (readyQty !== null) și în starea în care
// checkout-ul l-ar fi putut decrementa sau epuiza (READY sau
// SOLD_OUT). Pentru MADE_TO_ORDER/PREORDER NU atingem nici readyQty,
// nici availability.
//
// LIMITĂ RĂMASĂ (raportată explicit, nu ascunsă): dacă vendorul
// schimbă manual produsul READY -> MADE_TO_ORDER/PREORDER ÎNTRE
// checkout și anulare, restaurarea NU se mai face (produsul nu mai e
// eligibil după regula de mai sus) - decizie deliberată: preferăm să
// NU restaurăm automat decât să supraevaluăm stocul pe baza unei
// presupuneri despre starea istorică pe care nu o putem verifica.

/**
 * Agregă qty pe productId dintr-o listă de ShipmentItem (a unui
 * singur shipment, sau flatMap peste mai multe shipment-uri ale
 * aceleiași comenzi).
 */
export function aggregateQtyByProductId(items) {
  const qtyByProductId = new Map();

  for (const item of items || []) {
    if (!item.productId) {
      continue;
    }

    const qty = Number(item.qty || 0);

    if (!Number.isInteger(qty) || qty <= 0) {
      continue;
    }

    qtyByProductId.set(
      item.productId,
      (qtyByProductId.get(item.productId) || 0) + qty
    );
  }

  return qtyByProductId;
}

/**
 * Restaurează stocul pentru fiecare productId din harta agregată,
 * folosind EXACT regula descrisă mai sus. Rulează în tranzacția `tx`
 * primită de la apelant (vendor/admin/user cancel), pentru
 * consistență cu restul modificărilor din același cancel.
 */
export async function restoreProductStock(tx, qtyByProductId) {
  for (const [productId, qty] of qtyByProductId) {
    await tx.product.updateMany({
      where: {
        id: productId,

        // doar produse ÎN CONTINUARE stock-tracked
        readyQty: { not: null },

        // doar stări în care checkout-ul le-ar fi putut decrementa
        // (READY) sau epuiza (SOLD_OUT) - NICIODATĂ MADE_TO_ORDER/
        // PREORDER
        availability: { in: ["READY", "SOLD_OUT"] },
      },

      data: {
        readyQty: { increment: qty },

        // qty > 0 mereu (filtrat mai sus) => readyQty rezultat > 0
        // mereu pentru rândurile care se potrivesc where-ul de mai
        // sus => READY e corect atât pentru cazul "era deja READY"
        // cât și pentru "era SOLD_OUT, acum are stoc din nou".
        availability: "READY",
      },
    });
  }
}

/**
 * Comoditate: agregă + restaurează direct dintr-o listă de items.
 */
export async function restoreStockFromItems(tx, items) {
  const qtyByProductId = aggregateQtyByProductId(items);
  await restoreProductStock(tx, qtyByProductId);
  return qtyByProductId;
}
