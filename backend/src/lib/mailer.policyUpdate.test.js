// Email tranzacțional de reacceptare (sendPolicyUpdateEmail): conținut real,
// escapat, fără headere de marketing, cu EmailLog + template per campanie.
//
// Rulare: node --experimental-test-module-mocks --test src/lib/mailer.policyUpdate.test.js

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5";
process.env.MAIL_PROVIDER = "smtp";
process.env.SMTP_HOST = "smtp.test";
process.env.SMTP_USER_NOREPLY = "no-reply@artfest.test";
process.env.SMTP_PASS_NOREPLY = "secret";
process.env.APP_URL = "https://app.test";

import { test, mock } from "node:test";
import assert from "node:assert/strict";

import { createFakePrisma } from "../testkit/fakePrisma.js";

const fake = createFakePrisma();
const sent = [];

mock.module("../db.js", { namedExports: { prisma: fake } });
mock.module("nodemailer", {
  defaultExport: {
    createTransport: () => ({
      async sendMail(options) {
        sent.push(options);
        return { messageId: "m-1" };
      },
    }),
  },
});

const { sendPolicyUpdateEmail } = await import("./mailer.js");

test("email de reacceptare: tranzacțional, escapat, cu link absolut și EmailLog", async () => {
  await sendPolicyUpdateEmail({
    to: "user@t.ro",
    name: "Ana <b>",
    subject: "Actualizare TOS",
    body: "Salut <script>alert(1)</script>\n\nAm actualizat documentele.",
    documents: [
      {
        title: "Termeni și Condiții",
        version: "2.0.0",
        url: "/legal/tos.html",
        deadlineAt: "2030-05-01T00:00:00.000Z",
      },
    ],
    link: "/cont?policyGate=1&scope=USERS",
    campaignKey: "req_abc",
    userId: "u1",
  });

  assert.equal(sent.length, 1);

  const mail = sent[0];

  assert.equal(mail.to, "user@t.ro");
  assert.equal(mail.subject, "Actualizare TOS");

  // conținut escapat (nu HTML injectat)
  assert.equal(mail.html.includes("<script>"), false);
  assert.match(mail.html, /&lt;script&gt;/);
  assert.match(mail.html, /Ana &lt;b&gt;/);

  // documentul, versiunea și linkurile sunt absolute
  assert.match(mail.html, /Termeni și Condiții/);
  assert.match(mail.html, /versiunea 2\.0\.0/);
  assert.match(mail.html, /https:\/\/app\.test\/legal\/tos\.html/);
  assert.match(mail.text, /https:\/\/app\.test\/cont\?policyGate=1&scope=USERS/);
  assert.match(mail.text, /Termeni și Condiții \(versiunea 2\.0\.0\)/);

  // tranzacțional: fără headere de marketing
  const headerNames = Object.keys(mail.headers || {}).map((h) => h.toLowerCase());
  assert.equal(headerNames.includes("list-unsubscribe"), false);
  assert.equal(headerNames.includes("precedence"), false);
  assert.match(mail.html, /nu un email de marketing/);

  // EmailLog: template pe campanie, SENT
  const log = fake.tables.emailLog[0];

  assert.equal(log.template, "policy_update:req_abc");
  assert.equal(log.toEmail, "user@t.ro");
  assert.equal(log.status, "SENT");
  assert.equal(log.userId, "u1");
});

test("email de reacceptare: fără destinatar nu trimite nimic", async () => {
  const before = sent.length;

  await sendPolicyUpdateEmail({ to: "", subject: "x", campaignKey: "req_x" });

  assert.equal(sent.length, before);
});
