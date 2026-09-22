// backend/src/services/cardSaleLedger.js
//
// Ledger-ul CARD (VendorEarningEntry SALE) creat de webhook-ul Stripe la
// payment_intent.succeeded - UN SALE PER SHIPMENT OUTBOUND, cu shipmentId.
//
// De ce există: înainte, webhook-ul crea UN SALE per vendor cu
// shipmentId = null, iar la IN_TRANSIT/DELIVERED ensureSaleLedgerEntry
// (upsert pe shipmentId) crea încă un SALE pentru același shipment ->
// comisionul se factura de două ori. Unicitatea din schemă e doar pe
// shipmentId, deci acesta e singurul identificator de idempotență corect.
//
// Reguli (decise explicit):
//  - Transferul Stripe rămâne UNUL per vendor (neatins, în webhook).
//  - Totalul commissionNet al rândurilor unui vendor = EXACT
//    commissionNet calculat de computeOrderSplits pentru acel vendor
//    (ce factura deja webhook-ul). computeVendorEarningForShipment
//    (logica COD) e folosit DOAR ca pondere de distribuție între
//    shipment-uri, NU ca sumă - poate diferi cu ±0,01 (rotunjire per
//    shipment vs. per agregat) și la own-sale (computeOrderSplits nu
//    aplică vendorReferralCommissionOverrideBps). Diferența own-sale NU
//    se corectează aici.
//  - Ultimul shipment absoarbe reziduul de rotunjire.
//  - Shipment-urile direction = RETURN nu sunt niciodată vânzări.

/* =========================================================
   Aritmetică în bani (cenți întregi) - fără erori de virgulă mobilă
========================================================= */

function toCents(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function fromCents(cents) {
  return Math.round(cents) / 100;
}

function sum(values) {
  return values.reduce((total, v) => total + v, 0);
}

/**
 * Împarte `totalCents` proporțional cu `weights`. Toate rândurile în afară
 * de ultimul sunt rotunjite; ULTIMUL primește restul, deci suma e mereu
 * exact `totalCents`. Ponderi nule (sumă 0) -> împărțire egală.
 *
 * Ex.: total 241, ponderi [121, 121] -> [121, 120].
 */
export function allocateCentsByWeights(totalCents, weights) {
  const count = Array.isArray(weights) ? weights.length : 0;
  if (!count) return [];

  const total = Math.round(Number(totalCents) || 0);
  const sign = total < 0 ? -1 : 1;
  const absTotal = Math.abs(total);

  let safeWeights = weights.map((w) => Math.max(0, Number(w) || 0));
  if (!(sum(safeWeights) > 0)) {
    safeWeights = weights.map(() => 1);
  }

  const weightSum = sum(safeWeights);
  const out = [];
  let remaining = absTotal;

  for (let i = 0; i < count - 1; i += 1) {
    const share = Math.min(
      remaining,
      Math.round((absTotal * safeWeights[i]) / weightSum)
    );
    out.push(sign * share || 0);
    remaining -= share;
  }

  out.push(sign * remaining || 0);
  return out;
}

// Prima listă de ponderi cu sumă > 0; altfel ultima (allocate -> egal).
function pickWeights(...candidates) {
  return (
    candidates.find((w) => sum(w) > 0) || candidates[candidates.length - 1]
  );
}

/* =========================================================
   DISTRIBUȚIA totalului vendorului pe shipment-uri
========================================================= */

/**
 * @param {object} params
 * @param {object} params.payout  rândul vendorului din computeOrderSplits
 *   (după allocateStripeFee/computeVendorPayouts) - sursa TOTALURILOR.
 * @param {Array<{id: string, shippingGross: number, earning: object}>} params.shipments
 *   shipment-urile OUTBOUND ale vendorului, în ordine deterministă;
 *   `earning` = computeVendorEarningForShipment (DOAR pondere).
 * @returns {Array<object>} un element per shipment, în aceeași ordine.
 */
export function buildCardSaleAllocation({ payout, shipments }) {
  const count = Array.isArray(shipments) ? shipments.length : 0;

  if (!count) {
    throw new Error("card_sale_no_outbound_shipments");
  }

  // Ponderile din `earning` se folosesc doar dacă îl avem pe TOATE
  // shipment-urile - ponderi mixte (unele reale, unele 0) ar deforma
  // distribuția. Altfel toate cad pe fallback (transport, apoi egal).
  const useEarningWeights = shipments.every((s) => s.earning);

  const commissionW = shipments.map((s) =>
    useEarningWeights ? toCents(s.earning.commissionNet) : 0
  );
  const itemsW = shipments.map((s) =>
    useEarningWeights ? toCents(s.earning.itemsNet) : 0
  );
  const shippingW = shipments.map((s) => toCents(s.shippingGross));
  const grossW = shipments.map((_, i) => itemsW[i] + shippingW[i]);

  const wCommission = pickWeights(commissionW, itemsW, grossW);
  const wItems = pickWeights(itemsW, grossW);
  const wShipping = pickWeights(shippingW, grossW);
  const wGross = pickWeights(grossW, itemsW);

  const split = (total, weights) =>
    allocateCentsByWeights(toCents(total), weights);

  const itemsNet = split(payout.itemsNetExVat, wItems);
  const commissionNet = split(payout.commissionNet, wCommission);
  const subsidy = split(payout.platformSubsidyAmount, wCommission);
  const commissionBase = split(payout.commissionBase, wItems);
  const shippingNetExVat = split(payout.shippingNetExVat, wShipping);
  const shippingGross = split(payout.shippingGross, wShipping);
  const shippingVat = split(payout.shippingVat, wShipping);
  const itemsGross = split(payout.itemsGross, wItems);
  const itemsVat = split(payout.itemsVat, wItems);
  const gross = split(payout.gross, wGross);
  const stripeFee = split(payout.stripeFeeAllocated, wGross);

  // Garanție structurală: totalul comisionului distribuit = totalul
  // computeOrderSplits. Nu se poate abate prin construcție - verificăm
  // oricum, ca o eroare viitoare de refactorizare să nu factureze o sumă
  // greșită în tăcere.
  if (sum(commissionNet) !== toCents(payout.commissionNet)) {
    throw new Error("card_sale_commission_allocation_mismatch");
  }

  return shipments.map((s, i) => ({
    shipmentId: String(s.id),

    itemsNet: fromCents(itemsNet[i]),
    commissionNet: fromCents(commissionNet[i]),

    /*
     * vendorNet pe rândul legat de shipment = semantica COD (doar
     * produse: itemsNet - comision Artfest), pentru că rândul e citit
     * prin shipmentId de Order Details ("Net magazin" =
     * vendorNetBeforeShipping) și de fluxurile influencer/referral.
     * Suma efectiv transferată vendorului (produse + transport - taxa
     * Stripe) rămâne în meta.vendorPayoutNet / cardAllocation.
     */
    vendorNet: fromCents(itemsNet[i] - commissionNet[i]),

    shippingNetExVat: fromCents(shippingNetExVat[i]),
    shippingGross: fromCents(shippingGross[i]),
    shippingVat: fromCents(shippingVat[i]),
    itemsGross: fromCents(itemsGross[i]),
    itemsVat: fromCents(itemsVat[i]),
    gross: fromCents(gross[i]),
    stripeFeeAllocated: fromCents(stripeFee[i]),
    commissionBase: fromCents(commissionBase[i]),
    platformSubsidyAmount: fromCents(subsidy[i]),
    commissionAmount: fromCents(commissionNet[i] + subsidy[i]),

    computedCommissionNet:
      s.earning?.commissionNet != null
        ? Number(s.earning.commissionNet)
        : null,

    shipmentIndex: i,
    shipmentCount: count,
    isLast: i === count - 1,

    // true = ponderile au venit din fallback (computeEarning a eșuat)
    earningUnavailable: !useEarningWeights,

    earning: s.earning || null,
  }));
}

/* =========================================================
   META pe rând
========================================================= */

export function buildCardSaleEntryMeta({
  payout,
  row,
  orderId,
  paymentIntentId,
  chargeId,
  feeTotal,
}) {
  return {
    kind: "online_order_vendor_transfer",
    source: "stripe_order_payment",

    commissionSource: payout.commissionSource || "plan",
    campaignId: payout.campaignId || null,

    paymentIntentId: String(paymentIntentId),
    chargeId: String(chargeId),
    transferGroup: `order_${orderId}`,

    gross: row.gross,
    itemsGross: row.itemsGross,
    itemsNetExVat: row.itemsNet,
    itemsVat: row.itemsVat,
    shippingGross: row.shippingGross,
    shippingNetExVat: row.shippingNetExVat,
    shippingVat: row.shippingVat,

    // citit de dashboardurile de facturare (getShippingNetFromEntry)
    shippingNet: row.shippingNetExVat,

    stripeFeeAllocated: row.stripeFeeAllocated,
    stripeFeeTotal: Number(feeTotal || 0),

    commissionBps: Number(payout.commissionBps || 0),
    planCode: payout.planCode || null,
    planName: payout.planName || null,

    commissionBase: row.commissionBase,
    commissionAmount: row.commissionAmount,
    platformSubsidyAmount: row.platformSubsidyAmount,
    platformNet: row.commissionNet,
    itemsAfterDiscount: row.itemsNet,

    // fapte exacte despre itemii shipment-ului (nu depind de rata comisionului)
    ...(row.earning?.commissionBaseGross != null
      ? { commissionBaseGross: Number(row.earning.commissionBaseGross) }
      : {}),
    ...(row.earning?.platformDiscountGross != null
      ? { platformDiscountGross: Number(row.earning.platformDiscountGross) }
      : {}),
    ...(row.earning?.vendorDiscountGross != null
      ? { vendorDiscountGross: Number(row.earning.vendorDiscountGross) }
      : {}),

    // descriptori la nivel de vendor - descriu CUM s-a calculat suma
    isMixedCommission: Boolean(payout.isMixedCommission),
    commissionGroups: payout.commissionGroups || null,

    cardAllocation: {
      method: "proportional_to_shipment_earning_last_absorbs_rounding",
      shipmentIndex: row.shipmentIndex,
      shipmentCount: row.shipmentCount,
      isLast: row.isLast,
      vendorCommissionNet: Number(payout.commissionNet || 0),
      vendorPayoutNet: Number(payout.vendorPayoutNet || 0),
      shipmentComputedCommissionNet: row.computedCommissionNet,
      earningUnavailable: Boolean(row.earningUnavailable),
    },
  };
}

/* =========================================================
   DB
========================================================= */

/**
 * Shipment-urile OUTBOUND ale vendorului în comandă, ordine deterministă
 * (ultimul din această ordine absoarbe reziduul). RETURN e exclus.
 */
export async function loadOutboundShipmentsForVendor(
  db,
  { orderId, vendorId }
) {
  return db.shipment.findMany({
    where: {
      orderId: String(orderId),
      vendorId: String(vendorId),
      direction: "OUTBOUND",
    },
    select: { id: true, price: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

/**
 * Pasul de PLANIFICARE - doar citiri, fără efecte. Se rulează ÎNAINTE de
 * transferul Stripe, ca o problemă de date (ex. vendor fără shipment
 * OUTBOUND) să oprească handler-ul înainte să se miște bani.
 *
 * EXCEPȚIE deliberată: `computeEarning` (computeVendorEarningForShipment)
 * furnizează DOAR ponderi informative de distribuție - totalul vine din
 * computeOrderSplits. Dacă aruncă (ex. eroare tranzitorie de DB), NU are
 * voie să blocheze transferul Stripe: prindem eroarea, o logăm și folosim
 * `earning: null` -> ponderile cad pe itemi/transport (vezi
 * buildCardSaleAllocation). Catch-ul e STRICT în jurul acestui apel;
 * orice altă eroare (shipment-uri, alocare) se propagă ca înainte.
 */
export async function planCardSaleEntries({
  db,
  orderId,
  vendorId,
  payout,
  computeEarning,
}) {
  const shipments = await loadOutboundShipmentsForVendor(db, {
    orderId,
    vendorId,
  });

  if (!shipments.length) {
    throw new Error(`vendor_outbound_shipments_missing:${vendorId}`);
  }

  const enriched = [];

  for (const shipment of shipments) {
    let earning = null;

    try {
      earning = await computeEarning({
        vendorId: String(vendorId),
        shipmentId: shipment.id,
      });
    } catch (error) {
      console.error(
        "[cardSaleLedger] computeVendorEarningForShipment a eșuat - " +
          "ponderea de distribuție cade pe itemi/transport; transferul " +
          "Stripe NU este blocat, totalul rămâne cel din computeOrderSplits",
        {
          orderId: String(orderId),
          vendorId: String(vendorId),
          shipmentId: shipment.id,
          error: error?.message || String(error),
          stack: error?.stack,
        }
      );
    }

    enriched.push({
      id: shipment.id,
      shippingGross: Number(shipment.price || 0),
      earning,
    });
  }

  return buildCardSaleAllocation({ payout, shipments: enriched });
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Creează sau actualizează câte un SALE per shipment. Idempotență
 * PRINCIPALĂ = shipmentId (unic în schemă):
 *  - există deja SALE pentru shipment (creat de ensureSaleLedgerEntry sau
 *    de un apel anterior al webhook-ului) -> UPDATE, niciun create;
 *  - nu există -> create; dacă o cursă cu ensureSaleLedgerEntry l-a creat
 *    între timp (P2002 pe shipmentId) -> UPDATE pe rândul găsit.
 *
 * Un rând deja inclus într-o factură (payoutId != null) NU își mai
 * schimbă sumele - primește doar datele Stripe.
 */
export async function upsertCardSaleEntries({
  db,
  orderId,
  vendorId,
  allocation,
  transferId,
  currency,
  buildMeta,
}) {
  const results = [];

  for (const row of allocation) {
    const meta = buildMeta(row);

    const amounts = {
      itemsNet: row.itemsNet,
      commissionNet: row.commissionNet,
      vendorNet: row.vendorNet,
    };

    let existing = await db.vendorEarningEntry.findUnique({
      where: { shipmentId: row.shipmentId },
    });

    if (!existing) {
      try {
        const created = await db.vendorEarningEntry.create({
          data: {
            vendorId: String(vendorId),
            orderId: String(orderId),
            shipmentId: row.shipmentId,
            type: "SALE",
            currency,
            ...amounts,
            stripeTransferId: String(transferId),
            meta,
          },
        });

        results.push({
          shipmentId: row.shipmentId,
          entryId: created.id,
          action: "created",
        });

        continue;
      } catch (error) {
        if (error?.code !== "P2002") throw error;

        existing = await db.vendorEarningEntry.findUnique({
          where: { shipmentId: row.shipmentId },
        });

        if (!existing) throw error;
      }
    }

    if (existing.type !== "SALE") {
      throw new Error(`ledger_entry_not_sale:${existing.id}`);
    }

    const existingMeta = isPlainObject(existing.meta) ? existing.meta : {};
    const invoiced = existing.payoutId != null;

    const data = { stripeTransferId: String(transferId) };

    if (invoiced) {
      data.meta = {
        ...existingMeta,
        paymentIntentId: meta.paymentIntentId,
        chargeId: meta.chargeId,
        transferGroup: meta.transferGroup,
      };
    } else {
      Object.assign(data, amounts);
      data.meta = {
        ...existingMeta,
        ...meta,
        // păstrăm proveniența originală (ex. shipment_status_fulfilled)
        source: existingMeta.source ?? meta.source,
      };
    }

    await db.vendorEarningEntry.update({
      where: { id: existing.id },
      data,
    });

    results.push({
      shipmentId: row.shipmentId,
      entryId: existing.id,
      action: invoiced ? "updated_stripe_only" : "updated",
    });
  }

  return results;
}
