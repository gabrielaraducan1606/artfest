// backend/src/services/artfestFairPricingModelService.js
//
// Târgul Artfest - acceptarea regulamentului 2.0.0 (FAIR_PRICE): preț final stabilit de Artfest
// și preț introdus la casă. Regula financiară rămâne comisionul de 10% din prețul efectiv
// (vendorul primește 90%), inclusiv la reduceri.
//
// Principii:
//  - nimeni nu trece automat: înscrierile rămân COMMISSION (regula versiunii acceptate
//    la înscriere) până la acceptarea EXPLICITĂ a vendorului (bifă + buton);
//  - versiunea care conține regula nouă se identifică DOAR din registrul documentelor
//    publicate (legal/artfest_fair_rules/versions.yml, intrarea cu pricingModel:
//    FAIR_PRICE). Fără o versiune publicată, nu există nimic de acceptat. Nu există
//    variabile de mediu sau configurare separată;
//  - solicitarea apare doar pentru înscrierile SUBMITTED / APPROVED (nu pentru
//    REJECTED, WITHDRAWN sau CANCELLED);
//  - dovada acceptării: același tipar ca acceptarea regulamentului la înscriere
//    (dată, versiune exactă, cont, IP, browser - regulamentul 17.2). Acceptarea de la
//    înscriere (termsVersion / termsAcceptedAt) rămâne neatinsă;
//  - efect doar pentru vânzările ULTERIOARE: vânzările, retururile și deconturile
//    anterioare își păstrează regula salvată pe linie; nimic nu se recalculează.

import { prisma } from "../db.js";
import { FairError, ensureFair } from "./artfestFairService.js";
import { PRICING_MODELS } from "../lib/artfestFairPricing.js";
import {
  fairRulesPublicPath,
  latestFairPriceRulesVersion,
  listPublishedFairRules,
  loadPublishedFairRules,
} from "../lib/artfestFairRules.js";

// statusurile reale (enum ArtfestFairRegistrationStatus) pentru care se cere acceptarea
export const PRICING_ACCEPT_STATUSES = Object.freeze(["SUBMITTED", "APPROVED"]);
const ACCEPTABLE = new Set(PRICING_ACCEPT_STATUSES);
const LIMITS = { ip: 64, ua: 500 };

// exemplul afișat înainte de acceptare
// exemplul afișat înainte de acceptare (calculat cu aceeași regulă ca POS-ul: 10% / 90%)
export const FAIR_PRICE_EXAMPLE = Object.freeze({
  commissionBps: 1000,
  vendorPriceCents: 10000, // prețul declarat
  salePriceCents: 11111, // prețul sugerat = 100 / 0,90, rotunjit la bani
  artfestCents: 1111,
  vendorCents: 10000,
  discountedSaleCents: 10000, // aceeași vânzare cu reducere, la 100 lei
  discountedArtfestCents: 1000,
  discountedVendorCents: 9000,
});

// rezumatul schimbărilor (afișat în modal, deasupra documentului complet)
export const FAIR_PRICE_SUMMARY = Object.freeze([
  "Comisionul rămâne 10% din prețul efectiv de vânzare; primești restul de 90%. Nu se adaugă alt adaos sau altă reținere.",
  "Artfest stabilește prețul de vânzare la Târg. Prețul sugerat este prețul tău declarat / 0,90, ca după comision să primești prețul declarat.",
  "Prețul efectiv poate fi redus (reduceri aprobate sau un preț introdus la casă) sau, cu confirmare explicită la casă, mai mare decât prețul de pe etichetă, fără retipărirea etichetei. Orice reducere scade și suma ta: întotdeauna 10% Artfest / 90% tu din prețul efectiv, fără excepții.",
  "Prețul produsului tău de pe Artfest (online) nu se modifică.",
  "Se aplică doar vânzărilor de după acceptare. Vânzările, retururile și deconturile de până atunci rămân neschimbate.",
  "Taxa de participare: 420 lei în total. Avansul achitat este inclus (nu e o taxă suplimentară); restul de plată este 420 lei minus avansul.",
  "Avansul achitat DUPĂ acceptare nu se restituie dacă renunți sau nu accepți taxa totală. Avansul achitat înainte rămâne în regimul versiunii acceptate atunci. Dacă Artfest anulează participarea ta sau Târgul din motive care nu îți sunt imputabile, taxa plătită se restituie integral.",
]);

const defaultRules = { listPublished: listPublishedFairRules, loadPublished: loadPublishedFairRules };

/** Versiunea publicată care conține regula nouă (din registrul documentelor publicate). */
export function fairPriceOffer(rules = defaultRules) {
  const version = latestFairPriceRulesVersion(rules.listPublished());
  return version ? { available: true, version, url: fairRulesPublicPath(version) } : { available: false, version: null, url: null };
}

function serializeState(registration, offer) {
  const model = registration?.pricingModel || PRICING_MODELS.COMMISSION;
  const accepted = model === PRICING_MODELS.FAIR_PRICE;
  return {
    model,
    registrationStatus: registration?.status || null,
    acceptedAt: accepted ? registration.pricingModelAcceptedAt : null,
    termsVersion: accepted ? registration.pricingModelTermsVersion : null,
    offer,
    example: FAIR_PRICE_EXAMPLE,
    summary: FAIR_PRICE_SUMMARY,
    canAccept: Boolean(!accepted && offer.available && registration && ACCEPTABLE.has(registration.status)),
  };
}

async function findRegistration(db, fairId, vendorId) {
  return db.artfestFairRegistration.findUnique({ where: { fairId_vendorId: { fairId, vendorId } } });
}

/** Starea regulii pentru vendorul din sesiune (pagina Târgului). */
export async function getPricingModelState({ vendorId, db = prisma, rules = defaultRules }) {
  const fair = await ensureFair(db);
  const registration = await findRegistration(db, fair.id, vendorId);
  return serializeState(registration, fairPriceOffer(rules));
}

/** Documentul complet de acceptat (aceeași randare ca pagina publică a versiunii). */
export async function getPricingModelDocument({ vendorId, db = prisma, rules = defaultRules }) {
  const state = await getPricingModelState({ vendorId, db, rules });
  const version = state.model === PRICING_MODELS.FAIR_PRICE ? state.termsVersion : state.offer.version;
  const doc = version ? rules.loadPublished(version) : null;
  if (!doc) throw new FairError(404, "pricing_terms_not_available", "Documentul nu este disponibil.");
  return { version: doc.version, title: doc.title, html: doc.html, publishedAt: doc.publishedAt, url: doc.publicPath };
}

/*
 * Acceptarea explicită. O singură dată: a doua acceptare întoarce starea, fără a
 * rescrie data / versiunea / dovada primei acceptări. Nu atinge inventarul,
 * prețurile, etichetele, vânzările, deconturile sau acceptarea de la înscriere.
 */
export async function acceptFairPriceModel({ vendorId, userId, body = {}, ip = null, ua = null, db = prisma, rules = defaultRules, now = new Date() }) {
  if (!vendorId || !userId) throw new FairError(403, "vendor_only", "Doar vendorii pot accepta regula.");
  const offer = fairPriceOffer(rules);
  if (!offer.available) {
    throw new FairError(409, "pricing_terms_not_available", "Regula nouă nu este încă publicată.");
  }
  if (body?.accepted !== true) {
    throw new FairError(400, "acceptance_required", "Bifează acceptarea regulii noi.", {
      fields: { accepted: "Bifează că ai citit și accepți documentul." },
    });
  }
  if (String(body?.termsVersion ?? "").trim() !== offer.version) {
    throw new FairError(409, "terms_version_changed", "Documentul s-a actualizat între timp. Reîncarcă pagina și citește versiunea nouă.");
  }

  const fair = await ensureFair(db);
  const registration = await findRegistration(db, fair.id, vendorId);
  if (!registration || !ACCEPTABLE.has(registration.status)) {
    throw new FairError(409, "registration_not_active", "Regula se poate accepta doar pentru o înscriere trimisă sau aprobată.");
  }
  if (registration.pricingModel === PRICING_MODELS.FAIR_PRICE) {
    return { changed: false, pricing: serializeState(registration, offer) };
  }

  // condiționat: două acceptări simultane => una singură scrie
  const res = await db.artfestFairRegistration.updateMany({
    where: { id: registration.id, pricingModel: PRICING_MODELS.COMMISSION, status: { in: [...PRICING_ACCEPT_STATUSES] } },
    data: {
      pricingModel: PRICING_MODELS.FAIR_PRICE,
      pricingModelAcceptedAt: now,
      pricingModelTermsVersion: offer.version,
      pricingModelAcceptedById: userId,
      pricingModelAcceptIp: ip ? String(ip).slice(0, LIMITS.ip) : null,
      pricingModelAcceptUa: ua ? String(ua).slice(0, LIMITS.ua) : null,
    },
  });
  const updated = await findRegistration(db, fair.id, vendorId);
  return { changed: res.count === 1, pricing: serializeState(updated, offer) };
}
