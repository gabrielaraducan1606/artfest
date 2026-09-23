// src/jobs/guestPaymentReminderJob.test.js
//
// Teste deterministe pentru runGuestPaymentReminderJob() - reminder-ul
// de plată CARD neterminată pentru comenzi guest.
//
// FĂRĂ DB real, FĂRĂ email real - mocăm STRICT "../db.js" și
// "../lib/mailer.js". Restul e codul REAL (guestPaymentReminderJob.js
// + guestPaymentAccessToken.js, neatinse).
//
// Rulare: node --experimental-test-module-mocks --test src/jobs/guestPaymentReminderJob.test.js

process.env.DATABASE_URL =
  "postgresql://test:test@127.0.0.1:5";
process.env.JWT_SECRET = "test-secret";

import { test, mock } from "node:test";
import assert from "node:assert/strict";

let orders = [];
let updateManyCalls = [];
let updateCalls = [];
let sendCalls = [];
let sendBehavior = { mode: "success" };

function minutesAgo(minutes) {
  return new Date(Date.now() - minutes * 60 * 1000);
}

function seed(order) {
  orders.push({
    id: order.id,
    orderNumber: order.orderNumber || `AF-${order.id}`,
    customerName: order.customerName || "Client Test",
    customerEmail:
      order.customerEmail === undefined
        ? "client@example.test"
        : order.customerEmail,
    total: order.total ?? 100,
    currency: order.currency || "RON",
    isGuestOrder: order.isGuestOrder ?? true,
    paymentMethod: order.paymentMethod ?? "CARD",
    status: order.status ?? "PENDING",
    paidAt: order.paidAt ?? null,
    guestPaymentReminderSentAt:
      order.guestPaymentReminderSentAt ?? null,
    createdAt: order.createdAt ?? minutesAgo(40),
  });
}

const fakeDb = {
  order: {
    findMany: async ({ where }) => {
      const cutoff = where.createdAt.lte.getTime();

      return orders
        .filter(
          (o) =>
            o.isGuestOrder === where.isGuestOrder &&
            o.paymentMethod === where.paymentMethod &&
            o.status === where.status &&
            o.paidAt === where.paidAt &&
            o.guestPaymentReminderSentAt ===
              where.guestPaymentReminderSentAt &&
            o.createdAt.getTime() <= cutoff
        )
        .map((o) => ({ ...o }));
    },

    updateMany: async ({ where, data }) => {
      updateManyCalls.push({ where, data });

      const order = orders.find(
        (o) =>
          o.id === where.id &&
          o.guestPaymentReminderSentAt ===
            where.guestPaymentReminderSentAt
      );

      if (!order) {
        return { count: 0 };
      }

      Object.assign(order, data);
      return { count: 1 };
    },

    update: async ({ where, data }) => {
      updateCalls.push({ where, data });

      const order = orders.find((o) => o.id === where.id);
      Object.assign(order, data);
      return { ...order };
    },
  },
};

mock.module("../db.js", {
  namedExports: { prisma: fakeDb },
});

mock.module("../lib/mailer.js", {
  namedExports: {
    sendGuestPaymentReminderEmail: async (args) => {
      sendCalls.push(args);

      if (sendBehavior.mode === "fail") {
        throw new Error("smtp_down");
      }

      return { ok: true };
    },
  },
});

const { runGuestPaymentReminderJob } = await import(
  "./guestPaymentReminderJob.js"
);

function reset() {
  orders = [];
  updateManyCalls = [];
  updateCalls = [];
  sendCalls = [];
  sendBehavior = { mode: "success" };
}

/* =========================================================
   A. Guest CARD plătit -> ignorat
========================================================= */

test("A. guest CARD plătit (paidAt setat) -> job-ul îl ignoră, fără email", async () => {
  reset();

  seed({
    id: "order-paid",
    paymentMethod: "CARD",
    status: "PAID",
    paidAt: new Date(),
    createdAt: minutesAgo(60),
  });

  await runGuestPaymentReminderJob();

  assert.equal(sendCalls.length, 0);
});

/* =========================================================
   B. Guest CARD neplătit de 10 minute -> nu primește reminder
========================================================= */

test("B. guest CARD neplătit de doar 10 minute -> nu primește reminder încă", async () => {
  reset();

  seed({
    id: "order-recent",
    paymentMethod: "CARD",
    status: "PENDING",
    createdAt: minutesAgo(10),
  });

  await runGuestPaymentReminderJob();

  assert.equal(sendCalls.length, 0);

  const order = orders.find((o) => o.id === "order-recent");
  assert.equal(order.guestPaymentReminderSentAt, null);
});

/* =========================================================
   C. Guest CARD neplătit de peste 30 minute -> UN singur reminder
========================================================= */

test("C. guest CARD neplătit de peste 30 minute -> primește exact UN reminder, guestPaymentReminderSentAt se setează", async () => {
  reset();

  seed({
    id: "order-due",
    paymentMethod: "CARD",
    status: "PENDING",
    customerEmail: "guest@example.test",
    createdAt: minutesAgo(45),
  });

  await runGuestPaymentReminderJob();

  assert.equal(sendCalls.length, 1);
  assert.equal(sendCalls[0].to, "guest@example.test");
  assert.equal(sendCalls[0].orderId, "order-due");
  assert.ok(sendCalls[0].paymentToken, "un paymentToken trebuie generat");

  const order = orders.find((o) => o.id === "order-due");
  assert.ok(
    order.guestPaymentReminderSentAt instanceof Date,
    "guestPaymentReminderSentAt trebuie setat DUPĂ trimiterea cu succes"
  );
});

/* =========================================================
   D. Job-ul rulează din nou -> nu retrimite
========================================================= */

test("D. job-ul rulează a doua oară pentru aceeași comandă -> NU mai trimite (dedup pe guestPaymentReminderSentAt)", async () => {
  reset();

  seed({
    id: "order-due-2",
    paymentMethod: "CARD",
    status: "PENDING",
    createdAt: minutesAgo(45),
  });

  await runGuestPaymentReminderJob();
  assert.equal(sendCalls.length, 1);

  // A doua rulare a job-ului, pe același set de date (simulează
  // interval-ul de 10 minute din server.js).
  await runGuestPaymentReminderJob();

  assert.equal(sendCalls.length, 1, "nu trebuie trimis un al doilea email");
});

/* =========================================================
   G. Guest COD -> job-ul îl ignoră
========================================================= */

test("G. guest COD, neplătit, vechi -> job-ul îl ignoră complet", async () => {
  reset();

  seed({
    id: "order-cod",
    paymentMethod: "COD",
    status: "PENDING",
    createdAt: minutesAgo(90),
  });

  await runGuestPaymentReminderJob();

  assert.equal(sendCalls.length, 0);
});

/* =========================================================
   Eșec trimitere email -> NU se setează guestPaymentReminderSentAt,
   job-ul poate reîncerca la rularea următoare
========================================================= */

test("email eșuat -> guestPaymentReminderSentAt rămâne null (rollback), reîncercare posibilă la rularea următoare", async () => {
  reset();
  sendBehavior.mode = "fail";

  seed({
    id: "order-fail",
    paymentMethod: "CARD",
    status: "PENDING",
    createdAt: minutesAgo(50),
  });

  await runGuestPaymentReminderJob();

  assert.equal(sendCalls.length, 1, "s-a încercat trimiterea");

  const order = orders.find((o) => o.id === "order-fail");
  assert.equal(
    order.guestPaymentReminderSentAt,
    null,
    "nu trebuie marcat ca trimis dacă email-ul a eșuat"
  );

  // Rularea următoare TREBUIE să reîncerce - de data asta reușește.
  sendBehavior.mode = "success";
  await runGuestPaymentReminderJob();

  assert.equal(sendCalls.length, 2, "a doua rulare reîncearcă aceeași comandă");

  const orderAfterRetry = orders.find((o) => o.id === "order-fail");
  assert.ok(orderAfterRetry.guestPaymentReminderSentAt instanceof Date);
});

/* =========================================================
   Concurență: claim atomic - dacă altă "instanță" a apucat deja
   comanda (guestPaymentReminderSentAt setat între citire și claim),
   nu trimitem un al doilea email.
========================================================= */

test("concurență: dacă guestPaymentReminderSentAt e deja setat la momentul claim-ului -> nu trimite (updateMany count=0)", async () => {
  reset();

  seed({
    id: "order-race",
    paymentMethod: "CARD",
    status: "PENDING",
    createdAt: minutesAgo(60),
  });

  const order = orders.find((o) => o.id === "order-race");

  const realUpdateMany = fakeDb.order.updateMany;

  fakeDb.order.updateMany = async (args) => {
    // Simulează o altă instanță a job-ului care apucă exact acum.
    order.guestPaymentReminderSentAt = new Date();
    return realUpdateMany(args);
  };

  try {
    await runGuestPaymentReminderJob();
  } finally {
    fakeDb.order.updateMany = realUpdateMany;
  }

  assert.equal(
    sendCalls.length,
    0,
    "nu trebuie trimis email dacă claim-ul a eșuat (altă instanță a câștigat rasa)"
  );
});

/* =========================================================
   Comandă fără customerEmail -> nu crapă job-ul, nu marchează
   permanent ca trimis
========================================================= */

test("comandă fără customerEmail -> job-ul nu crapă, nu marchează guestPaymentReminderSentAt", async () => {
  reset();

  seed({
    id: "order-no-email",
    paymentMethod: "CARD",
    status: "PENDING",
    customerEmail: null,
    createdAt: minutesAgo(60),
  });

  await assert.doesNotReject(() => runGuestPaymentReminderJob());

  assert.equal(sendCalls.length, 0);

  const order = orders.find((o) => o.id === "order-no-email");
  assert.equal(order.guestPaymentReminderSentAt, null);
});
