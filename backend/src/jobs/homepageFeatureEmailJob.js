// backend/src/jobs/homepageFeatureEmailJob.js
import { prisma as defaultPrisma } from "../db.js";
import { homepageFeatureEmailTemplate } from "../lib/mailer.js";
import {
  FEATURE_EMAIL_LEAD_DAYS,
  planFeatureEmail,
  sendFeatureEmailNow,
} from "../services/homepageFeatureScheduler.js";

/*
 * Emailul de anunț pentru „Produsul zilei” / „Artizanul săptămânii”,
 * trimis ÎNAINTE de începutul promovării (2026-10-07):
 *   - Produsul zilei:       ziua promovării - 3 zile, 09:00 ora României;
 *   - Artizanul săptămânii: începutul săptămânii - 7 zile, 09:00.
 * (calculul: computeFeatureEmailSendAt / planFeatureEmail din
 * homepageFeatureScheduler.js - data din DB, startsAt.)
 *
 * Reguli:
 *   - promovare creată după momentul normal -> trimis la prima rulare,
 *     o singură dată, dacă promovarea NU a început;
 *   - promovare începută / ștearsă / cu produs-magazin-vendor inactiv ->
 *     NU se trimite (re-evaluat la fiecare rulare, deci un produs
 *     reactivat înainte de start primește emailul);
 *
 * Anti-duplicate (fără câmpuri noi):
 *   - vendorEmailedAt setat -> promovarea nu mai e selectată;
 *   - EmailLog SENT pe template "homepage_feature:<id>" (ex. emailul a
 *     plecat, dar update-ul vendorEmailedAt a eșuat) -> doar completăm
 *     vendorEmailedAt, NU retrimitem;
 *   - o singură rulare odată în proces (lock).
 *
 * Eșec -> vendorEmailError, vendorEmailedAt rămâne null -> reîncercat
 * la rulările următoare, până la MAX_FAILED_ATTEMPTS eșecuri înregistrate
 * în EmailLog (apoi doar manual, din Admin -> „Retrimite vendorului”).
 *
 * Modificarea datei DUPĂ trimitere: vendorEmailedAt rămâne setat (PATCH
 * păstrează răspunsul vendorului când produsul/magazinul nu se schimbă),
 * deci NU pleacă automat un al doilea email.
 */

export const MAX_FAILED_ATTEMPTS = 5;

const MAX_LEAD_DAYS = Math.max(...Object.values(FEATURE_EMAIL_LEAD_DAYS));

const vendorWithUser = { include: { user: true } };

const featureEmailInclude = {
  product: {
    include: {
      service: { include: { profile: true, vendor: vendorWithUser } },
    },
  },
  service: { include: { profile: true, vendor: vendorWithUser } },
  vendor: vendorWithUser,
};

let running = false;

export async function runHomepageFeatureEmailJob({
  now = new Date(),
  prisma = defaultPrisma,
  sendNow = sendFeatureEmailNow,
} = {}) {
  if (running) return { skipped: true, reason: "already_running" };

  running = true;

  const summary = { checked: 0, sent: 0, failed: 0, alreadyLogged: 0, notDue: 0, gaveUp: 0 };

  try {
    const horizon = new Date(now.getTime() + (MAX_LEAD_DAYS + 1) * 24 * 60 * 60 * 1000);

    const features = await prisma.homepageFeature.findMany({
      where: {
        vendorEmailedAt: null,
        vendorId: { not: null },
        startsAt: { gt: now, lte: horizon },
      },
      include: featureEmailInclude,
      orderBy: { startsAt: "asc" },
    });

    for (const feature of features) {
      summary.checked += 1;

      const plan = planFeatureEmail(feature, now);
      if (!plan.sendNow) {
        summary.notDue += 1;
        continue;
      }

      const template = homepageFeatureEmailTemplate(feature.id);

      const logged = await prisma.emailLog.findFirst({
        where: { template, status: "SENT" },
        select: { sentAt: true, createdAt: true },
      });

      if (logged) {
        await prisma.homepageFeature.update({
          where: { id: feature.id },
          data: { vendorEmailedAt: logged.sentAt || logged.createdAt || now, vendorEmailError: null },
        });
        summary.alreadyLogged += 1;
        continue;
      }

      const failedAttempts = await prisma.emailLog.count({ where: { template, status: "FAILED" } });
      if (failedAttempts >= MAX_FAILED_ATTEMPTS) {
        summary.gaveUp += 1;
        continue;
      }

      const result = await sendNow(feature);
      if (result?.emailSent) summary.sent += 1;
      else summary.failed += 1;
    }

    return summary;
  } finally {
    running = false;
  }
}
