// backend/src/services/withdrawalService.js
//
// Funcția online de retragere din contract (Returns v2 §4.3, OUG 34/2014).
//
// Folosește STRICT modelul existent WithdrawalRequest (fără schimbări de
// schemă) - distinct de ReturnRequest (retur/neconformitate).
//
// Logica e comună pentru Client autentificat (userWithdrawalRoutes) și
// pentru guest (token de acces al comenzii, guestWithdrawalRoutes).
//
// Ce garantează:
//  - declarația transmisă e păstrată EXACT (declarationText) + momentul
//    transmiterii (submittedAt) + IP/User-Agent ca dovadă tehnică;
//  - confirmarea pe suport durabil (email) e trimisă DUPĂ salvare -
//    eșecul emailului NU pierde declarația (confirmationSentAt rămâne
//    null și e raportat);
//  - Vânzătorii vizați sunt notificați (in-app + email), iar
//    notifiedVendorIds / forwardedToVendorAt / status reflectă asta;
//  - nu se acceptă o a doua declarație pentru aceleași livrări.
//
// Nu blochează pe motive de TERMEN: momentul transmiterii e înregistrat,
// iar evaluarea termenului/excepțiilor legale rămâne la Vânzător (termenul
// se poate prelungi legal dacă informarea nu a fost făcută).

import crypto from "crypto";
import { prisma } from "../db.js";
import { createVendorNotification } from "./notifications.js";
import {
  sendWithdrawalConfirmationEmail,
  sendWithdrawalForwardedToVendorEmail,
} from "../lib/mailer.js";

export const WITHDRAWAL_PERIOD_DAYS = 14;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/*
 * Select comun pentru încărcarea comenzii (user + guest).
 */
export const withdrawalOrderSelect = {
  id: true,
  orderNumber: true,
  status: true,
  customerType: true,
  customerName: true,
  customerEmail: true,
  userId: true,
  isGuestOrder: true,
  shippingAddress: true,
  createdAt: true,
  shipments: {
    select: {
      id: true,
      vendorId: true,
      status: true,
      direction: true,
      deliveredAt: true,
      vendor: {
        select: {
          id: true,
          displayName: true,
          email: true,
          user: { select: { email: true } },
          billing: { select: { traderStatus: true } },
        },
      },
      items: {
        select: {
          title: true,
          qty: true,

          /*
           * Strict pentru avertismentul de personalizare (Returns v2
           * §4.3 + excepția legală pentru bunuri personalizate) - NU
           * pentru blocare, doar informativ. Date deja existente pe
           * ShipmentItem (snapshot real al comenzii), fără schimbare
           * de schemă.
           */
          customAnswers: true,
          selectedOptions: true,
          configurationKey: true,
        },
      },
    },
  },
  withdrawalRequests: {
    select: {
      id: true,
      shipmentIds: true,
      status: true,
      submittedAt: true,
    },
    orderBy: { submittedAt: "desc" },
  },
};

/*
 * Un item "arată" personalizat dacă are o configurație non-implicită
 * sau răspunsuri/opțiuni completate de client - semnal informativ,
 * NU o regulă legală definitivă (evaluarea excepției rămâne la
 * Vânzător, ca și la termen - vezi comentariul de mai jos).
 */
function hasObjectContent(value) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length > 0
  );
}

function itemLooksCustomized(item) {
  return Boolean(
    (item.configurationKey && item.configurationKey !== "default") ||
      hasObjectContent(item.customAnswers) ||
      hasObjectContent(item.selectedOptions)
  );
}

export function hashGuestToken(token) {
  return crypto
    .createHash("sha256")
    .update(String(token || ""))
    .digest("hex");
}

export async function findUserOrderForWithdrawal({ userId, reference }) {
  const ref = String(reference || "").trim();
  if (!userId || !ref) return null;

  return prisma.order.findFirst({
    relationLoadStrategy: "query",
    where: {
      userId,
      OR: [{ id: ref }, { orderNumber: ref }],
    },
    select: withdrawalOrderSelect,
  });
}

/*
 * Aceeași regulă de acces ca la GET /api/guest/orders/:id?token=
 * (guestAccessTokenHash + expirare), fără depositToken - retragerea
 * cere tokenul normal al comenzii.
 */
export async function findGuestOrderForWithdrawal({ reference, token }) {
  const ref = String(reference || "").trim();
  const normalizedToken = String(token || "").trim();
  if (!ref || !normalizedToken) return null;

  return prisma.order.findFirst({
    relationLoadStrategy: "query",
    where: {
      isGuestOrder: true,
      userId: null,
      guestAccessTokenHash: hashGuestToken(normalizedToken),
      AND: [
        { OR: [{ id: ref }, { orderNumber: ref }] },
        {
          OR: [
            { guestAccessExpiresAt: null },
            { guestAccessExpiresAt: { gt: new Date() } },
          ],
        },
      ],
    },
    select: withdrawalOrderSelect,
  });
}

/* ----------------------------------------------------
   Eligibilitate
----------------------------------------------------- */

function outboundShipments(order) {
  return (order.shipments || []).filter(
    (shipment) => shipment.direction !== "RETURN"
  );
}

/*
 * Set de shipment-uri deja acoperite de o declarație existentă
 * (shipmentIds gol = întreaga Comandă).
 */
function coveredShipmentIds(order) {
  const all = outboundShipments(order).map((s) => s.id);
  const covered = new Set();

  for (const request of order.withdrawalRequests || []) {
    const ids =
      Array.isArray(request.shipmentIds) && request.shipmentIds.length
        ? request.shipmentIds
        : all;

    for (const id of ids) covered.add(id);
  }

  return covered;
}

/*
 * Ce livrări pot face obiectul retragerii ONLINE și de ce nu:
 *  - not_consumer: Clientul e persoană juridică (dreptul de retragere
 *    OUG 34/2014 e al consumatorului);
 *  - order_cancelled / shipment_cancelled: nu mai există ce retrage;
 *  - non_professional_seller: Vânzătorul s-a declarat neprofesionist
 *    (vezi VendorBilling.traderStatus) - dreptul specific contractelor
 *    cu profesioniști nu se aplică; declarația nu ar produce efecte;
 *  - already_submitted: există deja o declarație pentru livrare.
 * traderStatus necunoscut (NULL) = tratat ca aplicabil (protejăm
 * Clientul până la clarificarea statusului).
 */
export function evaluateWithdrawalEligibility(order) {
  const isBusinessCustomer = order.customerType === "PJ";
  const orderCancelled = order.status === "CANCELLED";
  const covered = coveredShipmentIds(order);
  const now = Date.now();

  const shipments = outboundShipments(order).map((shipment) => {
    const traderStatus =
      shipment.vendor?.billing?.traderStatus || null;

    let reason = null;

    if (isBusinessCustomer) {
      reason = "not_consumer";
    } else if (orderCancelled) {
      reason = "order_cancelled";
    } else if (["REFUSED", "RETURNED"].includes(shipment.status)) {
      reason = "shipment_cancelled";
    } else if (traderStatus === "NON_PROFESSIONAL") {
      reason = "non_professional_seller";
    } else if (covered.has(shipment.id)) {
      reason = "already_submitted";
    }

    const deliveredAt = shipment.deliveredAt
      ? new Date(shipment.deliveredAt)
      : null;

    const withinStandardPeriod = deliveredAt
      ? now - deliveredAt.getTime() <=
        WITHDRAWAL_PERIOD_DAYS * 24 * 60 * 60 * 1000
      : true;

    return {
      id: shipment.id,
      vendorId: shipment.vendorId,
      vendorName: shipment.vendor?.displayName || "Vânzător",
      status: shipment.status,
      deliveredAt: shipment.deliveredAt || null,
      withinStandardPeriod,
      eligible: reason === null,
      reason,

      /*
       * Informativ, NU blocant - vezi itemLooksCustomized. Eligibilitatea
       * (`eligible`/`reason` de mai sus) NU e afectată de acest flag.
       */
      hasCustomItems: (shipment.items || []).some(itemLooksCustomized),

      items: (shipment.items || []).map((item) => ({
        title: item.title,
        qty: item.qty,
      })),
    };
  });

  return {
    eligible: shipments.some((s) => s.eligible),
    shipments,
  };
}

export function buildWithdrawalStatusPayload(order) {
  const eligibility = evaluateWithdrawalEligibility(order);

  const defaultAddress =
    order.shippingAddress && typeof order.shippingAddress === "object"
      ? order.shippingAddress
      : {};

  return {
    ok: true,
    order: {
      id: order.id,
      orderNumber: order.orderNumber,
    },
    periodDays: WITHDRAWAL_PERIOD_DAYS,
    eligible: eligibility.eligible,

    /*
     * Agregat, pentru un avertisment simplu în UI fără să iterăm
     * shipment-urile - true dacă ORICARE shipment eligibil conține
     * produse ce arată personalizate. Informativ, NU blocant.
     */
    hasCustomItems: eligibility.shipments.some(
      (s) => s.eligible && s.hasCustomItems
    ),

    shipments: eligibility.shipments,
    existing: (order.withdrawalRequests || []).map((request) => ({
      id: request.id,
      status: request.status,
      submittedAt: request.submittedAt,
      shipmentIds: request.shipmentIds || [],
    })),
    prefill: {
      clientName:
        order.customerName || defaultAddress.name || "",
      contactEmail:
        order.customerEmail || defaultAddress.email || "",
    },
  };
}

/* ----------------------------------------------------
   Declarația (text canonic, salvat ca dovadă)
----------------------------------------------------- */

function formatDeclarationDateTime(value) {
  try {
    return new Intl.DateTimeFormat("ro-RO", {
      dateStyle: "long",
      timeStyle: "medium",
      timeZone: "Europe/Bucharest",
    }).format(new Date(value));
  } catch {
    return new Date(value).toISOString();
  }
}

function buildDeclarationText({
  clientName,
  contactEmail,
  orderNumber,
  fullOrder,
  shipments,
  submittedAt,
}) {
  const scope = fullOrder
    ? "pentru întreaga Comandă"
    : `numai pentru: ${shipments
        .map((shipment) => {
          const titles = shipment.items
            .map((item) => `${item.title} x${item.qty}`)
            .join(", ");
          return `${shipment.vendorName}${titles ? ` (${titles})` : ""}`;
        })
        .join("; ")}`;

  return [
    `Subsemnatul/Subsemnata ${clientName}, prin prezenta declar că mă retrag din contractul la distanță încheiat prin Artfest, referitor la Comanda #${orderNumber}, ${scope}.`,
    `Adresa de e-mail la care solicit confirmarea: ${contactEmail}.`,
    `Declarație transmisă electronic prin funcția online de retragere Artfest la data de ${formatDeclarationDateTime(
      submittedAt
    )}.`,
  ].join("\n");
}

/* ----------------------------------------------------
   Transmitere
----------------------------------------------------- */

export class WithdrawalError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.name = "WithdrawalError";
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

const REASON_MESSAGES = {
  not_consumer:
    "Dreptul legal de retragere fără motiv se aplică consumatorilor (persoane fizice). Pentru comenzile persoanelor juridice, te rugăm să contactezi Vânzătorul.",
  order_cancelled: "Comanda este deja anulată.",
  shipment_cancelled:
    "Livrarea selectată este deja anulată sau returnată.",
  non_professional_seller:
    "Vânzătorul s-a declarat neprofesionist, iar dreptul de retragere specific contractelor cu profesioniști nu se aplică acestei comenzi. Poți contacta Vânzătorul direct.",
  already_submitted:
    "Ai transmis deja o declarație de retragere pentru această comandă.",
};

export async function submitWithdrawal({
  order,
  clientName,
  contactEmail,
  shipmentIds,
  confirmed,
  ip,
  userAgent,
  userId = null,
}) {
  const name = String(clientName || "").trim();
  const email = String(contactEmail || "").trim().toLowerCase();

  if (confirmed !== true) {
    throw new WithdrawalError(
      400,
      "confirmation_required",
      "Confirmă retragerea înainte de transmitere."
    );
  }

  if (name.length < 2 || name.length > 160) {
    throw new WithdrawalError(
      400,
      "client_name_invalid",
      "Te rugăm să completezi numele."
    );
  }

  if (!EMAIL_RE.test(email) || email.length > 320) {
    throw new WithdrawalError(
      400,
      "contact_email_invalid",
      "Te rugăm să completezi o adresă de e-mail validă pentru confirmare."
    );
  }

  const eligibility = evaluateWithdrawalEligibility(order);
  const byId = new Map(eligibility.shipments.map((s) => [s.id, s]));

  const requestedIds =
    Array.isArray(shipmentIds) && shipmentIds.length
      ? [...new Set(shipmentIds.map(String))]
      : eligibility.shipments.filter((s) => s.eligible).map((s) => s.id);

  if (!requestedIds.length) {
    const firstReason = eligibility.shipments[0]?.reason;
    throw new WithdrawalError(
      409,
      firstReason || "not_eligible",
      REASON_MESSAGES[firstReason] ||
        "Pentru această comandă nu se poate transmite o declarație de retragere online."
    );
  }

  for (const id of requestedIds) {
    const shipment = byId.get(id);

    if (!shipment) {
      throw new WithdrawalError(
        400,
        "shipment_not_in_order",
        "Una dintre livrările selectate nu aparține acestei comenzi."
      );
    }

    if (!shipment.eligible) {
      throw new WithdrawalError(
        409,
        shipment.reason,
        REASON_MESSAGES[shipment.reason] ||
          "Livrarea selectată nu poate face obiectul retragerii online."
      );
    }
  }

  const allOutboundIds = eligibility.shipments.map((s) => s.id);
  const coversWholeOrder =
    requestedIds.length === allOutboundIds.length &&
    allOutboundIds.every((id) => requestedIds.includes(id));

  const selected = requestedIds.map((id) => byId.get(id));
  const submittedAt = new Date();

  const declarationText = buildDeclarationText({
    clientName: name,
    contactEmail: email,
    orderNumber: order.orderNumber || order.id,
    fullOrder: coversWholeOrder,
    shipments: selected,
    submittedAt,
  });

  /*
   * Verificare + creare în aceeași tranzacție (Serializable): două
   * transmiteri simultane (dublu-click) pentru aceleași livrări nu pot
   * crea două declarații.
   */
  let created;

  try {
    created = await prisma.$transaction(
      async (tx) => {
        const existing = await tx.withdrawalRequest.findMany({
          where: { orderId: order.id },
          select: { shipmentIds: true },
        });

        const covered = new Set();
        for (const request of existing) {
          const ids = request.shipmentIds?.length
            ? request.shipmentIds
            : allOutboundIds;
          for (const id of ids) covered.add(id);
        }

        if (requestedIds.some((id) => covered.has(id))) {
          throw new WithdrawalError(
            409,
            "already_submitted",
            REASON_MESSAGES.already_submitted
          );
        }

        return tx.withdrawalRequest.create({
          data: {
            orderId: order.id,
            userId: userId || null,
            shipmentIds: coversWholeOrder ? [] : requestedIds,
            clientName: name,
            contactEmail: email,
            declarationText,
            submittedAt,
            ip: ip ? String(ip).slice(0, 64) : null,
            userAgent: userAgent
              ? String(userAgent).slice(0, 500)
              : null,
          },
        });
      },
      { isolationLevel: "Serializable" }
    );
  } catch (error) {
    if (error instanceof WithdrawalError) throw error;

    // Conflict de serializare = altă transmitere concurentă.
    if (error?.code === "P2034") {
      throw new WithdrawalError(
        409,
        "already_submitted",
        REASON_MESSAGES.already_submitted
      );
    }

    throw error;
  }

  /*
   * De aici declarația e SALVATĂ. Orice eșec de notificare/email se
   * loghează și se raportează, dar nu anulează retragerea.
   */
  let confirmationSent = false;

  try {
    await sendWithdrawalConfirmationEmail({
      to: email,
      clientName: name,
      orderNumber: order.orderNumber || order.id,
      declarationText,
      submittedAt,
      userId: userId || null,
      orderId: order.id,
    });

    await prisma.withdrawalRequest.update({
      where: { id: created.id },
      data: { confirmationSentAt: new Date() },
    });

    confirmationSent = true;
  } catch (error) {
    console.error(
      "withdrawal confirmation email failed:",
      created.id,
      error
    );
  }

  const notifiedVendorIds = [];
  const vendorsById = new Map();

  for (const shipment of order.shipments || []) {
    if (requestedIds.includes(shipment.id) && shipment.vendor) {
      vendorsById.set(shipment.vendor.id, shipment.vendor);
    }
  }

  for (const vendor of vendorsById.values()) {
    let notified = false;

    try {
      await createVendorNotification(vendor.id, {
        dedupeKey: `vendor_withdrawal:${created.id}:${vendor.id}`,
        type: "order",
        title: `Retragere din contract - comanda #${
          order.orderNumber || order.id
        }`,
        body: `Clientul ${name} a transmis o declarație de retragere din contract. Verifică detaliile și procesează retragerea conform Politicii de retur.`,
        link: `/vendor/orders/${order.id}`,
        meta: {
          kind: "withdrawal_requested",
          withdrawalRequestId: created.id,
          orderId: order.id,
          vendorId: vendor.id,
        },
      });
      notified = true;
    } catch (error) {
      console.error(
        "withdrawal vendor notification failed:",
        created.id,
        vendor.id,
        error
      );
    }

    const vendorEmail = vendor.email || vendor.user?.email || null;

    if (vendorEmail) {
      try {
        await sendWithdrawalForwardedToVendorEmail({
          to: vendorEmail,
          vendorName: vendor.displayName,
          clientName: name,
          contactEmail: email,
          orderNumber: order.orderNumber || order.id,
          declarationText,
          submittedAt,
          orderId: order.id,
        });
        notified = true;
      } catch (error) {
        console.error(
          "withdrawal vendor email failed:",
          created.id,
          vendor.id,
          error
        );
      }
    }

    if (notified) notifiedVendorIds.push(vendor.id);
  }

  let status = created.status;
  let forwardedToVendorAt = null;

  if (notifiedVendorIds.length) {
    forwardedToVendorAt = new Date();
    status = "FORWARDED_TO_VENDOR";

    try {
      await prisma.withdrawalRequest.update({
        where: { id: created.id },
        data: {
          notifiedVendorIds,
          forwardedToVendorAt,
          status,
        },
      });
    } catch (error) {
      console.error(
        "withdrawal forward status update failed:",
        created.id,
        error
      );
    }
  }

  return {
    id: created.id,
    status,
    submittedAt,
    declarationText,
    clientName: name,
    contactEmail: email,
    shipmentIds: coversWholeOrder ? [] : requestedIds,
    confirmationSent,
    forwardedToVendor: notifiedVendorIds.length > 0,
  };
}

/* ----------------------------------------------------
   Vizibilitate + acțiuni VENDOR (audit „Retragere din contract”,
   2026-09-23) - NU modifică Order/Shipment/depositStatus, NICIODATĂ.
   Închiderea cererii (WithdrawalRequest.status -> CLOSED) e o
   acțiune STRICT administrativă asupra declarației în sine.
----------------------------------------------------- */

/*
 * Toate declarațiile ale căror shipmentIds ating shipment-urile
 * ACESTUI vendor, dintr-o comandă - folosit de GET /api/vendor/orders/:id
 * ca să afișeze secțiunea persistentă (audit, punctul 4/5).
 */
export function withdrawalRequestsForVendor({ order, vendorId }) {
  const vendorShipmentIds = new Set(
    (order.shipments || [])
      .filter((s) => String(s.vendorId) === String(vendorId))
      .map((s) => s.id)
  );

  return (order.withdrawalRequests || [])
    .filter((request) => {
      const ids = request.shipmentIds || [];
      // gol = comandă întreagă -> atinge orice shipment, inclusiv al
      // acestui vendor.
      if (!ids.length) return true;
      return ids.some((id) => vendorShipmentIds.has(id));
    })
    .map((request) => ({
      id: request.id,
      status: request.status,
      submittedAt: request.submittedAt,
      clientName: request.clientName,
      contactEmail: request.contactEmail,
      declarationText: request.declarationText,
      shipmentIds: request.shipmentIds || [],
      coversWholeOrder: !(request.shipmentIds || []).length,
    }));
}

/*
 * Un shipment "acoperă unic" o declarație dacă acea declarație NU
 * poate privi și alt shipment (alt vendor) din aceeași comandă -
 * condiție pentru auto-close SIGUR (punctul 6, cerut explicit: "dacă
 * există cazuri ambigue multi-vendor, nu ghici").
 */
function coversExactlyOneShipment({ request, shipmentId, totalOutboundCount }) {
  const ids = request.shipmentIds || [];

  if (ids.length === 1 && ids[0] === shipmentId) {
    return true;
  }

  // gol = "întreaga Comandă" - neambiguu STRICT dacă acea comandă are
  // un singur shipment în total (altfel ar acoperi și alți vendori).
  if (!ids.length && totalOutboundCount === 1) {
    return true;
  }

  return false;
}

/*
 * Apelată de ruta de anulare vendor DUPĂ ce anularea shipment-ului a
 * reușit efectiv (nu înainte, nu condițional). Închide DOAR
 * declarațiile care priveau STRICT acest shipment, fără ambiguitate -
 * orice caz cu mai multe shipment-uri implicate rămâne neatins,
 * pentru "Marchează procesată" manual.
 */
export async function autoCloseUnambiguousWithdrawalRequests({
  orderId,
  shipmentId,
  prisma: db = prisma,
}) {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      shipments: {
        select: { id: true, direction: true },
      },
      withdrawalRequests: {
        where: { status: { in: ["SUBMITTED", "FORWARDED_TO_VENDOR"] } },
        select: { id: true, shipmentIds: true },
      },
    },
  });

  if (!order) return [];

  const totalOutboundCount = (order.shipments || []).filter(
    (s) => s.direction !== "RETURN"
  ).length;

  const closedIds = [];

  for (const request of order.withdrawalRequests || []) {
    if (
      !coversExactlyOneShipment({
        request,
        shipmentId,
        totalOutboundCount,
      })
    ) {
      continue;
    }

    const updated = await db.withdrawalRequest.updateMany({
      where: {
        id: request.id,
        status: { in: ["SUBMITTED", "FORWARDED_TO_VENDOR"] },
      },
      data: { status: "CLOSED" },
    });

    if (updated.count === 1) closedIds.push(request.id);
  }

  return closedIds;
}

/*
 * Acțiune manuală "Marchează procesată" (punctul 5, cerut explicit) -
 * DOAR vendorul căruia îi aparține un shipment atins de declarație
 * poate face asta. NU schimbă Order/Shipment/depositStatus.
 */
export async function closeWithdrawalRequestForVendor({
  withdrawalRequestId,
  vendorId,
  prisma: db = prisma,
}) {
  const request = await db.withdrawalRequest.findUnique({
    where: { id: withdrawalRequestId },
    select: {
      id: true,
      orderId: true,
      shipmentIds: true,
      status: true,
      order: {
        select: {
          shipments: { select: { id: true, vendorId: true } },
        },
      },
    },
  });

  if (!request) {
    throw new WithdrawalError(404, "not_found", "Cererea nu a fost găsită.");
  }

  const vendorShipmentIds = new Set(
    (request.order?.shipments || [])
      .filter((s) => String(s.vendorId) === String(vendorId))
      .map((s) => s.id)
  );

  const ids = request.shipmentIds || [];
  const covers = !ids.length || ids.some((id) => vendorShipmentIds.has(id));

  if (!covers) {
    throw new WithdrawalError(
      403,
      "not_your_shipment",
      "Această cerere de retragere nu privește o livrare a ta."
    );
  }

  const updated = await db.withdrawalRequest.update({
    where: { id: withdrawalRequestId },
    data: { status: "CLOSED" },
  });

  return {
    id: updated.id,
    status: updated.status,
  };
}
