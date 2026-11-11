// src/payments/orchestrator.js
import { prisma } from "../db.js";
import { stripe } from "../lib/stripe.js";
import {
  DepositPaymentBlockedError,
  getDepositBlockReason,
} from "./depositGuards.js";
import {
  assertOrderCardPaymentAllowed,
  CardPaymentUnavailableError,
  isVendorStripeReady,
} from "./vendorStripeStatus.js";
import {
  CARD_PAYMENT_RETRY_CUTOFF_MS,
  cardPaymentDeadline,
  closeOrderPaymentSessions,
  sessionExpiresAt,
} from "../services/cardPaymentExpiry.js";
import { getOrderPaymentBlockReason } from "../services/orderPaymentGuards.js";

// refuzuri de plată noi: același tip de eroare pe care îl tratează deja toți apelanții
function paymentRefused(code, message) {
  const error = new CardPaymentUnavailableError(code, message);
  error.status = 409;
  return error;
}

/*
 * Regula de expirare CARD (services/cardPaymentExpiry.js), doar când e
 * activă pentru comandă: după termen - și în ultimele
 * CARD_PAYMENT_RETRY_CUTOFF_MS dinaintea lui, când orice sesiune nouă ar
 * trăi (minimul Stripe de 30 min) după termen - nu se mai creează sesiuni;
 * înainte de o sesiune nouă se închid toate sesiunile anterioare ale
 * comenzii, fără să atingem o plată reușită sau în curs.
 * @returns termenul comenzii (Date) sau null dacă regula nu se aplică
 */
async function prepareCardPaymentWindow(order, now) {
  const deadline = cardPaymentDeadline(order);
  if (!deadline) return null;

  if (now >= deadline) {
    throw paymentRefused(
      "card_payment_expired",
      "Termenul de plată pentru această comandă a expirat. Te rugăm să plasezi o comandă nouă."
    );
  }

  if (deadline.getTime() - now.getTime() < CARD_PAYMENT_RETRY_CUTOFF_MS) {
    throw paymentRefused(
      "card_payment_window_closing",
      "Comanda expiră în mai puțin de 30 de minute, așa că nu mai putem deschide o plată nouă. Te rugăm să plasezi o comandă nouă."
    );
  }

  const previous = await closeOrderPaymentSessions({ order, stripe });
  if (previous.state === "paid") {
    throw paymentRefused("order_already_paid", "Această comandă este deja plătită.");
  }
  if (previous.state !== "closed") {
    throw paymentRefused(
      "card_payment_in_progress",
      "O plată pentru această comandă este încă în curs de procesare. Te rugăm să verifici comanda peste câteva minute."
    );
  }

  return deadline;
}

function getAppUrl() {
  return (process.env.APP_URL || process.env.FRONTEND_URL || "").replace(/\/+$/, "");
}

export async function createPaymentForOrder(
  order
) {
  /*
   * Protecție centrală, obligatorie pentru ORICE flux care
   * inițiază o plată integrală CARD (creare comandă, retry
   * payment, accept ofertă din assistant): nu presupunem că
   * starea Stripe de la un moment anterior mai e valabilă -
   * reverificăm vendorii comenzii chiar înainte de Stripe.
   */
  await assertOrderCardPaymentAllowed(
    order.id
  );

  const appUrl =
    getAppUrl();

  if (!appUrl) {
    throw new Error(
      "APP_URL/FRONTEND_URL missing"
    );
  }

  const amountCents =
    Math.round(
      Number(
        order.total || 0
      ) * 100
    );

  if (
    !Number.isFinite(
      amountCents
    ) ||
    amountCents <= 0
  ) {
    throw new Error(
      "invalid_order_total"
    );
  }

  const address =
    order.shippingAddress ||
    {};

  const currency =
    String(
      order.currency ||
        "RON"
    ).toLowerCase();

  /*
   * Comandă guest dacă:
   * - isGuestOrder === true
   * sau
   * - nu există userId
   */
  const isGuestOrder =
    order.isGuestOrder === true ||
    !order.userId;

  /*
   * Pentru guest avem nevoie de tokenul
   * public de acces.
   *
   * IMPORTANT:
   * în DB avem doar HASH-ul tokenului,
   * deci tokenul original NU poate fi
   * reconstruit aici.
   *
   * De aceea ruta guest trebuie să trimită
   * guestAccessToken către această funcție.
   */
  const guestAccessToken =
    order.guestAccessToken ||
    null;

  /*
   * Acces alternativ prin `guestReturnToken` (ex.: paymentToken
   * din reminder-ul de plată neterminată, guestPaymentReminderJob.js).
   *
   * IMPORTANT: dacă accesul comenzii s-a făcut printr-un token care
   * NU este guestAccessToken original (deci nu poate fi reconstruit
   * din hash), ruta guest trebuie să trimită aici tokenul CU care a
   * fost accesată comanda (`guestReturnToken`) + numele parametrului
   * de query corespunzător (`guestReturnTokenParam`, implicit
   * "token"), ca succes/cancel URL să rămână valabile cu ACEL token,
   * nu cu unul reconstruit greșit.
   *
   * Dacă `guestReturnToken` nu e trimis, comportamentul e IDENTIC cu
   * înainte (fallback pe guestAccessToken + "token") - niciun apelant
   * existent (chekoutRoutes.js, userOrdersRoutes.js,
   * assistantQuotesRoutes.js) nu e afectat.
   */
  const guestReturnToken =
    order.guestReturnToken ||
    guestAccessToken ||
    null;

  const guestReturnTokenParam =
    order.guestReturnToken
      ? (
          order.guestReturnTokenParam ||
          "token"
        )
      : "token";

  /*
   * O comandă cu o livrare deja anulată nu mai poate fi plătită valid
   * (webhook-ul ar rambursa plata - getOrderPaymentBlockReason): nu mai
   * deschidem o plată.
   */
  const shipmentStates = await prisma.shipment.findMany({
    where: { orderId: order.id },
    select: { status: true, direction: true },
  });
  if (getOrderPaymentBlockReason({ order: { status: order.status, shipments: shipmentStates } })) {
    throw paymentRefused(
      "order_not_payable",
      "Această comandă nu mai poate fi achitată în starea actuală."
    );
  }

  const now = new Date();
  const deadline = await prepareCardPaymentWindow(order, now);

  let successUrl;
  let cancelUrl;

 if (
  isGuestOrder &&
  !guestReturnToken
) {
  throw new Error(
    "guest_access_token_missing"
  );
}

  /*
   * Succes (user și guest): pagina de confirmare /multumim - singura
   * care raportează achiziția (GA4 / Google Ads / Meta), o singură dată
   * per comandă și DOAR după ce backend-ul confirmă plata (PAID/paidAt).
   * Anularea rămâne pe pagina comenzii, unde există „Achită acum”.
   */
if (isGuestOrder)  {
    /*
     * Guest: tokenul de acces (sau paymentToken-ul din reminder) merge
     * mai departe, ca /multumim să poată citi comanda fără cont.
     */
    successUrl =
      `${appUrl}/multumim` +
      `?order=${encodeURIComponent(
        order.id
      )}` +
      `&${guestReturnTokenParam}=${encodeURIComponent(
        guestReturnToken
      )}` +
      `&payment=success`;

    cancelUrl =
      `${appUrl}/comanda-guest/${encodeURIComponent(
        order.id
      )}` +
      `?${guestReturnTokenParam}=${encodeURIComponent(
        guestReturnToken
      )}` +
      `&payment=cancelled`;
  } else {
    /*
     * User autentificat.
     */
    successUrl =
      `${appUrl}/multumim` +
      `?order=${encodeURIComponent(
        order.id
      )}` +
      `&payment=success`;

    cancelUrl =
      `${appUrl}/comanda/${encodeURIComponent(
        order.id
      )}` +
      `?payment=cancelled`;
  }

  const session =
    await stripe.checkout.sessions.create({
      mode:
        "payment",

      payment_method_types: [
        "card",
      ],

      customer_email:
        address.email ||
        order.customerEmail ||
        undefined,

      line_items: [
        {
          quantity:
            1,

          price_data: {
            currency,

            unit_amount:
              amountCents,

            product_data: {
              name:
                `Comandă ${
                  order.orderNumber ||
                  order.id
                }`,
            },
          },
        },
      ],

      success_url:
        successUrl,

      cancel_url:
        cancelUrl,

      // regula de expirare activă: sesiunea nu trăiește necontrolat după termenul comenzii
      ...(deadline
        ? {
            expires_at:
              sessionExpiresAt(deadline, now),
          }
        : {}),

      metadata: {
        kind:
          "order_payment",

        orderId:
          String(
            order.id
          ),

        orderNumber:
          String(
            order.orderNumber ||
              ""
          ),

        isGuestOrder:
          isGuestOrder
            ? "true"
            : "false",
      },

      payment_intent_data: {
        transfer_group:
          `order_${order.id}`,

        metadata: {
          kind:
            "order_payment",

          orderId:
            String(
              order.id
            ),

          orderNumber:
            String(
              order.orderNumber ||
                ""
            ),

          isGuestOrder:
            isGuestOrder
              ? "true"
              : "false",
        },
      },
    });

  /*
   * Salvare CONDIȚIONATĂ: doar dacă comanda e încă neplătită și activă.
   * Dacă între timp a fost anulată / expirată / plătită, sesiunea abia
   * creată se expiră imediat și plata e refuzată.
   */
  const saved = await prisma.order.updateMany({
    where: {
      id:
        order.id,
      status:
        "PENDING",
      paidAt:
        null,
    },

    data: {
      stripeCheckoutSessionId:
        session.id,
    },
  });

  if (saved.count !== 1) {
    try {
      await stripe.checkout.sessions.expire(session.id);
    } catch (error) {
      console.warn(
        "[payments] expire session after order change failed:",
        session.id,
        error?.message || error
      );
    }
    throw paymentRefused(
      "order_not_payable",
      "Această comandă nu mai poate fi achitată în starea actuală."
    );
  }

  return {
    provider:
      "stripe",

    checkoutSessionId:
      session.id,

    /*
     * Checkout.jsx-ul tău caută
     * result.payment.redirectUrl.
     */
    redirectUrl:
      session.url,

    /*
     * Îl păstrăm și pentru
     * compatibilitate cu cod mai vechi.
     */
    url:
      session.url,
  };
}

export async function createDepositPaymentForShipment({
  shipmentId,
}) {
  const appUrl = getAppUrl();

  if (!appUrl) {
    throw new Error(
      "APP_URL/FRONTEND_URL missing"
    );
  }

  const shipment =
    await prisma.shipment.findUnique({
      where: {
        id: shipmentId,
      },

      include: {
        order: true,

        vendor: {
          select: {
            id: true,
            stripeAccountId: true,
            stripeChargesEnabled: true,
            stripePayoutsEnabled: true,
            stripeDetailsSubmitted: true,
            stripeConnectStatus: true,
          },
        },
      },
    });

  if (!shipment) {
    throw new Error(
      "shipment_not_found"
    );
  }

  /*
   * Comandă/livrare anulată -> nu mai creăm sesiune de plată pentru
   * avans, indiferent de depositStatus (rămâne PENDING după anulare).
   * Verificare pe statusul CURENT din DB, la fiecare încercare.
   */
  const depositBlockReason =
    getDepositBlockReason({
      order: shipment.order,
      shipment,
    });

  if (depositBlockReason) {
    throw new DepositPaymentBlockedError(
      depositBlockReason
    );
  }

  if (
    shipment.order
      ?.paymentMethod !== "COD"
  ) {
    throw new Error(
      "deposit_only_for_cod"
    );
  }

  if (
    shipment.depositStatus !==
    "PENDING"
  ) {
    throw new Error(
      "deposit_not_pending"
    );
  }

  if (
    !isVendorStripeReady(
      shipment.vendor
    )
  ) {
    throw new Error(
      "stripe_not_active"
    );
  }

  const amountCents =
    Math.round(
      Number(
        shipment
          .depositRequestedAmount ||
          0
      ) * 100
    );

  if (
    !Number.isFinite(
      amountCents
    ) ||
    amountCents <= 0
  ) {
    throw new Error(
      "invalid_deposit_amount"
    );
  }

  const order =
    shipment.order;

  const address =
    order.shippingAddress ||
    {};

  const currency =
    String(
      order.currency ||
        "RON"
    ).toLowerCase();

  const session =
    await stripe.checkout.sessions.create({
      mode:
        "payment",

      payment_method_types: [
        "card",
      ],

      customer_email:
        address.email ||
        undefined,

      expires_at:
        Math.floor(
          (
            shipment
              .depositExpiresAt ||
            new Date(
              Date.now() +
                24 *
                  60 *
                  60 *
                  1000
            )
          ).getTime() /
            1000
        ),

      line_items: [
        {
          quantity:
            1,

          price_data: {
            currency,

            unit_amount:
              amountCents,

            product_data: {
              name:
                `Avans 15% – comanda ${
                  order.orderNumber ||
                  order.id
                }`,
            },
          },
        },
      ],

      success_url:
        `${appUrl}/comenzile-mele` +
        `?deposit=success` +
        `&orderId=${encodeURIComponent(
          order.id
        )}`,

      cancel_url:
        `${appUrl}/comenzile-mele` +
        `?deposit=cancelled` +
        `&orderId=${encodeURIComponent(
          order.id
        )}`,

      metadata: {
        kind:
          "deposit_payment",

        orderId:
          order.id,

        orderNumber:
          order.orderNumber ||
          "",

        shipmentId:
          shipment.id,

        vendorId:
          shipment.vendorId,

        depositPercent:
          String(
            shipment.depositPercent ||
              15
          ),
      },

      payment_intent_data: {
        transfer_group:
          `deposit_${shipment.id}`,

        metadata: {
          kind:
            "deposit_payment",

          orderId:
            order.id,

          orderNumber:
            order.orderNumber ||
            "",

          shipmentId:
            shipment.id,

          vendorId:
            shipment.vendorId,

          depositPercent:
            String(
              shipment.depositPercent ||
                15
            ),
        },
      },
    });

  await prisma.shipment.update({
    where: {
      id: shipment.id,
    },

    data: {
      stripeDepositSessionId:
        session.id,

      depositPaymentError:
        null,

      depositMeta: {
        checkoutUrl:
          session.url,

        checkoutCreatedAt:
          new Date().toISOString(),

        stripeConnectedAccountId:
          shipment.vendor
            .stripeAccountId,
      },
    },
  });

  return {
    provider:
      "stripe",

    checkoutSessionId:
      session.id,

    url:
      session.url,
  };
}