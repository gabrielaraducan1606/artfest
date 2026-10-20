// Teste: emailul real (HTML + text) al invitației pentru magazinele neactivate.
// Doar construirea emailului - nu trimite nimic.
//
// Rulare: node --test src/lib/artfestFairActivationInviteEmail.test.js

import { test } from "node:test";
import assert from "node:assert/strict";

// mediu ermetic, setat ÎNAINTE de import: clientul Prisma încarcă .env, dar nu suprascrie
// variabilele existente => fără secret de dezabonare, fără provider de email real, fără DB reală
Object.assign(process.env, {
  UNSUBSCRIBE_SECRET: "",
  RESEND_API_KEY: "",
  MAIL_PROVIDER: "none",
  SMTP_HOST: "127.0.0.1",
  SMTP_PORT: "9",
  DATABASE_URL: "postgresql://test:test@127.0.0.1:5/x",
  DIRECT_URL: "postgresql://test:test@127.0.0.1:5/x",
});

const mailer = await import("./mailer.js");
const build = (extra = {}) =>
  mailer.buildArtfestFairActivationInviteEmail({
    vendorName: "Atelier <Ana>",
    firstName: null,
    ctaPath: "/onboarding",
    helpPhoneDisplay: "0760 565 147",
    helpPhoneTel: "+40760565147",
    unsubscribeUrl: "https://api.artfest.ro/unsubscribe?token=abc",
    ...extra,
  });

test("conținut: magazin neactivat, invitație la târg, ajutor la telefon, CTA către activare", () => {
  const { subject, html, text, ctaUrl } = build();
  assert.match(subject, /Activează-ți magazinul/);
  for (const out of [html, text]) {
    assert.match(out, /magazinul tău nu este încă activat/);
    assert.match(out, /Târgul de Crăciun Artfest/);
    assert.match(out, /finalizezi activarea magazinului/);
    assert.match(out, /0760 565 147/);
    assert.match(out, /Activează-ți magazinul/);
  }
  assert.match(html, /href="tel:\+40760565147"/);
  assert.match(text, /Ne poți scrie sau suna la 0760 565 147/);
  // opțiunea Creator Independent, fără limită / scutire
  assert.match(text, /poți activa magazinul și ca „Creator Independent”/);
  assert.match(text, /Obligațiile tale fiscale și legale le stabilești tu/);
  assert.match(html, /ai acceptat să primești noutăți și oferte/);
  assert.doesNotMatch(text, /10\.000|scutit|scutire|neimpozabil|prag/i);
  assert.ok(ctaUrl.endsWith("/onboarding"));
  assert.ok(html.includes(`href="${ctaUrl}"`));
  // dezabonare vizibilă în email
  assert.match(html, /Dezabonează-te/);
  assert.match(text, /Dezabonare: https:\/\/api\.artfest\.ro\/unsubscribe\?token=abc/);
});

test("CTA: magazin început => /onboarding/details; o cale externă e ignorată", () => {
  assert.ok(build({ ctaPath: "/onboarding/details" }).ctaUrl.endsWith("/onboarding/details"));
  assert.ok(build({ ctaPath: "https://evil.test/x" }).ctaUrl.endsWith("/onboarding"));
});

test("numele vendorului este escapat (fără HTML injectat)", () => {
  const { html } = build();
  assert.ok(html.includes("Bună, Atelier &lt;Ana&gt;,"));
  assert.equal(html.includes("<Ana>"), false);
});

test("regula de 10.000 lei: DEZACTIVATĂ până la aprobare; când e activată, e formulată ca regulă internă", () => {
  assert.equal(mailer.ACTIVATION_INVITE_SHOW_INDEPENDENT_CREATOR_NOTE, false);
  const off = build();
  assert.equal(/10\.000/.test(off.html) || /10\.000/.test(off.text), false);

  const on = build({ showIndependentCreatorNote: true });
  assert.match(on.html, /10\.000 lei/);
  assert.match(on.html, /regul[ăi] intern[ăe] Artfest/);
  assert.match(on.html, /nu este un prag fiscal sau juridic stabilit de lege/);
  assert.doesNotMatch(on.html, /scutit|scutire|neimpozabil/i);
});

test("fără link de dezabonare funcțional (lipsă UNSUBSCRIBE_SECRET / URL), emailul NU pleacă", async () => {
  assert.equal(mailer.artfestFairActivationUnsubscribeUrl("a@t.ro"), null);
  await assert.rejects(
    mailer.sendArtfestFairActivationInviteEmail({ to: "a@t.ro", campaignKey: "K", ctaPath: "/onboarding" }),
    /unsubscribe_link_unavailable/
  );
});
