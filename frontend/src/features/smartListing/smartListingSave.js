// src/features/smartListing/smartListingSave.js
//
// Salvarea REALĂ a unui produs NOU din Smart Listing - fără sistem paralel:
//   payload  = buildProductPayload(form)   (identic cu ProfilMagazin.handleSaveProduct)
//   endpoint = POST /api/vendors/store/:slug/products  (vendorProductRoutes.createProduct)
// Serverul rulează neschimbat: limita de plan (402), validările de
// disponibilitate / configurație / preț / GPSR / colet, protecția datelor de
// contact (422) și moderarea AI (APPROVED / PENDING / CHANGES_REQUESTED).
//
// Smart Listing NU editează produse existente.

import { buildProductPayload } from "../../pages/Vendor/ProfilMagazin/utils/productPayload.js";
import { writeAvailabilityHandoff, writeSourceDraftLink } from "../../pages/Vendor/ProfilMagazin/utils/productDraftHandoff.js";
import { rawCombinationOverrides } from "../../../../backend/src/lib/variantPricing.js";
import { readServerValidation } from "./smartListingServerErrors.js";

/** Payload-ul de creare (aruncă aceleași erori ca editorul: titlu / preț / categorie). */
export function buildCreatePayload(form) {
  return buildProductPayload(form);
}

export function createEndpoint(storeSlug) {
  return `/api/vendors/store/${encodeURIComponent(storeSlug)}/products`;
}

export async function createProduct({ api, storeSlug, form }) {
  if (!storeSlug) throw new Error("Alege magazinul în care adaugi produsul.");
  return api(createEndpoint(storeSlug), { method: "POST", body: buildCreatePayload(form) });
}

/**
 * Ce vede vânzătorul după salvare, din răspunsul REAL al serverului
 * (mapProduct + moderationReport).
 * @returns {{ tone: "success"|"pending"|"action", title: string, lines: string[] }}
 */
export function describeSaveResult(saved = {}) {
  const status = String(saved?.moderationStatus || "PENDING").toUpperCase();
  const report = saved?.moderationReport || null;

  if (status === "APPROVED") {
    return { tone: "success", title: "Produsul a fost publicat.", lines: ["Clienții îl pot vedea deja în magazinul tău."] };
  }

  if (report?.decision === "BLOCK_PUBLICATION" || status === "CHANGES_REQUESTED") {
    return {
      tone: "action",
      title: "Produsul a fost salvat, dar trebuie corectat înainte de publicare.",
      lines: [
        report?.message || saved?.moderationMessage || "Verifică mesajul primit în editorul produsului.",
        ...(report?.images || []).map((image) => `Imaginea ${image.position}: ${(image.messages || []).join(" ")}`),
      ],
    };
  }

  if (report?.action === "COMPLETE_GPSR") {
    return {
      tone: "action",
      title: "Produsul a fost salvat. Mai lipsesc informațiile de siguranță.",
      lines: [report.message, ...(report.missing || []).map((item) => `• ${item}`)].filter(Boolean),
    };
  }

  return {
    tone: "pending",
    title: "Produsul a fost salvat și este în verificare.",
    lines: [report?.message || "Va fi publicat după verificare. Nu trebuie să faci nimic momentan."],
  };
}

/** Mesaj clar pentru erorile de salvare (fără ferestre alert). */
export function describeSaveError(error) {
  const status = Number(error?.status) || null;
  const data = error?.data || {};
  if (status === 402 || data?.error === "upgrade_required") {
    return { code: "plan_limit", message: data?.message || "Ai atins limita de produse a abonamentului.", link: "/setari?tab=subscription" };
  }
  if (status === 422) {
    // protecția datelor de contact (lib/contactInfoGuard.js) - nimic salvat
    const read = readServerValidation(error);
    return {
      code: "contact_info",
      message:
        data?.message ||
        "Textul conține date de contact (telefon, email, link). Pe Artfest clienții te contactează prin mesagerie - elimină-le și încearcă din nou.",
      step: read.step,
      anchor: read.anchor,
      fieldErrors: read.fieldErrors,
    };
  }
  // backendul cere încă greutatea când checkoutul Sameday e activ: nu trimitem o valoare inventată
  if (status === 400 && data?.error === "shipping_weight_required") {
    return {
      code: "shipping_weight_required",
      message: "Pentru moment, Artfest cere greutatea coletului la acest produs. Continuă în Editorul avansat ca să o completezi. Ciorna rămâne salvată.",
    };
  }
  // validare: codul, mesajul și câmpul de la server -> pasul și câmpul din formular
  if (status === 400 || (status === 409 && /^gpsr_/.test(String(data?.error || "")))) {
    const read = readServerValidation(error);
    return { code: read.code, message: read.message, step: read.step, anchor: read.anchor, fieldErrors: read.fieldErrors };
  }
  if (status === 401 || status === 403) return { code: "auth", message: "Sesiunea a expirat sau contul nu poate adăuga produse. Autentifică-te din nou." };
  // fără răspuns: produsul poate exista deja, iar publish() verifică înainte de a reîncerca
  if (!status && /fetch|network/i.test(String(error?.message || ""))) {
    return {
      code: "no_response",
      message: "Nu am primit răspuns de la server. Ciorna rămâne salvată. Apasă din nou „Publică produsul”: verificăm întâi dacă produsul a fost deja creat.",
    };
  }
  // la 5xx, mesajul e un cod tehnic (ex. `server_error`), nu ceva util vânzătorului
  if (status && status >= 500) return { code: "server", message: "Serverul nu a putut finaliza acum. Încearcă din nou." };
  return { code: "server", message: error?.message || "Nu am putut salva produsul. Ciorna ta a rămas salvată pe acest dispozitiv." };
}

/* ---------------- Editorul avansat (ProductModal) ---------------- */

/**
 * Cheia de ciornă a ProductModal pentru un produs NOU
 * (useProductEditorController: `artfest-product-draft-${storeSlug || "default"}`).
 */
export function advancedEditorDraftKey(storeSlug) {
  return `artfest-product-draft-${storeSlug || "default"}`;
}

/**
 * Trece ciorna în Editorul avansat FĂRĂ pierderi: forma e deja cea a
 * editorului (buildDraftForm). ProductModal o restaurează la deschidere, iar
 * disponibilitatea / stocul / termenul vin prin transferul separat
 * (productDraftHandoff.js), fiindcă ciorna editorului nu le păstrează.
 */
export function handoffToAdvancedEditor({ storage, storeSlug, form, sourceDraft = null }) {
  const key = advancedEditorDraftKey(storeSlug);
  const payload = JSON.stringify(form);
  storage.setItem(key, payload);
  writeAvailabilityHandoff(storage, key, form);
  // ciorna Smart Listing rămâne; se șterge doar după ce editorul creează produsul
  writeSourceDraftLink(storage, key, sourceDraft);
  return payload.length;
}

/**
 * După un răspuns pierdut (rețea), serverul poate să fi creat deja produsul, iar
 * endpointul nu are cheie de idempotență. Înainte de o nouă încercare căutăm produsul
 * după titlu + prima fotografie. O eroare aici oprește reîncercarea, nu riscă un duplicat.
 */
export async function findCreatedProduct({ api, storeSlug, form }) {
  const data = await api(`${createEndpoint(storeSlug)}?limit=50`);
  const items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
  const title = String(form?.title || "").trim();
  const image = form?.images?.[0];
  return items.find((item) => String(item?.title || "").trim() === title && image && item?.images?.[0] === image) || null;
}

/**
 * Publicarea, pas cu pas, ca să știm unde a eșuat:
 *   "producer" - datele centrale ale producătorului (înainte de produs, ca în ProductModal);
 *   "lookup"   - după un răspuns pierdut: produsul poate exista deja;
 *   "create"   - POST-ul produsului;
 *   colecțiile se asociază DUPĂ ce produsul există, iar un eșec acolo NU
 *   transformă publicarea în eroare (altfel o reîncercare ar crea un duplicat).
 * Eroarea aruncată are `publishPhase`. Doar un răspuns pierdut la "create" face
 * următoarea încercare să caute întâi produsul (`lookupExisting`).
 */
export async function publishNewProduct({
  api,
  storeSlug,
  form,
  createForm = form,
  saveProducer = null,
  lookupExisting = false,
  onCreated = null,
  attachCollections = null,
}) {
  let phase = "producer";
  try {
    const producer = saveProducer ? await saveProducer() : null;
    phase = "lookup";
    const existing = lookupExisting ? await findCreatedProduct({ api, storeSlug, form }) : null;
    phase = "create";
    const saved = existing || (await createProduct({ api, storeSlug, form: createForm }));
    phase = "done";
    try {
      onCreated?.(saved);
    } catch {
      // produsul există deja: o eroare de interfață aici nu e o publicare eșuată
    }
    let collectionLines = [];
    if (attachCollections) {
      try {
        collectionLines = (await attachCollections(saved)) || [];
      } catch {
        collectionLines = [COLLECTIONS_ATTACH_FAILED];
      }
    }
    return { saved, producer, reused: Boolean(existing), collectionLines };
  } catch (error) {
    const out = error instanceof Error ? error : new Error(String(error?.message || error));
    if (!out.publishPhase) out.publishPhase = phase;
    throw out;
  }
}

// rezervă: SmartListingPage trimite propriul mesaj (smartListingCollections.js)
const COLLECTIONS_ATTACH_FAILED =
  "Produsul a fost salvat, dar nu l-am putut adăuga în colecțiile alese. Îl poți adăuga din pagina Colecții.";

/** După o eroare: următoarea publicare trebuie să verifice dacă produsul s-a creat? */
export function isAmbiguousCreateError(error) {
  return error?.publishPhase === "create" && describeSaveError(error).code === "no_response";
}

/** Configurații pe care Smart Listing nu le editează sigur -> Editorul avansat. */
export function needsAdvancedEditor(form = {}) {
  const reasons = [];
  if (rawCombinationOverrides(form.optionsSchema).length) reasons.push("prețuri speciale pe combinații");
  if (Array.isArray(form.repeatedGroups) && form.repeatedGroups.length) reasons.push("set / grup cu date per membru");
  return reasons;
}
