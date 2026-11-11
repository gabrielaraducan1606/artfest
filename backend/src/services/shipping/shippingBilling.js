// backend/src/services/shipping/shippingBilling.js
//
// Sumele de transport pe shipment (ShipmentDelivery), pentru refacturare:
//   shippingCost        suma taxată clientului - fixă după plasarea comenzii;
//   carrierCost         costul real al curierului (Sameday) - poate veni ulterior;
//   vendorShippingCost  suma pe care Artfest o refacturează vendorului.
// Vendorul facturează clientului produsul + transportul, Sameday facturează
// Artfest, iar Artfest refacturează vendorului costul real al curierului.
// Valori monetare în RON; tratamentul TVA se stabilește la etapa de facturare.

const MAX_CENTS = 9_999_999_999; // DECIMAL(10,2)

export class ShippingBillingError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ShippingBillingError";
    this.code = code;
  }
}

/**
 * Sumă în lei (number / string / Prisma Decimal) -> bani (întreg), validată:
 * număr finit, cel mult 2 zecimale, nenegativ, în limita coloanei.
 */
export function moneyToCents(value, field = "suma") {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") {
    throw new ShippingBillingError("invalid_amount", `${field}: lipsește valoarea.`);
  }
  const text = String(typeof value === "object" && typeof value.toString === "function" ? value.toString() : value).trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(text)) {
    throw new ShippingBillingError("invalid_amount", `${field}: valoare invalidă (${text.slice(0, 32)}).`);
  }
  const negative = text.startsWith("-");
  const [lei, bani = ""] = text.replace("-", "").split(".");
  const cents = Number(lei) * 100 + Number(bani.padEnd(2, "0"));
  if (negative && cents !== 0) throw new ShippingBillingError("negative_amount", `${field} nu poate fi negativ.`);
  if (!Number.isSafeInteger(cents) || cents > MAX_CENTS) throw new ShippingBillingError("invalid_amount", `${field}: valoare prea mare.`);
  return cents;
}

export const centsToMoney = (cents) => (cents / 100).toFixed(2);

/**
 * Suma de refacturat vendorului pentru un shipment.
 * Fără subvenție Artfest: = costul real al curierului (inclusiv când vendorul
 * a oferit transport gratuit sau tariful lui de rezervă a fost mai mic).
 * artfestShippingSubsidy e pregătit pentru o promoție viitoare („transport
 * gratuit oferit de Artfest”) - nu e salvat nicăieri încă; implicit 0.
 * @returns {string} sumă cu 2 zecimale, niciodată sub 0
 */
export function computeVendorShippingCost(carrierCost, { artfestShippingSubsidy = 0 } = {}) {
  const carrierCents = moneyToCents(carrierCost, "Costul curierului");
  const subsidyCents = moneyToCents(artfestShippingSubsidy, "Subvenția Artfest");
  return centsToMoney(Math.max(carrierCents - subsidyCents, 0));
}

/**
 * Câmpurile de facturare la crearea ShipmentDelivery (checkout). Costul real
 * e completat doar dacă sursa de preț l-a furnizat deja; altfel rămâne null
 * și se completează ulterior cu recordCarrierCost.
 */
export function billingFieldsAtPlacement({ carrierCost = null, fallbackReason = null, now = new Date() } = {}) {
  const known = carrierCost !== null && carrierCost !== undefined;
  return {
    fallbackReason: fallbackReason ? String(fallbackReason).slice(0, 64) : null,
    carrierCost: known ? centsToMoney(moneyToCents(carrierCost, "Costul curierului")) : null,
    carrierCostUpdatedAt: known ? now : null,
    vendorShippingCost: known ? computeVendorShippingCost(carrierCost) : null,
  };
}

/**
 * Completează / actualizează costul real al curierului pentru un shipment
 * (ex. reconcilierea cu factura Sameday). Modifică DOAR carrierCost,
 * carrierCostUpdatedAt și vendorShippingCost; shippingCost (suma taxată
 * clientului), pricingSource și fallbackReason rămân neschimbate.
 * @param {Object} options
 * @param {import("@prisma/client").PrismaClient} options.db  prisma sau tranzacție
 * @param {string} options.shipmentId
 * @param {number|string} options.carrierCost  în lei
 * @param {Date} [options.at]
 */
export async function recordCarrierCost({ db, shipmentId, carrierCost, at = new Date() }) {
  if (!shipmentId) throw new ShippingBillingError("shipment_required", "Lipsește shipment-ul.");
  const carrierCents = moneyToCents(carrierCost, "Costul curierului");

  const existing = await db.shipmentDelivery.findUnique({
    where: { shipmentId: String(shipmentId) },
    select: { id: true, shipment: { select: { direction: true } } },
  });
  if (!existing) throw new ShippingBillingError("delivery_not_found", "Shipment-ul nu are livrare salvată.");
  /*
   * RETUR: vendorShippingCost NU e „costul curierului minus subvenție” (regula
   * outbound) - pe retur costul se împarte între client / vendor / Artfest
   * (shippingCost / vendorShippingCost / artfestSubsidyAmount) după o decizie
   * explicită, încă neimplementată. Refuzăm, ca să nu suprascriem greșit.
   */
  if (existing.shipment?.direction === "RETURN") {
    throw new ShippingBillingError(
      "return_carrier_cost_unsupported",
      "Costul real al unui retur se înregistrează printr-un flux separat (încă neimplementat)."
    );
  }

  return db.shipmentDelivery.update({
    where: { id: existing.id },
    data: {
      carrierCost: centsToMoney(carrierCents),
      carrierCostUpdatedAt: at,
      vendorShippingCost: computeVendorShippingCost(centsToMoney(carrierCents)),
    },
  });
}

/*
 * COSTUL TRANSPORTULUI DE RETUR (Shipment RETURN)
 *
 * Pe ShipmentDelivery-ul returului (comentariul din schema.prisma):
 *   carrierCost          costul curierului (awbCost Sameday / factură);
 *   shippingCost         partea CLIENTULUI;
 *   vendorShippingCost   partea VENDORULUI;
 *   artfestSubsidyAmount partea ARTFEST.
 * Repartizarea urmează DOAR decizia explicită ReturnRequest.costBearer:
 *   VENDOR / CUSTOMER / ARTFEST -> 100% pe partea respectivă;
 *   SPLIT                       -> BLOCAT (procentul nu e stabilit; nimic inventat);
 *   nedecis                     -> BLOCAT.
 * Părțile se (re)calculează DOAR dacă sunt goale (null / 0) sau sunt exact
 * rezultatul unei repartizări automate anterioare; altfel (decizie manuală)
 * se salvează doar carrierCost și se raportează BLOCKED_MANUAL_SHARES.
 * Doar ÎNREGISTRARE: nicio reținere din refund sau din câștigurile vendorului,
 * niciun ledger (ledger-ul SALE ignoră Shipment-urile RETURN), nicio factură.
 * Idempotent: aceleași valori -> nimic scris. Fiecare schimbare lasă o intrare
 * de audit în CourierAwb.providerMeta.returnCostAudit (AWB-ul curent).
 */
export const RETURN_COST_ALLOCATION = Object.freeze({
  ALLOCATED: "allocated",
  BLOCKED_SPLIT: "blocked_split_ratio_undecided",
  BLOCKED_UNDECIDED: "blocked_cost_bearer_undecided",
  // părți deja completate altfel (decizie manuală) -> nu le suprascriem
  BLOCKED_MANUAL_SHARES: "blocked_manual_shares_present",
});

const RETURN_COST_AUDIT_MAX = 20;

/**
 * Repartizarea pură a costului de retur.
 * @returns {{ allocation: string, customerShare: string|null, vendorShare: string|null, artfestShare: string|null }}
 */
export function allocateReturnCarrierCost({ costBearer, carrierCost }) {
  const cost = centsToMoney(moneyToCents(carrierCost, "Costul curierului"));
  const zero = "0.00";
  switch (costBearer) {
    case "VENDOR":
      return { allocation: RETURN_COST_ALLOCATION.ALLOCATED, customerShare: zero, vendorShare: cost, artfestShare: zero };
    case "CUSTOMER":
      return { allocation: RETURN_COST_ALLOCATION.ALLOCATED, customerShare: cost, vendorShare: zero, artfestShare: zero };
    case "ARTFEST":
      return { allocation: RETURN_COST_ALLOCATION.ALLOCATED, customerShare: zero, vendorShare: zero, artfestShare: cost };
    case "SPLIT":
      return { allocation: RETURN_COST_ALLOCATION.BLOCKED_SPLIT, customerShare: null, vendorShare: null, artfestShare: null };
    default:
      return { allocation: RETURN_COST_ALLOCATION.BLOCKED_UNDECIDED, customerShare: null, vendorShare: null, artfestShare: null };
  }
}

const sameMoney = (a, b) => (a === null || a === undefined ? null : centsToMoney(moneyToCents(String(a)))) === b;

/**
 * Înregistrează costul curierului pentru un retur (idempotent, auditat).
 * Repartizare blocată (SPLIT / nedecis) -> se salvează DOAR carrierCost;
 * părțile rămân null (de decis manual), iar rezultatul o spune explicit.
 * @param {Object} o
 * @param {Object} o.db           prisma (deschide propria tranzacție)
 * @param {string} o.shipmentId   Shipment RETURN
 * @param {number|string} o.carrierCost  lei
 * @param {string} o.source       ex. "awb_create" | "invoice" | "admin"
 * @param {string|null} [o.actorId]
 * @returns {Promise<{ changed: boolean, allocation: string, costBearer: string|null }>}
 */
export async function recordReturnCarrierCost({ db, shipmentId, carrierCost, source, actorId = null, at = new Date() }) {
  if (!shipmentId) throw new ShippingBillingError("shipment_required", "Lipsește shipment-ul.");
  const cost = centsToMoney(moneyToCents(carrierCost, "Costul curierului"));
  const src = String(source || "").slice(0, 32);
  if (!src) throw new ShippingBillingError("source_required", "Lipsește sursa costului.");

  return db.$transaction(async (tx) => {
    // rândul livrării blocat: două înregistrări simultane nu se intercalează
    const [locked] = await tx.$queryRaw`SELECT id FROM "ShipmentDelivery" WHERE "shipmentId" = ${String(shipmentId)} FOR UPDATE`;
    if (!locked) throw new ShippingBillingError("delivery_not_found", "Shipment-ul nu are livrare salvată.");
    const d = await tx.shipmentDelivery.findUnique({
      where: { id: locked.id },
      select: {
        id: true,
        carrierCost: true,
        shippingCost: true,
        vendorShippingCost: true,
        artfestSubsidyAmount: true,
        shipment: {
          select: {
            direction: true,
            awb: true,
            returnRequest: { select: { id: true, costBearer: true } },
            courierAwbs: { where: { status: "CREATED" }, select: { id: true, awbNumber: true, providerMeta: true } },
          },
        },
      },
    });
    if (d.shipment?.direction !== "RETURN") {
      throw new ShippingBillingError("not_return_shipment", "Costul de retur se înregistrează doar pe expedierea de retur.");
    }
    const costBearer = d.shipment.returnRequest?.costBearer ?? null;
    const plan = allocateReturnCarrierCost({ costBearer, carrierCost: cost });
    const allocated = plan.allocation === RETURN_COST_ALLOCATION.ALLOCATED;

    const current = {
      carrierCost: d.carrierCost,
      shippingCost: d.shippingCost,
      vendorShippingCost: d.vendorShippingCost,
      artfestSubsidyAmount: d.artfestSubsidyAmount,
    };
    const SHARES = ["shippingCost", "vendorShippingCost", "artfestSubsidyAmount"];
    const empty = SHARES.every((k) => current[k] === null || current[k] === undefined || sameMoney(current[k], "0.00"));
    let ownPrevious = false;
    if (!empty && allocated && current.carrierCost !== null && current.carrierCost !== undefined) {
      const prev = allocateReturnCarrierCost({ costBearer, carrierCost: current.carrierCost });
      ownPrevious = sameMoney(current.shippingCost, prev.customerShare) && sameMoney(current.vendorShippingCost, prev.vendorShare) && sameMoney(current.artfestSubsidyAmount, prev.artfestShare);
    }
    const manualShares = allocated && !empty && !ownPrevious;
    const allocation = manualShares ? RETURN_COST_ALLOCATION.BLOCKED_MANUAL_SHARES : plan.allocation;

    const data = { carrierCost: cost };
    if (allocated && !manualShares) {
      data.shippingCost = plan.customerShare;
      data.vendorShippingCost = plan.vendorShare;
      data.artfestSubsidyAmount = plan.artfestShare;
    }
    const unchanged = Object.entries(data).every(([k, v]) => sameMoney(current[k], v));
    if (unchanged) return { changed: false, allocation, costBearer };

    await tx.shipmentDelivery.update({ where: { id: d.id }, data: { ...data, carrierCostUpdatedAt: at } });

    // audit pe AWB-ul curent (fără schemă nouă); fără AWB curent -> doar livrarea
    const awb = (d.shipment.courierAwbs || []).find((a) => a.awbNumber && a.awbNumber === d.shipment.awb);
    if (awb) {
      const meta = awb.providerMeta && typeof awb.providerMeta === "object" ? awb.providerMeta : {};
      const prev = Array.isArray(meta.returnCostAudit) ? meta.returnCostAudit : [];
      const entry = {
        at: at.toISOString(),
        source: src,
        actorId: actorId ? String(actorId) : null,
        costBearer,
        allocation,
        carrierCost: cost,
        before: Object.fromEntries(Object.entries(current).map(([k, v]) => [k, v === null || v === undefined ? null : String(v)])),
      };
      await tx.courierAwb.update({
        where: { id: awb.id },
        data: { providerMeta: { ...meta, returnCostAudit: [...prev, entry].slice(-RETURN_COST_AUDIT_MAX) } },
      });
    }
    return { changed: true, allocation, costBearer };
  });
}
