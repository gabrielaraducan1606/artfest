// src/pages/Admin/AdminDesktop/tabs/adminFairLabels.js
//
// Admin → Târg → Etichete: logica fără React (testabilă cu node --test) pentru acțiunile pe rând
// (recepția prin fișa existentă din POS) și parametrii PDF-ului („Cu fotografie produs”).

/*
 * Ce arată rândul pentru recepție:
 *  - { kind: "receive" }   - linie trimisă, participant APPROVED, neblocată: butonul „Recepționează”;
 *  - { kind: "received" }  - deja recepționată: starea, fără a doua recepție;
 *  - { kind: "none" }      - altă stare (ex. participare anulată): explicația, fără buton.
 */
export function receiveActionFor(item) {
  if (!item) return { kind: "none", text: "" };
  if (item.status === "RECEIVED") {
    return { kind: "received", text: `Recepționat: ${item.receivedQty || 0} / ${item.declaredQty} buc.` };
  }
  if (item.status === "REJECTED") return { kind: "received", text: "Refuzat la recepție" };
  if (item.status !== "SUBMITTED") return { kind: "none", text: "" };
  if (item.registrationStatus && item.registrationStatus !== "APPROVED") return { kind: "none", text: "Participare inactivă: recepția din Etichete nu e permisă" };
  if (item.saleBlocked) return { kind: "none", text: "Blocat de la vânzare" };
  if (item.actions && item.actions.canReceive === false) return { kind: "none", text: "" };
  return { kind: "receive", text: "" };
}

/** Parametrii pentru eticheta individuală: ?layout=promo&photo=1 (doar cele active). */
export function labelPdfQuery({ layout = "standard", photo = false } = {}) {
  const params = new URLSearchParams();
  if (layout === "promo") params.set("layout", "promo");
  if (photo) params.set("photo", "1");
  const q = params.toString();
  return q ? `?${q}` : "";
}
