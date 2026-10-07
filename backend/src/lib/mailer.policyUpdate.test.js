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

test("email de preaviz: versiunea în vigoare, link la v2, intrarea în vigoare și rezumatul - doar dacă sunt date", async () => {
  const before = sent.length;

  await sendPolicyUpdateEmail({
    to: "vendor@t.ro",
    subject: "Preaviz: Acordul Marketplace pentru Vânzători",
    body: "Actualizăm Acordul.",
    documents: [
      {
        title: "Acordul Marketplace pentru Vânzători",
        version: "2.0.0",
        currentVersion: "1.0.0",
        url: "/legal/vendor_terms/v/2.0.0.html",
        effectiveAt: "2030-06-15T00:00:00.000Z",
        changeSummary: "Colecțiile înlocuiesc campaniile <b>",
      },
    ],
    campaignKey: "ntc_test",
  });

  const mail = sent[before];
  assert.match(mail.html, /https:\/\/app\.test\/legal\/vendor_terms\/v\/2\.0\.0\.html/);
  assert.match(mail.html, /versiunea în vigoare: 1\.0\.0/);
  assert.match(mail.html, /intră în vigoare la/);
  assert.match(mail.html, /Colecțiile înlocuiesc campaniile &lt;b&gt;/);
  assert.match(mail.text, /versiunea în vigoare: 1\.0\.0; intră în vigoare la/);

  // fără câmpurile de preaviz, emailul rămâne ca înainte (fără rânduri goale)
  await sendPolicyUpdateEmail({
    to: "user2@t.ro",
    subject: "x",
    documents: [{ title: "TOS", version: "1.0.0", url: "/legal/tos.html" }],
    campaignKey: "req_plain",
  });
  const plain = sent[before + 1];
  assert.equal(/intră în vigoare|versiunea în vigoare/.test(plain.html), false);
  assert.equal(/<br><span/.test(plain.html), false);
});

/* ------------- preaviz / notificare de actualizare (email agregat) ------------- */

const NOTICE_DOCS = [
  {
    key: "tos",
    title: "Termeni și Condiții — Artfest",
    version: "2.0.0",
    currentVersion: "1.0.0",
    url: "/legal/tos/v/2.0.0.html",
    currentUrl: "/legal/tos.html",
    effectiveAt: "2026-10-23",
    changeSummary: "Colecțiile înlocuiesc campaniile <b>",
  },
  {
    key: "vendor_terms",
    title: "Acordul Marketplace pentru Vânzători — Artfest",
    version: "2.0.0",
    currentVersion: "1.0.0",
    url: "/legal/vendor_terms/v/2.0.0.html",
    currentUrl: "/legal/vendor_terms.html",
    effectiveAt: "2026-10-23",
  },
];

test("preaviz: subiect, versiunea în vigoare + cea actualizată, rezumat, semnătură; fără obligație de acceptare", async () => {
  const { buildLegalNoticeEmail } = await import("./mailer.js");
  const mail = buildLegalNoticeEmail({ kind: "notice", name: "Ana", documents: NOTICE_DOCS });

  assert.equal(
    mail.subject,
    "Actualizare Termeni și Condiții Artfest – intrare în vigoare la 23 octombrie 2026"
  );
  assert.match(mail.text, /^Bună, Ana,/);
  assert.match(mail.text, /Noile versiuni vor intra în vigoare la data de 23 octombrie 2026\./);
  assert.match(mail.text, /Până la această dată, versiunile actuale rămân în vigoare\./);
  assert.match(mail.text, /versiunea în vigoare \(1\.0\.0\): https:\/\/app\.test\/legal\/tos\.html/);
  assert.match(mail.text, /versiunea actualizată \(2\.0\.0\): https:\/\/app\.test\/legal\/vendor_terms\/v\/2\.0\.0\.html/);
  assert.match(mail.html, /Principalele modificări/);
  assert.match(mail.html, /Colecțiile înlocuiesc campaniile &lt;b&gt;/);
  assert.match(mail.html, /Vezi versiunea actualizată/);
  assert.match(mail.text, /Îți recomandăm să consulți documentul actualizat înainte de data intrării în vigoare\./);
  assert.match(mail.text, /Echipa Artfest\nsupport@artfest\.ro$/);
  assert.doesNotMatch(mail.text, /trebuie să accepți|acceptare|blocat/i);
});

test("actualizare: subiect „au intrat în vigoare”; acceptarea apare DOAR pentru documentele cu reacceptare cerută", async () => {
  const { buildLegalNoticeEmail } = await import("./mailer.js");
  const active = NOTICE_DOCS.map((d) => ({ ...d, url: `/legal/${d.key}.html`, currentUrl: null }));

  const plain = buildLegalNoticeEmail({ kind: "update", documents: active, acceptLink: "/cont?policyGate=1" });
  assert.equal(plain.subject, "Noii Termeni și Condiții Artfest au intrat în vigoare");
  assert.match(plain.text, /sunt acum în vigoare, începând cu data de 23 octombrie 2026/);
  assert.match(plain.text, /versiunea 2\.0\.0 \(în vigoare\): https:\/\/app\.test\/legal\/tos\.html/);
  assert.doesNotMatch(plain.text, /va trebui să accepți|necesită acceptarea|Acceptare:/);

  const withAccept = buildLegalNoticeEmail({
    kind: "update",
    documents: [{ ...active[0], reacceptanceRequired: true }, active[1]],
    acceptLink: "/cont?policyGate=1&scope=USERS",
  });
  assert.match(withAccept.text, /Termeni și Condiții — Artfest, versiunea 2\.0\.0 .* - necesită acceptarea versiunii noi/);
  assert.doesNotMatch(withAccept.text, /Vânzători — Artfest, versiunea 2\.0\.0 .* necesită/);
  assert.match(withAccept.text, /va trebui să accepți versiunea nouă/);
  assert.match(withAccept.text, /Acceptare: https:\/\/app\.test\/cont\?policyGate=1&scope=USERS/);
});

test("preaviz: trimiterea e logată în EmailLog pe campanie (legal_notice:<cheie>), tranzacțional", async () => {
  const { sendLegalNoticeEmail } = await import("./mailer.js");
  const before = sent.length;

  await sendLegalNoticeEmail({
    to: "notice@t.ro",
    kind: "notice",
    documents: NOTICE_DOCS,
    campaignKey: "ntc_test",
    userId: "u9",
  });

  const mail = sent[before];
  assert.equal(mail.to, "notice@t.ro");
  assert.match(mail.subject, /intrare în vigoare la 23 octombrie 2026/);
  const headerNames = Object.keys(mail.headers || {}).map((h) => h.toLowerCase());
  assert.equal(headerNames.includes("list-unsubscribe"), false);

  const log = fake.tables.emailLog.find((row) => row.template === "legal_notice:ntc_test");
  assert.equal(log.status, "SENT");
  assert.equal(log.toEmail, "notice@t.ro");
  assert.equal(log.userId, "u9");
});

test("email pe audiență: subiect + ton diferit pentru client / vânzător / influencer (preaviz și actualizare)", async () => {
  const { buildLegalNoticeEmail } = await import("./mailer.js");
  const docs = NOTICE_DOCS.map((d) => ({ ...d, changeSummary: null }));

  const subjects = Object.fromEntries(
    ["USER", "VENDOR", "INFLUENCER"].map((audience) => [
      audience,
      [
        buildLegalNoticeEmail({ kind: "notice", audience, documents: docs }).subject,
        buildLegalNoticeEmail({ kind: "update", audience, documents: docs }).subject,
      ],
    ])
  );

  assert.deepEqual(subjects, {
    USER: [
      "Actualizare documente Artfest – intrare în vigoare la 23 octombrie 2026",
      "Documentele Artfest actualizate au intrat în vigoare",
    ],
    VENDOR: [
      "Actualizare Termeni și condiții pentru vânzători – 23 octombrie 2026",
      "Noii Termeni pentru vânzători au intrat în vigoare",
    ],
    INFLUENCER: [
      "Actualizare documente aplicabile colaborării Artfest – 23 octombrie 2026",
      "Documentele actualizate pentru colaborarea cu Artfest au intrat în vigoare",
    ],
  });

  const vendor = buildLegalNoticeEmail({ kind: "notice", audience: "VENDOR", documents: docs });
  assert.match(vendor.text, /activitatea ta de vânzător/);
  assert.match(vendor.text, /Vezi versiunea actualizată: https:\/\/app\.test\/legal\/vendor_terms\/v\/2\.0\.0\.html/);
  assert.match(vendor.text, /intră în vigoare la 23 octombrie 2026/);

  const user = buildLegalNoticeEmail({ kind: "notice", audience: "USER", documents: [docs[0]] });
  assert.match(user.text, /descoperi și cumpăra produse/);
  assert.doesNotMatch(user.text, /vânzător/i);

  const influencer = buildLegalNoticeEmail({ kind: "notice", audience: "INFLUENCER", documents: [docs[0]] });
  assert.match(influencer.text, /colaborării tale/);
});
