// src/features/smartListing/SmartListingEditPage.jsx
//
// Editarea unui produs EXISTENT în interfața Smart Listing (doar `vite dev` + flag;
// deschisă din „Editează produsul”). Aceeași fereastră ca la creare (SmartListingModal),
// fără fereastră în fereastră. Regulile de siguranță a datelor stau în smartListingEdit.js:
//   - formularul pornește din produs cu maparea editorului actual (productFormFromApi);
//   - la salvare pleacă DOAR câmpurile modificate, prin PUT /api/vendors/products/:id;
//   - variantele, personalizarea, cererea de ofertă și livrarea se păstrează neatinse
//     (se editează în „Editorul avansat”);
//   - AI-ul doar propune text; fiecare propunere se acceptă separat.
// Componente reutilizate: ProductGpsrSection (formularul GPSR simplificat), GpsrConfirmation,
// SmartListingCollections, regulile gpsrConfirmationRule, stilurile Smart Listing.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CATEGORIES_DETAILED, CATEGORY_LABELS } from "../../../../backend/src/constants/categories.js";
import GpsrConfirmation from "../../components/GpsrConfirmation.jsx";
import ProductPhotoUploader from "../../components/ProductPhotoUploader/ProductPhotoUploader.jsx";
import { prepareProductImage } from "../../lib/productImages/prepareProductImage.js";
import { useProductImageQueue } from "../../lib/productImages/useProductImageQueue.js";
import ProductGpsrSection from "../../pages/Vendor/ProfilMagazin/modals/ProductModal/components/ProductGpsrSection.jsx";
import { dispatchProductSaved } from "../../pages/Vendor/ProfilMagazin/utils/productEditing.js";
import { gpsrConfirmationRule } from "../../utils/gpsrConfirmationRule.js";
import { createDefaultServices, uploadWithServices } from "./smartListingServices.js";
import { analyzeProductPhotos } from "./smartListingAiClient.js";
import { describeSaveError } from "./smartListingSave.js";
import SmartListingCollections from "./SmartListingCollections.jsx";
import {
  SMART_LISTING_EDIT_SOURCE,
  acceptEditSuggestion,
  buildEditPayload,
  changedSinceLoaded,
  editFormFromProduct,
  editSuggestionsFromProposal,
  hasEditChanges,
} from "./smartListingEdit.js";
import { applyProductCollectionChanges, loadProductCollectionMembership } from "./smartListingProductCollections.js";
import styles from "./SmartListing.module.css";
import edit from "./SmartListingEdit.module.css";

const CATEGORY_GROUPS = CATEGORIES_DETAILED.reduce((groups, item) => {
  (groups[item.groupLabel] ||= []).push(item);
  return groups;
}, {});

const AVAILABILITY_OPTIONS = [
  { value: "READY", label: "Gata de livrare" },
  { value: "MADE_TO_ORDER", label: "Realizat la comandă" },
  { value: "PREORDER", label: "Precomandă" },
  { value: "SOLD_OUT", label: "Stoc epuizat" },
];

const SECTIONS = [
  { id: "sle-photos", label: "Fotografii" },
  { id: "sle-details", label: "Detalii" },
  { id: "sle-sell", label: "Preț și disponibilitate" },
  { id: "sle-safety", label: "Producător și siguranță" },
  { id: "sle-collections", label: "Colecții" },
  { id: "sle-save", label: "Salvare" },
];

const AI_FIELD_LABELS = {
  title: "Titlu",
  description: "Descriere",
  category: "Categorie",
  styleTags: "Stil",
  occasionTags: "Ocazii",
  careInstructions: "Instrucțiuni de îngrijire",
};

const productUrl = (id) => `/api/vendors/products/${encodeURIComponent(id)}`;

function statusChips(product) {
  const chips = [];
  const visible = product?.isActive !== false && !product?.isHidden;
  chips.push(visible ? { tone: "ok", text: "Vizibil în magazin" } : { tone: "warn", text: "Privat" });
  const moderation = String(product?.moderationStatus || "").toUpperCase();
  if (moderation === "PENDING") chips.push({ tone: "warn", text: "În verificare" });
  else if (moderation === "CHANGES_REQUESTED") chips.push({ tone: "warn", text: "Modificări cerute" });
  else if (moderation === "REJECTED") chips.push({ tone: "warn", text: "Respins" });
  else if (moderation === "APPROVED") chips.push({ tone: "ok", text: "Aprobat" });
  return chips;
}

/** Ce rămâne exact cum este (nu se editează aici). */
function keptConfiguration(form) {
  const lines = [];
  const options = Array.isArray(form.optionsSchema) ? form.optionsSchema : [];
  const custom = Array.isArray(form.customSchema) ? form.customSchema : [];
  const groups = Array.isArray(form.repeatedGroups) ? form.repeatedGroups : [];
  const quote = Array.isArray(form.quoteSchema) ? form.quoteSchema : [];
  if (options.length) {
    lines.push(`Variante: ${options.map((field) => `${field.label || "fără nume"} (${(field.options || field.values || []).length} valori)`).join(", ")}`);
  }
  if (custom.length) lines.push(`Personalizare: ${custom.map((field) => field.label || "câmp").join(", ")}`);
  if (groups.length) lines.push(`Grupuri repetate: ${groups.length}`);
  if (form.orderMode === "QUOTE_ONLY") lines.push(`Cerere de ofertă${quote.length ? `: ${quote.length} întrebări` : ""}`);
  if (Array.isArray(form.additionalCategories) && form.additionalCategories.length) {
    lines.push(`Categorii suplimentare: ${form.additionalCategories.map((key) => CATEGORY_LABELS[key] || key).join(", ")}`);
  }
  if (form.videoUrl) lines.push("Video de prezentare");
  return lines;
}

export default function SmartListingEditPage({
  productId,
  storeSlug = "",
  services: injected,
  embedded = false,
  closeApiRef = null,
  onClose,
  onOpenAdvanced,
}) {
  const services = useMemo(() => ({ ...createDefaultServices(), ...(injected || {}) }), [injected]);
  const { api } = services;
  const resolveUrl = services.resolveUrl || ((url) => url);

  const [load, setLoad] = useState({ status: "loading", product: null, original: null, error: "" });
  const [form, setForm] = useState(null);
  const [collections, setCollections] = useState({ status: "loading", initial: [], known: [], unknown: [], selected: [], error: "" });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saveOk, setSaveOk] = useState(null);
  const [conflict, setConflict] = useState(false);
  const [ai, setAi] = useState({ status: "idle", suggestions: [], error: "" });
  const [confirmLeave, setConfirmLeave] = useState(null); // "close" | "advanced" | null
  const saveLockRef = useRef(false);

  /*
   * Fotografiile: coada COMUNĂ (lib/productImages). Pornește cu imaginile
   * produsului (păstrate exact, chiar dacă vânzătorul nu le atinge); doar
   * URL-urile definitive ajung în form.images, în ordinea afișată.
   */
  const servicesRef = useRef(services);
  servicesRef.current = services;
  const { queue: photoQueue, state: photoState } = useProductImageQueue({
    upload: (file, ctx) => uploadWithServices(servicesRef.current, file, ctx),
    prepare: (file, info) => (servicesRef.current.prepareImage || prepareProductImage)(file, info),
  });
  const uploading = photoState.pendingCount;
  const photosReadyRef = useRef(false); // coada a primit imaginile produsului

  const vendorGpsrState = services.gpsr.useState({ enabled: true });

  /* ---------------- încărcare ---------------- */

  const loadProduct = useCallback(async () => {
    setLoad({ status: "loading", product: null, original: null, error: "" });
    try {
      const product = await api(productUrl(productId));
      const original = editFormFromProduct(product);
      setLoad({ status: "ready", product, original, error: "" });
      setForm({ ...original, gpsrConfirmed: false });
      photoQueue.reset(original.images || []);
      photosReadyRef.current = true;
      setConflict(false);
      setSaveError(null);
      const membership = await loadProductCollectionMembership({ api, productId: product.id || productId });
      setCollections({
        status: "ready",
        initial: membership.memberIds,
        known: membership.knownIds,
        unknown: membership.unknownIds,
        selected: membership.memberIds,
        error: membership.error,
      });
    } catch (error) {
      setLoad({ status: "error", product: null, original: null, error: error?.status === 404 || error?.status === 403 ? "Produsul nu există sau nu îți aparține." : "Nu am putut încărca produsul." });
    }
  }, [api, productId, photoQueue]);

  useEffect(() => {
    loadProduct();
  }, [loadProduct]);

  // coada -> form.images (doar URL-uri definitive, în ordinea afișată)
  const photoUrlsKey = photoState.urls.join("\n");
  useEffect(() => {
    if (!photosReadyRef.current) return;
    const urls = photoUrlsKey ? photoUrlsKey.split("\n") : [];
    setForm((current) => {
      if (!current) return current;
      if ((current.images || []).join("\n") === photoUrlsKey) return current;
      return { ...current, images: urls };
    });
  }, [photoUrlsKey]);

  /* ---------------- stare derivată ---------------- */

  const original = load.original;
  const collectionChanges = useMemo(() => {
    const a = [...collections.initial].sort().join("|");
    const b = [...collections.selected].sort().join("|");
    return a !== b;
  }, [collections.initial, collections.selected]);
  const productDirty = Boolean(form && original && hasEditChanges(original, form));
  // fotografiile încă în lucru / cu eroare contează ca modificări nesalvate (confirmare la închidere)
  const dirty = productDirty || collectionChanges || photoState.pendingCount > 0 || photoState.failedCount > 0;

  // aceeași regulă ca ProductModal: produsul inițial + starea declarației de pe server (GET /:id)
  const gpsrRule =
    form && original
      ? gpsrConfirmationRule({
          form,
          editingProduct: { ...original, gpsrDeclaration: load.product?.gpsrDeclaration ?? null },
          vendorGpsrState,
        })
      : { required: false, reason: "" };
  const kept = form ? keptConfiguration(form) : [];
  const hasOrderConfiguration = Boolean(form && (form.orderMode === "OPTIONS" || form.orderMode === "QUOTE_ONLY"));

  const set = (field) => (value) => {
    setSaveOk(null);
    setForm((current) => ({ ...current, [field]: value }));
  };

  /* ---------------- închidere cu modificări nesalvate ---------------- */

  const requestClose = useCallback(() => {
    if (saving) return;
    if (dirty) {
      setConfirmLeave("close");
      return;
    }
    onClose?.();
  }, [dirty, onClose, saving]);

  if (closeApiRef) closeApiRef.current = { requestClose };

  const openAdvanced = () => {
    if (dirty) {
      setConfirmLeave("advanced");
      return;
    }
    onOpenAdvanced?.(productId);
  };

  /* fotografii: adăugare / ordine / principală / eliminare / retry -> photoQueue (ProductPhotoUploader) */

  /* ---------------- AI: doar propuneri ---------------- */

  const askAi = async () => {
    if (ai.status === "loading") return;
    setAi({ status: "loading", suggestions: [], error: "" });
    try {
      const { proposal } = await analyzeProductPhotos({ imageUrls: form.images, api, resolveUrl });
      const suggestions = editSuggestionsFromProposal(form, proposal);
      setAi({ status: "ready", suggestions, error: suggestions.length ? "" : "AI-ul nu are propuneri diferite de ce ai deja." });
    } catch (error) {
      setAi({ status: "error", suggestions: [], error: error?.message || "Sugestiile AI nu sunt disponibile acum." });
    }
  };

  const resolveAi = (suggestion, accept) => {
    if (accept) {
      setSaveOk(null);
      setForm((current) => acceptEditSuggestion(current, suggestion));
    }
    setAi((current) => ({ ...current, suggestions: current.suggestions.filter((item) => item !== suggestion) }));
  };

  /* ---------------- salvare ---------------- */

  const save = async () => {
    if (saveLockRef.current || saving || !form || !original) return;
    if (uploading) {
      setSaveError({ message: "Așteaptă să se încarce fotografiile." });
      return;
    }
    if (photoState.failedCount) {
      setSaveError({
        message: `${photoState.failedCount === 1 ? "O fotografie nu s-a încărcat" : `${photoState.failedCount} fotografii nu s-au încărcat`}. Apasă „Reîncearcă” sau elimin-o; celelalte fotografii sunt păstrate.`,
      });
      return;
    }
    if (!form.images?.length) {
      setSaveError({ message: "Produsul trebuie să aibă cel puțin o fotografie." });
      return;
    }
    if (gpsrRule.required && form.gpsrConfirmed !== true) {
      setSaveError({ message: "Bifează confirmarea GPSR înainte de salvare." });
      return;
    }

    let built;
    try {
      built = buildEditPayload(original, { ...form, gpsrConfirmationSource: SMART_LISTING_EDIT_SOURCE });
    } catch (error) {
      setSaveError({ message: error?.message || "Verifică datele produsului." });
      return;
    }
    if (!built.changed.length && !collectionChanges) {
      setSaveError({ message: "Nu ai modificat nimic." });
      return;
    }

    saveLockRef.current = true;
    setSaving(true);
    setSaveError(null);
    setSaveOk(null);
    try {
      const id = load.product.id || productId;
      let saved = null;
      if (built.changed.length) {
        // produsul s-a schimbat între timp (altă fereastră / alt dispozitiv): nu suprascriem
        const current = await api(productUrl(id));
        if (changedSinceLoaded(load.product, current)) {
          setConflict(true);
          setSaveError({ message: "Produsul a fost modificat între timp, în altă fereastră. Modificările tale au rămas aici; reîncarcă produsul înainte să salvezi." });
          return;
        }
        // producătorul propriu: datele centrale se salvează înaintea produsului (ca editorul actual)
        if (form.isOwnManufacturer === true) await services.gpsr.saveIfNeeded();
        saved = await api(productUrl(id), { method: "PUT", body: built.payload });
      }

      const lines = [];
      if (collectionChanges) {
        const result = await applyProductCollectionChanges({
          api,
          productId: id,
          initialIds: collections.initial,
          selectedIds: collections.selected,
          knownIds: collections.known,
        });
        if (result.failed.length) lines.push("Unele colecții nu s-au putut actualiza. Produsul a fost salvat.");
      }

      // starea nouă vine de la server (fără presupuneri locale)
      const fresh = await api(productUrl(id)).catch(() => null);
      if (saved || fresh) dispatchProductSaved(fresh || saved, { isEdit: true });
      if (fresh) {
        const nextOriginal = editFormFromProduct(fresh);
        setLoad((current) => ({ ...current, product: fresh, original: nextOriginal }));
        setForm({ ...nextOriginal, gpsrConfirmed: false });
      }
      if (collectionChanges) {
        const membership = await loadProductCollectionMembership({ api, productId: id });
        setCollections({ status: "ready", initial: membership.memberIds, known: membership.knownIds, unknown: membership.unknownIds, selected: membership.memberIds, error: membership.error });
      }
      const moderation = String((fresh || saved)?.moderationStatus || "").toUpperCase();
      if (moderation === "PENDING") lines.unshift("Produsul trece prin verificarea automată Artfest.");
      setSaveOk({ title: "Modificările au fost salvate.", lines });
    } catch (error) {
      // formularul rămâne exact cum l-a lăsat vânzătorul
      setSaveError(describeSaveError(error));
    } finally {
      saveLockRef.current = false;
      setSaving(false);
    }
  };

  /* ---------------- randare ---------------- */

  const Body = embedded ? "div" : "main";
  const header = (
    <header className={styles.modalHeader}>
      <div className={styles.modalHeading}>
        <h1 id="sl-modal-title" className={styles.modalTitle}>
          Editează produsul
        </h1>
        <span className={styles.modalTagline}>{form?.title || "Se încarcă produsul…"}</span>
      </div>
      <button type="button" className={styles.modalClose} onClick={requestClose} aria-label="Închide editorul">
        ×
      </button>
    </header>
  );

  if (load.status !== "ready" || !form) {
    return (
      <div className={`${styles.page} ${embedded ? styles.pageEmbedded : ""}`} data-testid="sl-edit">
        {embedded && header}
        <Body className={embedded ? styles.modalBody : styles.main}>
          {load.status === "error" ? (
            <section className={styles.card} role="alert">
              <p>{load.error}</p>
              <div className={styles.rowActions}>
                <button type="button" className={styles.secondaryBtn} onClick={loadProduct}>
                  Reîncearcă
                </button>
                <button type="button" className={styles.ghostBtn} onClick={() => onClose?.()}>
                  Închide
                </button>
              </div>
            </section>
          ) : (
            <p className={styles.hint} role="status">
              Se încarcă produsul…
            </p>
          )}
        </Body>
      </div>
    );
  }

  return (
    <div className={`${styles.page} ${embedded ? styles.pageEmbedded : ""}`} data-testid="sl-edit" data-product-id={load.product.id}>
      {embedded && header}
      <Body className={embedded ? styles.modalBody : styles.main}>
        <div className={styles.main}>
          <div className={edit.chips}>
            {statusChips(load.product).map((chip) => (
              <span key={chip.text} className={chip.tone === "ok" ? edit.chipOk : edit.chipWarn}>
                {chip.text}
              </span>
            ))}
          </div>

          <nav className={edit.nav} aria-label="Secțiunile produsului">
            {SECTIONS.map((section) => (
              <a key={section.id} href={`#${section.id}`}>
                {section.label}
              </a>
            ))}
          </nav>

          {/* ---------- fotografii ---------- */}
          <section id="sle-photos" className={styles.card} aria-labelledby="sle-photos-title">
            <h2 id="sle-photos-title" className={styles.cardTitle}>
              Fotografii
            </h2>
            {/* selectorul COMUN: imaginile existente rămân până le elimini; cel puțin o fotografie */}
            <ProductPhotoUploader
              queue={photoQueue}
              state={photoState}
              resolveUrl={resolveUrl}
              minPhotos={1}
              idPrefix="sle-photos"
            />
          </section>

          {/* ---------- detalii + AI ---------- */}
          <section id="sle-details" className={styles.card} aria-labelledby="sle-details-title">
            <h2 id="sle-details-title" className={styles.cardTitle}>
              Detalii
            </h2>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="sle-title">
                Titlu
              </label>
              <input id="sle-title" className={styles.input} value={form.title} maxLength={200} onChange={(event) => set("title")(event.target.value)} />
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="sle-description">
                Descriere
              </label>
              <textarea id="sle-description" className={styles.textarea} rows={6} value={form.description} onChange={(event) => set("description")(event.target.value)} />
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="sle-category">
                Categorie
              </label>
              <select id="sle-category" className={styles.input} value={form.category} onChange={(event) => set("category")(event.target.value)}>
                <option value="">Alege categoria</option>
                {form.category && !CATEGORY_LABELS[form.category] ? <option value={form.category}>{form.category}</option> : null}
                {Object.entries(CATEGORY_GROUPS).map(([group, items]) => (
                  <optgroup key={group} label={group}>
                    {items.map((item) => (
                      <option key={item.key} value={item.key}>
                        {item.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>

            <div className={edit.suggestionActions}>
              <button type="button" className={styles.secondaryBtn} onClick={askAi} disabled={ai.status === "loading" || !form.images.length}>
                {ai.status === "loading" ? "AI analizează…" : "✨ Sugestii AI pentru prezentare"}
              </button>
            </div>
            <p className={styles.hint}>
              AI-ul propune doar titlul, descrierea, categoria, etichetele și îngrijirea. Nimic nu se schimbă până nu accepți. Prețul,
              stocul, variantele, fotografiile, materialele, dimensiunile și datele de siguranță nu sunt modificate de AI.
            </p>
            {ai.error ? (
              <p className={ai.status === "error" ? styles.inlineError : styles.hint} role={ai.status === "error" ? "alert" : "status"}>
                {ai.error}
              </p>
            ) : null}
            {ai.suggestions.length > 0 && (
              <ul className={edit.suggestions} data-testid="sle-ai-suggestions">
                {ai.suggestions.map((suggestion) => (
                  <li key={suggestion.field} className={edit.suggestion} data-ai-field={suggestion.field}>
                    <strong>{AI_FIELD_LABELS[suggestion.field] || suggestion.field}</strong>
                    <div className={edit.suggestionValues}>
                      {suggestion.current ? (
                        <span>
                          Acum: <del>{suggestion.field === "category" ? CATEGORY_LABELS[suggestion.current] || suggestion.current : suggestion.current}</del>
                        </span>
                      ) : null}
                      <span>
                        Propunere: <b>{suggestion.field === "category" ? CATEGORY_LABELS[suggestion.proposed] || suggestion.proposed : suggestion.proposed}</b>
                      </span>
                    </div>
                    <div className={edit.suggestionActions}>
                      <button type="button" className={styles.secondaryBtn} onClick={() => resolveAi(suggestion, true)}>
                        Acceptă
                      </button>
                      <button type="button" className={styles.ghostBtn} onClick={() => resolveAi(suggestion, false)}>
                        Ignoră
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <details className={styles.details}>
              <summary>Materiale, dimensiuni, etichete și îngrijire</summary>
              {[
                ["color", "Culoare"],
                ["materialMain", "Material principal"],
                ["technique", "Tehnică"],
                ["dimensions", "Dimensiuni"],
                ["styleTags", "Stil (separate prin virgulă)"],
                ["occasionTags", "Ocazii (separate prin virgulă)"],
              ].map(([field, label]) => (
                <div key={field} className={styles.field}>
                  <label className={styles.label} htmlFor={`sle-${field}`}>
                    {label}
                  </label>
                  <input id={`sle-${field}`} className={styles.input} value={form[field] || ""} onChange={(event) => set(field)(event.target.value)} />
                </div>
              ))}
              {[
                ["careInstructions", "Instrucțiuni de îngrijire"],
                ["specialNotes", "Mențiuni speciale"],
              ].map(([field, label]) => (
                <div key={field} className={styles.field}>
                  <label className={styles.label} htmlFor={`sle-${field}`}>
                    {label}
                  </label>
                  <textarea id={`sle-${field}`} className={styles.textarea} rows={3} value={form[field] || ""} onChange={(event) => set(field)(event.target.value)} />
                </div>
              ))}
            </details>
          </section>

          {/* ---------- preț + disponibilitate ---------- */}
          <section id="sle-sell" className={styles.card} aria-labelledby="sle-sell-title">
            <h2 id="sle-sell-title" className={styles.cardTitle}>
              Preț și disponibilitate
            </h2>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="sle-price">
                {form.orderMode === "QUOTE_ONLY" ? "Preț orientativ" : hasOrderConfiguration ? "Preț de bază" : "Preț"}
              </label>
              <div className={styles.unitInput}>
                <input id="sle-price" className={styles.input} inputMode="decimal" value={form.price} onChange={(event) => set("price")(event.target.value.replace(",", "."))} />
                <span>lei</span>
              </div>
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="sle-availability">
                Disponibilitate
              </label>
              <select id="sle-availability" className={styles.input} value={form.availability} onChange={(event) => set("availability")(event.target.value)}>
                {AVAILABILITY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            {form.availability === "READY" && (
              <div className={styles.field}>
                <label className={styles.label} htmlFor="sle-stock">
                  Stoc
                </label>
                <div className={styles.unitInput}>
                  <input id="sle-stock" className={styles.input} inputMode="numeric" value={form.readyQty} onChange={(event) => set("readyQty")(event.target.value)} />
                  <span>buc.</span>
                </div>
              </div>
            )}
            {form.availability === "MADE_TO_ORDER" && (
              <div className={styles.field}>
                <label className={styles.label} htmlFor="sle-lead">
                  În câte zile îl realizezi?
                </label>
                <div className={styles.unitInput}>
                  <input id="sle-lead" className={styles.input} inputMode="numeric" value={form.leadTimeDays} onChange={(event) => set("leadTimeDays")(event.target.value)} />
                  <span>zile</span>
                </div>
              </div>
            )}
            {form.availability === "PREORDER" && (
              <div className={styles.field}>
                <label className={styles.label} htmlFor="sle-ship">
                  Data livrării
                </label>
                <input id="sle-ship" type="date" className={styles.input} value={form.nextShipDate} onChange={(event) => set("nextShipDate")(event.target.value)} />
              </div>
            )}

            {kept.length > 0 && (
              <>
                <p className={styles.hint}>Se păstrează exact cum sunt (le modifici din editorul avansat):</p>
                <ul className={edit.keepList} data-testid="sle-kept">
                  {kept.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                <div className={styles.rowActions}>
                  <button type="button" className={styles.linkBtn} onClick={openAdvanced}>
                    Modifică variantele sau personalizarea în editorul avansat
                  </button>
                </div>
              </>
            )}
          </section>

          {/* ---------- producător și siguranță (formularul GPSR simplificat, același ca în editorul actual) ---------- */}
          <section id="sle-safety" className={styles.card}>
            <div className={edit.gpsrWrap}>
              <ProductGpsrSection form={form} setForm={(updater) => {
                setSaveOk(null);
                setForm(updater);
              }} productId={load.product.id} />
            </div>
          </section>

          {/* ---------- colecții ---------- */}
          <div id="sle-collections">
            <SmartListingCollections
              api={api}
              enabled={collections.status === "ready"}
              selectedIds={collections.selected}
              lockedIds={collections.unknown}
              intro="Colecțiile în care produsul este deja inclus sunt bifate. Poți adăuga sau scoate produsul din colecții."
              onChange={(ids) => {
                setSaveOk(null);
                // o colecție necunoscută nu se poate schimba; iar o colecție ștearsă între timp nu se poate „scoate”
                setCollections((current) => ({ ...current, selected: ids }));
              }}
            />
            {collections.error ? <p className={styles.hint}>{collections.error}</p> : null}
          </div>

          {/* ---------- salvare ---------- */}
          <section id="sle-save" className={styles.card} aria-label="Salvare">
            {gpsrRule.required && (
              <GpsrConfirmation checked={form.gpsrConfirmed === true} onChange={set("gpsrConfirmed")} reason={gpsrRule.reason} showError={Boolean(saveError) && !form.gpsrConfirmed} />
            )}

            {saveError && (
              <div className={styles.alert} role="alert">
                <strong>{saveError.message}</strong>
                {conflict && (
                  <button type="button" className={styles.linkBtn} onClick={loadProduct}>
                    Reîncarcă produsul (modificările nesalvate se pierd)
                  </button>
                )}
              </div>
            )}

            {saveOk && (
              <div className={edit.success} role="status">
                <strong>{saveOk.title}</strong>
                {saveOk.lines.map((line) => (
                  <p key={line} className={styles.hint}>
                    {line}
                  </p>
                ))}
              </div>
            )}

            {confirmLeave && (
              <div className={edit.confirmBar} role="alertdialog" aria-label="Modificări nesalvate">
                <strong>Ai modificări nesalvate.</strong>
                <span className={styles.hint}>{confirmLeave === "advanced" ? "Editorul avansat se deschide cu produsul salvat, fără modificările de aici." : "Dacă închizi acum, modificările se pierd."}</span>
                <div className={styles.rowActions}>
                  <button type="button" className={styles.secondaryBtn} onClick={() => setConfirmLeave(null)}>
                    Rămân în editor
                  </button>
                  <button
                    type="button"
                    className={styles.ghostBtn}
                    onClick={() => {
                      const target = confirmLeave;
                      setConfirmLeave(null);
                      if (target === "advanced") onOpenAdvanced?.(productId);
                      else onClose?.();
                    }}
                  >
                    {confirmLeave === "advanced" ? "Deschide fără să salvez" : "Închide fără să salvez"}
                  </button>
                </div>
              </div>
            )}

            <button type="button" className={styles.primaryBtnWide} onClick={save} disabled={saving || uploading > 0}>
              {saving ? "Se salvează…" : "Salvează modificările"}
            </button>
            <p className={styles.hint}>Se salvează doar ce ai modificat; restul produsului rămâne neschimbat.</p>
            <div className={styles.rowActions}>
              <button type="button" className={styles.linkBtn} onClick={openAdvanced}>
                Deschide în editorul avansat
              </button>
            </div>
          </section>
        </div>
      </Body>
    </div>
  );
}
