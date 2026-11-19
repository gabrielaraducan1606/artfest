// Emailul de status al profilului Artfest Creators (sendCreatorProfileStatusEmail):
// conținut real pentru fiecare status, escapat, link spre contul influencerului,
// EmailLog cu template dedicat, fără headere de marketing. Transport simulat.
//
// Rulare: node --experimental-test-module-mocks --test src/lib/mailer.creatorProfile.test.js

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5";
process.env.MAIL_PROVIDER = "smtp";
process.env.SMTP_HOST = "smtp.test";
process.env.SMTP_USER_NOREPLY = "no-reply@artfest.test";
process.env.SMTP_PASS_NOREPLY = "secret";
process.env.APP_URL = "https://app.test";
delete process.env.RESEND_API_KEY;

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
        return { messageId: `m-${sent.length}` };
      },
    }),
  },
});

const { buildCreatorProfileStatusEmail, sendCreatorProfileStatusEmail } = await import("./mailer.js");

test("fiecare status are subiect, titlu, status și butonul „Vezi profilul meu” spre contul influencerului", () => {
  for (const [kind, status] of [
    ["approved", "Aprobat"],
    ["changes_requested", "Modificări solicitate"],
    ["rejected", "Respins"],
    ["suspended", "Suspendat"],
  ]) {
    const mail = buildCreatorProfileStatusEmail({ kind, displayName: "Ana", path: "/influencer/creatori" });
    assert.ok(mail.subject.includes("Artfest Creators"), kind);
    assert.ok(mail.html.includes(status), kind);
    assert.ok(mail.html.includes('href="https://app.test/influencer/creatori"'), kind);
    assert.ok(mail.html.includes("Vezi profilul meu"), kind);
    assert.ok(mail.text.includes("https://app.test/influencer/creatori"), kind);
  }
  assert.throws(() => buildCreatorProfileStatusEmail({ kind: "altceva" }));
});

test("mesajul echipei și numele sunt escapate (fără HTML injectat)", () => {
  const mail = buildCreatorProfileStatusEmail({
    kind: "changes_requested",
    displayName: "<b>Ana</b>",
    message: 'Schimbă fotografia <script>alert("x")</script>',
  });
  assert.doesNotMatch(mail.html, /<script>|<b>Ana<\/b>/);
  assert.match(mail.html, /&lt;script&gt;/);
  assert.match(mail.text, /Schimbă fotografia/);
});

test("trimitere: EmailLog SENT cu template dedicat, expeditor no-reply, fără destinatar => eroare clară", async () => {
  await sendCreatorProfileStatusEmail({
    to: "ana@test.ro",
    userId: "u1",
    idempotencyKey: "creator_profile_event:e1",
    kind: "approved",
    displayName: "Ana",
  });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "ana@test.ro");
  assert.match(sent[0].subject, /aprobat/);
  assert.ok(!("List-Unsubscribe" in (sent[0].headers || {})), "email tranzacțional, nu de marketing");
  const [log] = fake.tables.emailLog;
  assert.deepEqual([log.status, log.template, log.toEmail], ["SENT", "creator_profile_approved", "ana@test.ro"]);

  await assert.rejects(sendCreatorProfileStatusEmail({ to: "", kind: "approved" }), /missing_recipient/);
});
