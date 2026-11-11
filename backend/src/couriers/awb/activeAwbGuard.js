// backend/src/couriers/awb/activeAwbGuard.js

/*
 * Anularea unei COMENZI / livrări nu are voie să ascundă un AWB încă valid
 * la curier: după anulare, livrarea devine REFUSED și vendorul ar pierde
 * butonul „Anulează AWB”, iar curierul ar putea veni după un colet anulat.
 *
 * Regula (aceeași pentru vendor, client și admin): cât timp o livrare încă
 * nepredată curierului are un AWB activ prin integrare (CREATED, generare
 * neconfirmată REQUESTED / UNKNOWN sau o anulare a AWB-ului în curs /
 * neconfirmată), anularea comenzii e BLOCATĂ până se rezolvă AWB-ul.
 * Nicio scriere, niciun apel la curier - doar citire.
 */

// livrarea NU a fost încă predată curierului (AWB-ul poate fi încă anulat)
export const AWB_PRE_HANDOVER_STATUSES = new Set([
  "PENDING",
  "PREPARING",
  "READY_FOR_PICKUP",
  "PICKUP_SCHEDULED",
]);

// același prag ca la AWB (awbService.CANCEL_IN_PROGRESS_STALE_MS)
const CANCEL_IN_PROGRESS_STALE_MS = 2 * 60 * 1000;

/**
 * Starea anulării AWB-ului din providerMeta: "IN_PROGRESS" | "UNKNOWN" | null.
 * O anulare „în curs” mai veche decât pragul (ex. serverul a repornit în
 * timpul apelului) e tratată ca neconfirmată.
 */
export function awbCancelStateOf(row, now = Date.now()) {
  const meta = row?.providerMeta && typeof row.providerMeta === "object" ? row.providerMeta : {};
  if (meta.cancelState === "IN_PROGRESS") {
    const at = Date.parse(meta.cancelAttemptedAt || "");
    return Number.isFinite(at) && now - at < CANCEL_IN_PROGRESS_STALE_MS ? "IN_PROGRESS" : "UNKNOWN";
  }
  return meta.cancelState === "UNKNOWN" ? "UNKNOWN" : null;
}

const ACTIVE = ["REQUESTED", "CREATED", "UNKNOWN"];

function messageFor(row, audience) {
  if (audience === "client") {
    return "Vânzătorul a generat deja AWB-ul de expediere pentru această comandă. Pentru anulare, contactează vânzătorul sau suportul Artfest.";
  }
  const awb = row.awbNumber ? ` ${row.awbNumber}` : "";
  const where = audience === "admin" ? "(din comanda vendorului sau din Admin → Ridicări)" : "(secțiunea AWB din comandă)";
  if (row.status !== "CREATED") {
    return "Generarea AWB-ului nu este încă confirmată de Sameday. Comanda poate fi anulată după ce AWB-ul este clarificat.";
  }
  const cancelState = awbCancelStateOf(row);
  if (cancelState === "IN_PROGRESS") {
    return `Anularea AWB-ului${awb} este în curs. Încearcă anularea comenzii după ce se confirmă.`;
  }
  if (cancelState === "UNKNOWN") {
    return `Nu putem confirma încă dacă Sameday a anulat AWB-ul${awb}. Comanda poate fi anulată după confirmare; contactează suportul dacă durează.`;
  }
  return `Comanda are AWB-ul${awb} generat la Sameday. Anulează întâi AWB-ul ${where}, apoi anulează comanda.`;
}

/**
 * @param {Array<{id:string, status:string, handedOverAt?:Date|null}>} shipments livrările care s-ar anula
 * @param {{ audience?: "vendor"|"client"|"admin" }} opts
 * @returns {Promise<null | { status: 409, error: "courier_awb_active", message: string, shipmentId: string, awbNumber: string|null }>}
 */
export async function findOrderCancelAwbBlock(db, shipments = [], { audience = "vendor" } = {}) {
  const ids = shipments
    // coletele de RETUR nu se anulează odată cu comanda (AWB-ul lor are fluxul propriu)
    .filter((s) => s && s.direction !== "RETURN" && !s.handedOverAt && AWB_PRE_HANDOVER_STATUSES.has(String(s.status)))
    .map((s) => String(s.id));
  if (!ids.length) return null;

  const row = await db.courierAwb.findFirst({
    where: { activeShipmentId: { in: ids }, status: { in: ACTIVE } },
    select: { id: true, shipmentId: true, status: true, awbNumber: true, providerMeta: true },
  });
  if (!row) return null;

  return {
    status: 409,
    error: "courier_awb_active",
    message: messageFor(row, audience),
    shipmentId: row.shipmentId,
    awbNumber: audience === "client" ? null : row.awbNumber || null,
  };
}
