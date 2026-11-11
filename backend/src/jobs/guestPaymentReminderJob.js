// backend/src/jobs/guestPaymentReminderJob.js
//
// Reminder automat pentru comenzile plătite cu CARD, dar nefinalizate:
// trimite UN SINGUR email către client, la ~30 minute după plasarea
// comenzii, dacă plata încă nu a fost făcută.
//
// Guest: link cu paymentToken. Clienți cu cont: doar comenzile plasate de
// la CARD_PAYMENT_REMINDER_USERS_FROM (dată ISO; fără ea, doar guest) -
// comenzile istorice nu primesc retroactiv emailuri; link spre pagina
// comenzii din cont.
//
// Dacă regula de expirare CARD e activă pentru comandă
// (services/cardPaymentExpiry.js), emailul arată termenul de plată, iar
// după termen nu se mai trimite.
//
// Nu atinge comenzile COD și nu retrimite un al doilea reminder
// (dedup pe Order.guestPaymentReminderSentAt, folosit pentru ambele).

import { prisma } from "../db.js";
import { sendGuestPaymentReminderEmail } from "../lib/mailer.js";
import { createGuestPaymentAccessToken } from "../lib/guestPaymentAccessToken.js";
import { cardPaymentDeadline } from "../services/cardPaymentExpiry.js";

function usersReminderFrom(env = process.env) {
  const raw = String(env.CARD_PAYMENT_REMINDER_USERS_FROM || "").trim();
  const date = raw ? new Date(raw) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

const REMINDER_AFTER_MS =
  30 * 60 * 1000;

export async function runGuestPaymentReminderJob({ now = new Date() } = {}) {
  const cutoff =
    new Date(
      now.getTime() -
        REMINDER_AFTER_MS
    );

  const usersFrom = usersReminderFrom();

  const orders =
    await prisma.order.findMany({
      where: {
        OR: [
          { isGuestOrder: true },
          ...(usersFrom
            ? [
                {
                  isGuestOrder: false,
                  userId: { not: null },
                  createdAt: { gte: usersFrom },
                },
              ]
            : []),
        ],

        paymentMethod:
          "CARD",

        status:
          "PENDING",

        paidAt:
          null,

        guestPaymentReminderSentAt:
          null,

        createdAt: {
          lte:
            cutoff,
        },
      },

      select: {
        id: true,
        orderNumber: true,
        customerName: true,
        customerEmail: true,
        total: true,
        currency: true,
        isGuestOrder: true,
        userId: true,
        paymentMethod: true,
        createdAt: true,
        user: { select: { email: true } },
      },

      // Plasă de siguranță, la fel ca la quotePriceReminderJob.js -
      // în practică setul e mic (dedup-ul scoate comenzile deja
      // notificate din filtru automat la rularea următoare).
      take: 200,
    });

  if (!orders.length) {
    console.log(
      "[guestPaymentReminderJob] sent 0 guest payment reminders"
    );

    return;
  }

  let sent = 0;

  for (const order of orders) {
    // regula de expirare activă: după termen comanda expiră, nu mai amintim plata
    const payUntil = cardPaymentDeadline(order);
    if (payUntil && now >= payUntil) {
      continue;
    }

    const accountOrder = !order.isGuestOrder && Boolean(order.userId);
    const to = accountOrder
      ? order.user?.email || order.customerEmail
      : order.customerEmail;

    /*
     * Claim atomic, condiționat: dacă altă instanță a job-ului a
     * apucat deja comanda asta (sau a trimis deja reminder-ul între
     * timp), updateMany va avea count=0 și sărim peste ea - fără
     * dublă trimitere.
     *
     * NOTĂ: momentan setăm `guestPaymentReminderSentAt` ÎNAINTE de a
     * trimite email-ul, ca lock optimist - dacă trimiterea eșuează,
     * îl resetăm explicit la null mai jos (catch), ca job-ul să poată
     * încerca din nou la următoarea rulare. Rezultatul extern rămâne
     * exact cel cerut: câmpul e setat DOAR după o trimitere reușită.
     */
    const claim =
      await prisma.order.updateMany({
        where: {
          id:
            order.id,

          guestPaymentReminderSentAt:
            null,
        },

        data: {
          guestPaymentReminderSentAt:
            new Date(),
        },
      });

    if (claim.count === 0) {
      continue;
    }

    if (!to) {
      console.warn(
        `[guestPaymentReminderJob] order ${order.id} has no email - reverting claim`
      );

      await prisma.order.update({
        where: {
          id:
            order.id,
        },

        data: {
          guestPaymentReminderSentAt:
            null,
        },
      });

      continue;
    }

    try {
      const paymentToken = accountOrder
        ? null
        : createGuestPaymentAccessToken({
            orderId:
              order.id,
          });

      await sendGuestPaymentReminderEmail({
        to,

        userId:
          order.userId || null,

        orderId:
          order.id,

        orderNumber:
          order.orderNumber,

        customerName:
          order.customerName,

        total:
          order.total,

        currency:
          order.currency,

        paymentToken,

        accountOrder,

        payUntil,
      });

      sent += 1;
    } catch (error) {
      console.error(
        `[guestPaymentReminderJob] failed to send reminder for order ${order.id}:`,
        error
      );

      /*
       * Trimiterea a eșuat - NU marcăm reminder-ul ca trimis.
       * Resetăm claim-ul, ca următoarea rulare să poată reîncerca
       * aceeași comandă.
       */
      await prisma.order.update({
        where: {
          id:
            order.id,
        },

        data: {
          guestPaymentReminderSentAt:
            null,
        },
      });
    }
  }

  console.log(
    `[guestPaymentReminderJob] sent ${sent} payment reminders (${orders.length} eligible orders checked)`
  );
}
