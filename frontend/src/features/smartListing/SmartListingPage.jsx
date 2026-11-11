// src/features/smartListing/SmartListingPage.jsx
//
// Artfest Smart Listing - formularul pentru CREAREA de produse noi
// („Adaugă fotografiile. Artfest te ajută cu restul.”).
//
// Integrare REALĂ, fără sistem paralel:
//   - fotografii: POST /api/upload (lib/uploadFile, aceeași comprimare ca
//     editorul actual); video: componenta existentă ProductVideoField;
//   - AI: POST /ai/product-analyze - exact integrarea din ProductModal
//     (smartListingAiClient.js); rezultatul NU suprascrie ce a scris vânzătorul;
//   - GPSR: datele centrale Vendor.gpsrManufacturer* (utils/vendorGpsrManufacturer.js);
//   - salvare: buildProductPayload + POST /api/vendors/store/:slug/products
//     (moderare AI, aprobare Admin, GPSR, variante, colet, date de contact -
//     toate pe server, neschimbate);
//   - ajutor: tichet de suport existent (categoria „Publicare produs”).
//
// Doar CREARE. Produsele existente se editează în continuare în ProductModal
// („Editor avansat”). Acces: smartListingAccess.js (doar local, cu flag).
// Serviciile sunt injectabile (`services`) DOAR pentru teste; fluxul real nu
// conține date demonstrative.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CATEGORIES_DETAILED, CATEGORY_LABELS } from "../../../../backend/src/constants/categories.js";
import { COLORS_DETAILED, COLOR_LABELS } from "../../../../backend/src/constants/colors.js";
import { STYLE_TAGS_DETAILED } from "../../../../backend/src/constants/stylesTags.js";
import { OCCASION_TAGS_DETAILED } from "../../../../backend/src/constants/occasinsTags.js";
import { checkProductForPublish } from "../../utils/productPublishCheck.js";
import ProductVideoField from "../../components/ProductVideoField.jsx";

import { FIELD_STATUS, applyProposalToDraft, resolveSuggestion } from "./smartListingProposal.js";
import {
  CUSTOM_FIELD_TYPES,
  SALE_TYPES,
  buildDraftForm,
  evaluatePublishGate,
  formatLei,
  previewFinalPrices,
  splitValueList,
} from "./smartListingConfig.js";
import { MAX_PHOTOS, checkImageFile } from "./smartListingMedia.js";
import {
  PRODUCER_KINDS,
  centralGpsrWillChange,
  producerSuggestions,
  producerSummary,
  producerToProductFields,
  publicProducerPreview,
  validateProducerProfile,
} from "./smartListingProducer.js";
import { analyzeProductPhotos } from "./smartListingAiClient.js";
import {
  buildDraftSnapshot,
  deleteDraftEntry,
  draftKey,
  hasMeaningfulDraft,
  listDrafts,
  newDraftId,
  saveDraftEntry,
} from "./smartListingDraft.js";
import { openSavedProductHelpTicket, requestArtfestHelp } from "./smartListingHelp.js";
import { HELP_MESSAGE_MAX, buildHelpNote, missingForPrivateSave, submitHelpRequest } from "./smartListingHelpRequest.js";
import GpsrAddressHelp from "../../components/GpsrAddressHelp.jsx";
import { newHelpRequestKey } from "../../utils/gpsrAddressHelp.js";
import GpsrAddressChoice from "../../components/GpsrAddressChoice.jsx";
import GpsrInfoPanel from "../../components/GpsrInfoPanel.jsx";
import GpsrConfirmation from "../../components/GpsrConfirmation.jsx";
import {
  GPSR_CHILDREN_HINT,
  GPSR_CHILDREN_QUESTION,
  GPSR_WARNINGS_HINT,
  GPSR_WARNINGS_QUESTION,
  gpsrWarningsAnswer,
} from "../../utils/gpsrNotice.js";
import { APPLY_MODES, ORDER_AI_MAX_MESSAGE, askOrderAssistant, describeOrderAiError, mergeOrderConfig } from "./smartListingOrderAi.js";
import {
  createProduct,
  describeSaveError,
  describeSaveResult,
  findCreatedProduct,
  handoffToAdvancedEditor,
  needsAdvancedEditor,
} from "./smartListingSave.js";
import { smartListingAccessFor } from "./smartListingAccess.js";
import { createDefaultServices } from "./smartListingServices.js";
import { createPreviewServices, installPreviewNetworkGuard } from "./smartListingPreview.js";
import SmartListingPreviewEditor from "./SmartListingPreviewEditor.jsx";
import SmartListingCollections from "./SmartListingCollections.jsx";
import { ATTACH_FAILED_LINE, attachProductToCollections, describeAttachResult, normalizeCollectionIds } from "./smartListingCollections.js";
import styles from "./SmartListing.module.css";

const STEPS = [
  { key: "photos", label: "Fotografii" },
  { key: "details", label: "Detalii" },
  { key: "sell", label: "Preț și opțiuni" },
  { key: "review", label: "Publicare" },
];

const STEP_KEYS = STEPS.map((item) => item.key);
const EMPTY_LIST = Object.freeze([]);

const EMPTY_DETAILS = {
  title: "",
  description: "",
  category: "",
  additionalCategories: [],
  color: "",
  styleTags: [],
  occasionTags: [],
  materialMain: "",
  technique: "",
  careInstructions: "",
  dimensions: "",
};

const EMPTY_COMMERCE = {
  saleType: SALE_TYPES.IN_STOCK,
  price: "",
  stock: "",
  leadTimeDays: "",
};

const FIELD_LABELS = {
  title: "Titlu",
  description: "Descriere",
  category: "Categorie",
  additionalCategories: "Categorii suplimentare",
  color: "Culoare principală",
  styleTags: "Stil",
  occasionTags: "Ocazii",
  materialMain: "Material principal",
  technique: "Cum este lucrat",
  careInstructions: "Îngrijire",
};

// câmpul din pasul Detalii pe care îl focalizează „Rezolvă”
const FIELD_ANCHORS = {
  title: "sl-title",
  description: "sl-description",
  category: "sl-category",
  color: "sl-color",
  styleTags: "sl-style",
  occasionTags: "sl-occasions",
};

const CUSTOM_TYPE_LABELS = {
  text: "Text scurt",
  textarea: "Text lung",
  date: "Dată",
  file: "Fotografie",
};

const CATEGORY_GROUPS = CATEGORIES_DETAILED.reduce((groups, item) => {
  (groups[item.groupLabel] ||= []).push(item);
  return groups;
}, {});

function withoutKey(object, key) {
  const next = { ...object };
  delete next[key];
  return next;
}

let idCounter = 0;
const nextId = (prefix) => `${prefix}-${Date.now().toString(36)}-${(idCounter += 1)}`;

function displayValue(field, value) {
  if (Array.isArray(value)) {
    return field === "additionalCategories" ? value.map((key) => CATEGORY_LABELS[key] || key).join(", ") : value.join(", ");
  }
  if (field === "category") return CATEGORY_LABELS[value] || value;
  if (field === "color") return COLOR_LABELS[value] || value;
  return String(value || "");
}

// unde duce „Rezolvă” din verificarea existentă, în pașii formularului
function stepForIssue(issue) {
  if (String(issue?.code || "").startsWith("GPSR")) return "review";
  const target = issue?.target || {};
  if (target.step === "images") return "photos";
  if (target.step === "details") return "details";
  return "sell";
}

/* ======================================================================= */

export default function SmartListingPage({
  me,
  initialStoreSlug = "",
  services: injected,
  access: accessProp,
  onNavigate,
  embedded = false,
  closeApiRef = null,
  onClose,
  onRestart,
  onOpenAdvanced,
}) {
  const access = accessProp || smartListingAccessFor(me);
  const isPreview = access.mode === "preview";
  const services = useMemo(() => {
    const base = createDefaultServices();
    if (!isPreview) return { ...base, ...(injected || {}) };
    // previzualizare: servicii locale, fără rețea (smartListingPreview.js)
    const preview = createPreviewServices();
    return { ...base, ...preview, gpsr: { ...base.gpsr, ...preview.gpsr }, ...(injected || {}) };
  }, [injected, isPreview]);
  const { api, storage } = services;
  const navigate = useCallback((to) => (onNavigate ? onNavigate(to) : window.location.assign(to)), [onNavigate]);

  // previzualizare: browserul refuză orice scriere cât timp pagina e deschisă
  useEffect(() => (isPreview ? installPreviewNetworkGuard() : undefined), [isPreview]);

  const [step, setStep] = useState("photos");
  const [stores, setStores] = useState({ status: "loading", items: [] });
  const [storeSlug, setStoreSlug] = useState(initialStoreSlug);
  const [declaration, setDeclaration] = useState({ status: "loading", blocked: false });

  const [photos, setPhotos] = useState([]); // { id, previewUrl, uploadedUrl, status, name, error }
  const [photoErrors, setPhotoErrors] = useState([]);
  const [video, setVideo] = useState(null); // { url, muted }
  const [ai, setAi] = useState({ status: "idle", proposal: null, error: "", dropped: [] });

  const [details, setDetails] = useState(EMPTY_DETAILS);
  const [touched, setTouched] = useState(() => new Set());
  const [fieldStatus, setFieldStatus] = useState({});
  const [conflicts, setConflicts] = useState([]);
  const [hints, setHints] = useState([]);

  // null = încă nu a răspuns; false = nu are opțiuni; true = are
  const [wantsOptions, setWantsOptions] = useState(false);
  // separat de variante: una nu o dezactivează și nu o șterge pe cealaltă
  const [wantsPersonalization, setWantsPersonalization] = useState(false);
  const [variantAnswers, setVariantAnswers] = useState({});
  const [variants, setVariants] = useState([]);
  const [customAnswers, setCustomAnswers] = useState({});
  const [customFields, setCustomFields] = useState([]);

  const [commerce, setCommerce] = useState(EMPTY_COMMERCE);

  // siguranța SPECIFICĂ produsului; producătorul vine din profilul vânzătorului
  const [safety, setSafety] = useState({ safetyWarnings: null, isForChildren: null });
  const [producerChoice, setProducerChoice] = useState(null); // "self" | "other" | null
  const [selfConfirmed, setSelfConfirmed] = useState(false);
  const [otherProducer, setOtherProducer] = useState(null);
  const [producerEditor, setProducerEditor] = useState(null); // { profile, isNew }

  const [helpOpen, setHelpOpen] = useState(false);
  const [helpProductId, setHelpProductId] = useState(""); // produs privat deja creat, solicitare nefinalizată
  const [collectionIds, setCollectionIds] = useState([]); // colecții proprii alese (opțional)
  // declarația GPSR: NU se salvează în ciornă (se bifează la publicare, de fiecare dată)
  const [gpsrConfirmed, setGpsrConfirmed] = useState(false);
  const [orderAiOpen, setOrderAiOpen] = useState(false);
  // rămâne la închiderea ferestrei: conversația nu se pierde și nu atinge formularul
  const [orderAi, setOrderAi] = useState({ message: "", history: [], proposal: null, status: "idle", error: "" });
  const [focusId, setFocusId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saveResult, setSaveResult] = useState(null);
  const [draftChoices, setDraftChoices] = useState(null); // null = neverificat; [] = nimic de ales
  const [draftToDelete, setDraftToDelete] = useState(null);
  const [draftStatus, setDraftStatus] = useState({ status: "idle", savedAt: null });
  const [draftNotice, setDraftNotice] = useState("");
  const [closeConfirm, setCloseConfirm] = useState(false);
  const bodyRef = useRef(null);
  const [previewEditorForm, setPreviewEditorForm] = useState(null);
  const [advancedGpsrNotice, setAdvancedGpsrNotice] = useState(false);

  const gpsrState = services.gpsr.useState({ enabled: access.allowed });

  // o singură bifă GPSR: acoperă și actualizarea datelor centrale de producător.
  // Confirmarea e valabilă doar pentru datele văzute: orice modificare a lor o anulează.
  const gpsrDraftKey = JSON.stringify(gpsrState?.draft || null);
  useEffect(() => setGpsrConfirmed(false), [gpsrDraftKey]);

  /* ---------------- magazin + declarația produselor ---------------- */

  useEffect(() => {
    if (!access.allowed) return undefined;
    let alive = true;
    api("/api/vendors/me/services?includeProfile=1")
      .then((data) => {
        if (!alive) return;
        const items = (Array.isArray(data?.items) ? data.items : [])
          .filter((service) => service?.type?.code === "products" && service?.profile?.slug)
          .map((service) => ({ slug: service.profile.slug, name: service.profile.displayName || service.title || service.profile.slug }));
        setStores({ status: "ready", items });
        setStoreSlug((current) => (items.some((item) => item.slug === current) ? current : items.length === 1 ? items[0].slug : ""));
      })
      .catch(() => alive && setStores({ status: "error", items: [] }));
    return () => {
      alive = false;
    };
  }, [api, access.allowed]);

  // același gate ca ProfilMagazin.handleAddProduct: declarația e cerută doar
  // înainte de PRIMUL produs al magazinului
  useEffect(() => {
    if (!access.canSave || !storeSlug) return undefined;
    let alive = true;
    setDeclaration({ status: "loading", blocked: false });
    Promise.all([
      api(`/api/vendors/store/${encodeURIComponent(storeSlug)}/products?limit=1`).catch(() => null),
      api("/api/vendor/product-declaration/status").catch(() => null),
    ]).then(([products, declaration]) => {
      if (!alive) return;
      const list = Array.isArray(products?.items) ? products.items : Array.isArray(products) ? products : [];
      const blocked = list.length === 0 && declaration && declaration.accepted === false;
      setDeclaration({ status: "ready", blocked: Boolean(blocked) });
    });
    return () => {
      alive = false;
    };
  }, [api, access.canSave, storeSlug]);

  /* ---------------- ciorna locală ---------------- */

  const userKey = me?.id || me?.sub || "";
  const draftScope = useMemo(() => ({ userId: userKey, storeSlug }), [userKey, storeSlug]);
  const helpStateRef = useRef({ product: null, ambiguous: false });
  const draftIdRef = useRef("");
  const draftDoneRef = useRef(false); // produsul a fost creat: ciorna nu se mai rescrie
  const checkedScopeRef = useRef("");
  const lastSavedRef = useRef("");
  const choosingDraft = Boolean(draftChoices?.length);

  // la deschidere: ciornele acestui utilizator pentru acest magazin
  useEffect(() => {
    if (!storage || !storeSlug || !userKey) return;
    const scopeId = `${userKey}:${storeSlug}`;
    if (checkedScopeRef.current === scopeId) return;
    checkedScopeRef.current = scopeId;
    setDraftChoices(listDrafts(storage, draftScope));
  }, [storage, storeSlug, userKey, draftScope]);

  const restoreDraft = (entry) => {
    const snapshot = entry?.snapshot;
    if (!snapshot) return;
    setPhotos(
      (snapshot.photos || []).map((photo) => ({
        id: nextId("photo"),
        previewUrl: "",
        uploadedUrl: photo.uploadedUrl,
        status: "done",
        name: photo.name || "",
      }))
    );
    if (snapshot.video) setVideo(snapshot.video);
    if (snapshot.details) setDetails({ ...EMPTY_DETAILS, ...snapshot.details });
    if (snapshot.commerce) setCommerce({ ...EMPTY_COMMERCE, ...snapshot.commerce });
    if (Array.isArray(snapshot.variants)) setVariants(snapshot.variants);
    if (Array.isArray(snapshot.customFields)) setCustomFields(snapshot.customFields);
    if (snapshot.wantsOptions !== undefined) setWantsOptions(snapshot.wantsOptions);
    // ciornele vechi țineau variantele și personalizarea împreună
    setWantsPersonalization(snapshot.wantsPersonalization ?? Boolean(snapshot.customFields?.length));
    if (snapshot.helpProductId) {
      setHelpProductId(snapshot.helpProductId);
      helpStateRef.current.product = { id: snapshot.helpProductId };
    }
    if (snapshot.safety) setSafety(snapshot.safety);
    if (Array.isArray(snapshot.collectionIds)) setCollectionIds(normalizeCollectionIds(snapshot.collectionIds));
    if (snapshot.otherProducer) setOtherProducer(snapshot.otherProducer);
    if (snapshot.producerChoice) setProducerChoice(snapshot.producerChoice);
    if (snapshot.variantAnswers) setVariantAnswers(snapshot.variantAnswers);
    if (snapshot.customAnswers) setCustomAnswers(snapshot.customAnswers);
    if (snapshot.fieldStatus) setFieldStatus(snapshot.fieldStatus);
    if (Array.isArray(snapshot.conflicts)) setConflicts(snapshot.conflicts);
    if (Array.isArray(snapshot.hints)) setHints(snapshot.hints);
    // tot ce vine dintr-o ciornă veche e al vânzătorului: AI-ul nu îl mai suprascrie
    setTouched(new Set(snapshot.touched || Object.keys(EMPTY_DETAILS).filter((key) => String(snapshot.details?.[key] ?? "").length)));
    setAi({ status: "manual", proposal: null, error: "", dropped: [], ...(snapshot.ai || {}) });
    setStep(STEP_KEYS.includes(snapshot.step) ? snapshot.step : snapshot.photos?.length ? "details" : "photos");
    if (snapshot.pendingPhotos > 0) {
      setDraftNotice(`${snapshot.pendingPhotos} fotografii nu apucaseră să se încarce înainte de închidere și nu au putut fi păstrate. Alege-le din nou.`);
    }
    if (entry.id) {
      draftIdRef.current = entry.id;
    } else {
      // ciornă veche, cu o singură cheie: continuă în formatul cu mai multe ciorne
      deleteDraftEntry(storage, draftScope, "");
    }
    setDraftChoices([]);
  };

  // „Începe produs nou”: ciornele existente rămân neatinse
  const startNewDraft = () => setDraftChoices([]);

  const confirmDeleteDraft = () => {
    if (!draftToDelete) return;
    deleteDraftEntry(storage, draftScope, draftToDelete.id);
    setDraftChoices(listDrafts(storage, draftScope));
    setDraftToDelete(null);
  };

  const changeStore = (nextSlug) => {
    // ciorna începută merge cu vânzătorul în magazinul ales, nu rămâne dublată
    if (draftIdRef.current && storeSlug) {
      deleteDraftEntry(storage, draftScope, draftIdRef.current);
      checkedScopeRef.current = `${userKey}:${nextSlug}`;
    }
    setStoreSlug(nextSlug);
  };

  const draftState = useMemo(
    () => ({
      photos,
      video,
      details,
      commerce,
      variants,
      customFields,
      wantsOptions,
      wantsPersonalization,
      helpProductId,
      safety,
      otherProducer,
      producerChoice,
      variantAnswers,
      customAnswers,
      fieldStatus,
      conflicts,
      hints,
      touched: [...touched],
      ai,
      step,
      // fără colecții alese, ciorna rămâne identică cu cea de dinainte
      collectionIds: collectionIds.length ? collectionIds : undefined,
    }),
    [photos, video, details, commerce, variants, customFields, wantsOptions, wantsPersonalization, helpProductId, safety, otherProducer, producerChoice, variantAnswers, customAnswers, fieldStatus, conflicts, hints, touched, ai, step, collectionIds]
  );

  const draftStateRef = useRef(draftState);
  draftStateRef.current = draftState;
  const canAutosaveRef = useRef(false);
  canAutosaveRef.current = Boolean(storage && storeSlug && userKey && draftChoices && !choosingDraft && !draftDoneRef.current);
  const draftScopeRef = useRef(draftScope);
  draftScopeRef.current = draftScope;

  const draftFingerprint = (state) => JSON.stringify(buildDraftSnapshot(state, new Date(0)));

  // scrie DOAR în localStorage: fără upload și fără produs în baza de date
  const flushDraft = useCallback(() => {
    if (!canAutosaveRef.current) return null;
    const state = draftStateRef.current;
    const fingerprint = draftFingerprint(state);
    if (fingerprint === lastSavedRef.current) return null;
    if (!draftIdRef.current) {
      // o ciornă goală nu merită salvată
      if (!hasMeaningfulDraft(buildDraftSnapshot(state))) return null;
      draftIdRef.current = newDraftId();
    }
    const snapshot = saveDraftEntry(storage, draftScopeRef.current, draftIdRef.current, state);
    if (snapshot) lastSavedRef.current = fingerprint;
    setDraftStatus(snapshot ? { status: "saved", savedAt: snapshot.savedAt } : { status: "error", savedAt: null });
    return snapshot;
  }, [storage]);

  // autosalvare cu pauză, ca să nu scriem la fiecare tastă
  useEffect(() => {
    if (!storage || !storeSlug || choosingDraft || saveResult) return undefined;
    const timer = window.setTimeout(flushDraft, 800);
    return () => window.clearTimeout(timer);
  }, [storage, storeSlug, draftState, choosingDraft, saveResult, flushDraft]);

  // reîncărcare, tab închis sau telefon blocat: scriem imediat ce a rămas nesalvat
  useEffect(() => {
    const onHide = () => flushDraft();
    const onVisibility = () => document.visibilityState === "hidden" && flushDraft();
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVisibility);
      flushDraft(); // închiderea formularului
    };
  }, [flushDraft]);

  /* ---------------- navigare / focus ---------------- */

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const element = focusId ? document.getElementById(focusId) : null;
      if (element) {
        element.scrollIntoView?.({ behavior: "smooth", block: "center" });
        element.focus?.({ preventScroll: true });
        setFocusId(null);
      } else {
        (bodyRef.current || window).scrollTo?.({ top: 0, behavior: "smooth" });
      }
    }, 60);
    return () => window.clearTimeout(timer);
  }, [step, focusId]);

  const goTo = (target, anchor = null) => {
    setStep(target);
    setFocusId(anchor);
  };

  /* ---------------- fotografii (upload real) ---------------- */

  const uploadOne = useCallback(
    async (id, file) => {
      try {
        let url;
        try {
          url = await services.uploadImage(await services.compressImage(file));
        } catch {
          // ca editorul actual: dacă varianta procesată eșuează, încearcă originalul
          url = await services.uploadImage(file);
        }
        setPhotos((current) =>
          current.map((photo) => (photo.id === id ? { ...photo, uploadedUrl: url, status: "done", error: "" } : photo))
        );
      } catch (error) {
        setPhotos((current) =>
          current.map((photo) =>
            photo.id === id
              ? { ...photo, status: "error", error: error?.message || "Nu am putut încărca fotografia." }
              : photo
          )
        );
      }
    },
    [services]
  );

  const addFiles = useCallback(
    (fileList) => {
      const files = Array.from(fileList || []);
      const errors = [];
      const accepted = [];
      for (const file of files) {
        const check = checkImageFile(file);
        if (check.ok) accepted.push(file);
        else errors.push(check.message);
      }
      setPhotos((current) => {
        const room = Math.max(0, MAX_PHOTOS - current.length);
        if (accepted.length > room) errors.push(`Poți adăuga cel mult ${MAX_PHOTOS} fotografii.`);
        const added = accepted.slice(0, room).map((file) => {
          const photo = {
            id: nextId("photo"),
            previewUrl: URL.createObjectURL(file),
            uploadedUrl: "",
            // previzualizare: fotografia rămâne doar în browser, fără upload
            status: isPreview ? "done" : "uploading",
            name: file.name,
            error: "",
          };
          if (!isPreview) window.setTimeout(() => uploadOne(photo.id, file), 0);
          return photo;
        });
        return [...current, ...added];
      });
      setPhotoErrors(errors);
    },
    [uploadOne, isPreview]
  );

  const removePhoto = (id) =>
    setPhotos((current) => {
      const photo = current.find((item) => item.id === id);
      if (photo?.previewUrl) URL.revokeObjectURL(photo.previewUrl);
      return current.filter((item) => item.id !== id);
    });

  const movePhoto = (id, delta) =>
    setPhotos((current) => {
      const from = current.findIndex((item) => item.id === id);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= current.length) return current;
      const next = [...current];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });

  const makeMain = (id) =>
    setPhotos((current) => {
      const photo = current.find((item) => item.id === id);
      return photo ? [photo, ...current.filter((item) => item.id !== id)] : current;
    });

  const photosRef = useRef(photos);
  photosRef.current = photos;
  useEffect(() => () => photosRef.current.forEach((photo) => photo.previewUrl && URL.revokeObjectURL(photo.previewUrl)), []);

  const uploadedUrls = photos
    .filter((photo) => photo.status === "done" && (photo.uploadedUrl || (isPreview && photo.previewUrl)))
    .map((photo) => photo.uploadedUrl || photo.previewUrl);
  const uploadingCount = photos.filter((photo) => photo.status === "uploading").length;
  const failedCount = photos.filter((photo) => photo.status === "error").length;

  /* ---------------- AI real ---------------- */

  const applyAiResult = (result) => {
    const applied = applyProposalToDraft(details, result.proposal, { touched });
    setDetails({ ...EMPTY_DETAILS, ...applied.draft });
    setFieldStatus(applied.fieldStatus);
    setConflicts(applied.conflicts);
    setHints(applied.hints);
    // cu indicii de variante întrebăm; fără, „nu” e implicit (un click mai puțin)
    setWantsOptions((current) => (current === true ? true : result.proposal.variantHints.length ? null : current));
    setAi({ status: "done", proposal: result.proposal, error: "", dropped: result.dropped });
    setStep("details");
  };

  const runAnalysis = async () => {
    if (isPreview) return; // previzualizare: fără apel la AI
    setAi({ status: "loading", proposal: null, error: "", dropped: [] });
    try {
      const result = await analyzeProductPhotos({ imageUrls: uploadedUrls, api, resolveUrl: services.resolveUrl });
      applyAiResult(result);
    } catch (error) {
      setAi({ status: "failed", proposal: null, error: error?.message || "Analiza nu a reușit.", dropped: [] });
    }
  };

  const continueManually = () => {
    setAi((current) => ({ ...current, status: current.status === "failed" ? "failed" : "manual" }));
    setStep("details");
  };

  /* ---------------- detalii ---------------- */

  const editDetail = (field, value) => {
    setDetails((current) => ({ ...current, [field]: value }));
    setTouched((current) => new Set(current).add(field));
    // o valoare editată de vânzător nu mai e „propusă de AI”
    setFieldStatus((current) => withoutKey(current, field));
  };

  const confirmField = (field) => setFieldStatus((current) => withoutKey(current, field));

  const decideConflict = (conflict, accept) => {
    setDetails((current) => resolveSuggestion(current, conflict, accept));
    setConflicts((current) => current.filter((item) => item.field !== conflict.field));
    setTouched((current) => new Set(current).add(conflict.field));
  };

  const decideHint = (hint, accept) => {
    if (accept) {
      setDetails((current) => resolveSuggestion(current, hint, true));
      setTouched((current) => new Set(current).add(hint.field));
    }
    setHints((current) => current.filter((item) => item.field !== hint.field));
  };

  /* ---------------- variante / personalizare ---------------- */

  const variantHints = ai.proposal?.variantHints || [];
  const personalizationHints = ai.proposal?.personalizationHints || [];

  const answerVariantHint = (hint, yes) => {
    setVariantAnswers((current) => ({ ...current, [hint.key]: yes ? "yes" : "no" }));
    if (yes) setWantsOptions(true);
    setVariants((current) => {
      const without = current.filter((variant) => variant.fromHint !== hint.key);
      if (!yes) return without;
      // valorile observate NU se adaugă automat - vânzătorul le alege
      return [...without, { id: nextId("variant"), fromHint: hint.key, label: hint.label, required: true, values: [] }];
    });
  };

  const answerCustomHint = (hint, yes) => {
    setCustomAnswers((current) => ({ ...current, [hint.key]: yes ? "yes" : "no" }));
    if (yes) setWantsPersonalization(true);
    setCustomFields((current) => {
      const without = current.filter((field) => field.fromHint !== hint.key);
      if (!yes) return without;
      return [...without, { id: nextId("custom"), fromHint: hint.key, label: hint.label, type: hint.type, required: true }];
    });
  };

  // „Nu” doar ascunde: variantele scrise rămân în ciornă și revin la „Da”
  const setNoOptions = () => {
    setWantsOptions(false);
    setVariantAnswers((current) => ({ ...Object.fromEntries(variantHints.map((hint) => [hint.key, "no"])), ...current }));
  };

  // pe produs ajunge doar ce e activat; personalizarea și variantele sunt independente
  const activeVariants = wantsOptions === true ? variants : EMPTY_LIST;
  const activeCustomFields = wantsPersonalization ? customFields : EMPTY_LIST;

  const updateVariant = (id, patch) =>
    setVariants((current) => current.map((variant) => (variant.id === id ? { ...variant, ...patch } : variant)));

  const removeVariant = (id) => {
    const variant = variants.find((item) => item.id === id);
    if (variant?.fromHint) setVariantAnswers((current) => ({ ...current, [variant.fromHint]: "no" }));
    setVariants((current) => current.filter((item) => item.id !== id));
  };

  const updateCustomField = (id, patch) =>
    setCustomFields((current) => current.map((field) => (field.id === id ? { ...field, ...patch } : field)));

  const removeCustomField = (id) => {
    const field = customFields.find((item) => item.id === id);
    if (field?.fromHint) setCustomAnswers((current) => ({ ...current, [field.fromHint]: "no" }));
    setCustomFields((current) => current.filter((item) => item.id !== id));
  };

  /* ---------------- producătorul (date reale ale vânzătorului) ---------------- */

  // „Eu”: datele centrale Vendor.gpsrManufacturer* (ciorna din editor, dacă există)
  const selfContact = gpsrState?.draft || gpsrState?.saved || { name: "", address: "", email: "" };
  const selfProfile = useMemo(
    () => ({
      id: "producer-self",
      kind: PRODUCER_KINDS.SELF,
      name: selfContact.name || "",
      address: selfContact.address || "",
      email: selfContact.email || "",
      // date deja salvate și complete = confirmate anterior; ciorna nouă cere confirmare
      confirmed: gpsrState?.draft ? selfConfirmed : Boolean(gpsrState?.complete),
    }),
    [selfContact.name, selfContact.address, selfContact.email, gpsrState?.draft, gpsrState?.complete, selfConfirmed]
  );

  const selectedProducer = producerChoice === "self" ? selfProfile : producerChoice === "other" ? otherProducer : null;

  // salvarea datelor centrale poate publica produse PENDING oprite doar de GPSR: cere confirmare separată
  const gpsrWillChange = producerChoice === "self" && centralGpsrWillChange(gpsrState);

  const saveProducer = (profile) => {
    if (profile.kind === PRODUCER_KINDS.SELF) {
      // se salvează pe server ÎMPREUNĂ cu produsul (ca în ProductModal)
      if (!gpsrState?.draft) services.gpsr.startEditing();
      services.gpsr.updateDraft({ name: profile.name, address: profile.address, email: profile.email });
      setSelfConfirmed(true);
      setProducerChoice("self");
    } else {
      setOtherProducer(profile);
      setProducerChoice("other");
    }
    setProducerEditor(null);
  };

  const accountForSuggestions = useMemo(() => {
    const store = stores.items.find((item) => item.slug === storeSlug);
    return { storeName: store?.name || "", legalName: "", accountEmail: me?.email || "" };
  }, [stores.items, storeSlug, me?.email]);

  /* ---------------- ciorna formularului + verificarea existentă ---------------- */

  const producerFields = useMemo(() => producerToProductFields(selectedProducer), [selectedProducer]);

  const draft = useMemo(
    () =>
      buildDraftForm({
        details,
        images: uploadedUrls,
        // greutatea se confirmă în Comenzi, la pregătirea coletului: nu se trimite nicio valoare aici
        commerce,
        variants: activeVariants,
        customFields: activeCustomFields,
        safety: { ...producerFields.safety, ...safety },
        video,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [details, uploadedUrls.join("|"), commerce, activeVariants, activeCustomFields, producerFields, safety, video]
  );

  // „Eu sunt producătorul”: aceeași sursă ca editorul actual (ciorna sau datele salvate)
  const vendorGpsr = producerChoice === "self" ? services.gpsr.forCheck(gpsrState) : null;

  const producerCheck = useMemo(
    () => (selectedProducer ? validateProducerProfile(selectedProducer) : null),
    [selectedProducer]
  );

  const check = useMemo(
    () =>
      checkProductForPublish(draft.form, {
        knownCategories: CATEGORIES_DETAILED.map((item) => item.key),
        vendorGpsr,
        isNewProduct: true,
        samedayShipping: false,
      }),
    [draft.form, vendorGpsr]
  );

  const pendingConfirmations = useMemo(
    () =>
      Object.entries(fieldStatus)
        .filter(([, status]) => status === FIELD_STATUS.CONFIRM)
        .map(([field]) => ({ field, label: FIELD_LABELS[field] || field })),
    [fieldStatus]
  );

  const advancedReasons = needsAdvancedEditor(draft.form);

  const gate = useMemo(() => {
    const extra = [];
    if (uploadingCount) extra.push({ code: "PHOTOS_UPLOADING", message: "Se încarcă încă fotografiile.", step: "photos" });
    if (failedCount) {
      extra.push({ code: "PHOTOS_FAILED", message: "Unele fotografii nu s-au încărcat - șterge-le sau adaugă-le din nou.", step: "photos" });
    }
    // fără mesaje duble: verificarea de publicare semnalează deja producătorul lipsă (GPSR_isOwnManufacturer)
    if (!producerChoice) {
      if (!check.errors.some((item) => item.code === "GPSR_isOwnManufacturer")) {
        extra.push({ code: "PRODUCER_MISSING", message: "Spune cine a realizat produsul (producătorul).", step: "review" });
      }
    } else if (producerCheck && !producerCheck.ok) {
      extra.push({
        code: "PRODUCER_PROFILE",
        message: `Datele producătorului „${selectedProducer?.name || "fără denumire"}” sunt incomplete - verifică-le.`,
        step: "review",
      });
    }
    // declarația GPSR: o singură bifă, doar la publicare (salvarea privată nu o cere);
    // când datele centrale de producător se schimbă, aceeași bifă confirmă și actualizarea lor
    if (!gpsrConfirmed) {
      extra.push({
        code: "GPSR_DECLARATION",
        message: gpsrWillChange
          ? "Bifează confirmarea GPSR: confirmi și actualizarea datelor tale de producător."
          : "Bifează confirmarea privind siguranța produselor (GPSR).",
        step: "review",
      });
    }
    return evaluatePublishGate({
      check,
      draftErrors: draft.errors,
      pendingConfirmations,
      conflicts: conflicts.map((conflict) => ({ ...conflict, label: FIELD_LABELS[conflict.field] || conflict.field })),
      extraBlockers: extra,
    });
  }, [check, draft.errors, pendingConfirmations, conflicts, producerCheck, selectedProducer, producerChoice, uploadingCount, failedCount, gpsrWillChange, gpsrConfirmed]);

  const prices = useMemo(() => previewFinalPrices(draft.form), [draft.form]);


  const blockerCountByStep = useMemo(() => {
    const map = {};
    for (const blocker of gate.blockers) {
      const target = blocker.step || stepForIssue(blocker.issue);
      map[target] = (map[target] || 0) + 1;
    }
    return map;
  }, [gate.blockers]);

  const resolveBlocker = (blocker) => {
    if (blocker.code === "AI_UNCONFIRMED" || blocker.code === "AI_CONFLICT") return goTo("details");
    if (blocker.code === "PRODUCER_PROFILE" && selectedProducer) {
      return setProducerEditor({ profile: selectedProducer, isNew: false });
    }
    if (blocker.step) return goTo(blocker.step, blocker.step === "review" ? "sl-safety" : null);
    const issue = blocker.issue;
    if (String(issue?.code || "").startsWith("GPSR")) return goTo("review", "sl-safety");
    const anchors = {
      PRICE_INVALID: "sl-price",
      STOCK_INVALID: "sl-stock",
      LEAD_TIME_INVALID: "sl-lead",
      TITLE_MISSING: "sl-title",
      TITLE_TOO_SHORT: "sl-title",
      DESCRIPTION_MISSING: "sl-description",
      CATEGORY_MISSING: "sl-category",
      CATEGORY_UNKNOWN: "sl-category",
    };
    const anchor = anchors[issue?.code] || null;
    return goTo(stepForIssue(issue), anchor || (stepForIssue(issue) === "sell" ? "sl-options" : null));
  };

  /* ---------------- publicare (salvare reală) ---------------- */

  const publishLockRef = useRef(false); // dublu click: starea `saving` ajunge prea târziu
  const ambiguousSaveRef = useRef(false); // răspuns pierdut: produsul poate exista deja

  // „Colecții” (opțional): după ce produsul există; un eșec aici nu anulează produsul salvat
  const attachCollections = async (saved, { publicNow }) => {
    const ids = normalizeCollectionIds(collectionIds);
    if (isPreview || !ids.length || !saved?.id) return [];
    try {
      const result = await attachProductToCollections({ api, productId: saved.id, collectionIds: ids });
      return describeAttachResult(result, { publicNow });
    } catch {
      return [ATTACH_FAILED_LINE];
    }
  };

  const publish = async () => {
    if (isPreview || !access.canSave || saving || !gate.ready || publishLockRef.current) return;
    if (helpProductId) {
      setSaveError({
        code: "help_pending",
        message: "Produsul este deja salvat privat pentru echipa Artfest. Retrimite solicitarea din „Cere ajutor echipei Artfest” sau deschide-l din lista ta de produse.",
      });
      return;
    }
    publishLockRef.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      // datele publice ale producătorului se salvează ÎNAINTE de produs (ca în ProductModal)
      const gpsrResult = producerChoice === "self" ? await services.gpsr.saveIfNeeded() : null;
      const existing = ambiguousSaveRef.current ? await findCreatedProduct({ api, storeSlug, form: draft.form }) : null;
      const saved =
        existing ||
        (await createProduct({
          api,
          storeSlug,
          form: { ...draft.form, gpsrConfirmed, gpsrConfirmationSource: "smart_listing" },
        }));
      // doar ciorna acestui produs dispare, celelalte rămân
      draftDoneRef.current = true;
      canAutosaveRef.current = false;
      if (storage && draftIdRef.current) deleteDraftEntry(storage, draftScope, draftIdRef.current);
      services.onProductSaved?.(saved);
      const view = describeSaveResult(saved);
      // transparență: reevaluarea existentă a publicat produse oprite doar de GPSR
      const autoApproved = gpsrResult?.autoApprovedProductIds?.length || 0;
      if (autoApproved) {
        view.lines = [...view.lines, `După actualizarea datelor de producător, Artfest a publicat și ${autoApproved} produs(e) care așteptau doar aceste date.`];
      }
      const collectionLines = await attachCollections(saved, {
        publicNow: String(saved?.moderationStatus || "").toUpperCase() === "APPROVED" && saved?.isActive !== false && !saved?.isHidden,
      });
      if (collectionLines.length) view.lines = [...view.lines, ...collectionLines];
      setSaveResult({ saved, view });
    } catch (error) {
      // fără răspuns de la server nu știm dacă produsul s-a creat: verificăm înainte de a reîncerca
      if (!error?.status) ambiguousSaveRef.current = true;
      setSaveError(describeSaveError(error));
    } finally {
      publishLockRef.current = false;
      setSaving(false);
    }
  };

  const goToAdvancedEditor = () => {
    flushDraft();
    const sourceDraft = draftIdRef.current
      ? {
          id: draftIdRef.current,
          key: draftKey({ ...draftScope, draftId: draftIdRef.current }),
          indexKey: `artfest-smart-listing-draft-index:${userKey}:${storeSlug}`,
        }
      : null;
    handoffToAdvancedEditor({ storage, storeSlug, form: draft.form, sourceDraft });
    if (onOpenAdvanced) onOpenAdvanced(storeSlug);
    else navigate(`/magazin/${encodeURIComponent(storeSlug)}?editorAvansat=1`);
  };

  const openAdvancedEditor = () => {
    if (isPreview) {
      setPreviewEditorForm(draft.form);
      return;
    }
    if (!storeSlug || !storage || uploadingCount) return;
    // Editorul avansat salvează datele centrale odată cu produsul (regula lui existentă)
    if (gpsrWillChange && !gpsrConfirmed) {
      setAdvancedGpsrNotice(true);
      return;
    }
    goToAdvancedEditor();
  };

  const advancedAvailable = isPreview || access.canSave;
  const advancedDisabled = !isPreview && (!storeSlug || uploadingCount > 0);

  // aceeași cheie pentru reîncercarea ACELUIAȘI mesaj: serverul nu creează un al doilea tichet
  const helpKeyRef = useRef(null);
  const sendHelp = async (note) => {
    flushDraft();
    if (helpKeyRef.current?.note !== note) helpKeyRef.current = { note, key: newHelpRequestKey() };
    const result = await requestArtfestHelp({
      api,
      note,
      step,
      form: draft.form,
      photos: uploadedUrls,
      storeSlug,
      draftId: draftIdRef.current || null,
      source: "smart_listing",
      requestKey: helpKeyRef.current.key,
    });
    helpKeyRef.current = null;
    return result;
  };

  /* ---------------- ajutor uman: produs privat + solicitare ---------------- */

  // doar mesajul, fără produs: tichetul de suport existent
  const sendHelpMessage = async (note) => {
    if (publishLockRef.current) return null;
    publishLockRef.current = true;
    try {
      flushDraft();
      return await sendHelp(note);
    } finally {
      publishLockRef.current = false;
    }
  };

  const sendPrivateHelp = async (message) => {
    if (isPreview || !access.canSave || saving || publishLockRef.current) return;
    publishLockRef.current = true;
    setSaving(true);
    try {
      flushDraft();
      const note = buildHelpNote({ message, variants, customFields, form: draft.form });
      const saved = await submitHelpRequest({
        api,
        storeSlug,
        form: draft.form,
        note,
        configErrors: draft.errors,
        findExisting: findCreatedProduct,
        state: helpStateRef.current,
      }).catch((error) => {
        if (helpStateRef.current.product) setHelpProductId(helpStateRef.current.product.id);
        throw error;
      });
      // aceeași cerere și ca tichet în Admin → Suport (adminul poate răspunde acolo).
      // Solicitarea e deja salvată pe produs: un eșec aici nu o pierde.
      const ticketLines = await openSavedProductHelpTicket({
        api,
        note,
        productId: saved.id,
        title: saved.title || draft.form.title,
        storeSlug,
        reviewRequestId: helpStateRef.current.reviewRequestId,
      })
        .then(() => [])
        .catch(() => ["Solicitarea e salvată și a ajuns la echipa Artfest."]);
      // abia acum: dacă pasul a eșuat, ciorna a rămas
      draftDoneRef.current = true;
      canAutosaveRef.current = false;
      if (storage && draftIdRef.current) deleteDraftEntry(storage, draftScope, draftIdRef.current);
      services.onProductSaved?.(saved);
      // produs privat: legătura cu colecția rămâne invizibilă public până la publicare
      const collectionLines = await attachCollections(saved, { publicNow: false });
      setHelpOpen(false);
      setSaveResult({
        saved,
        view: {
          tone: "pending",
          title: "Solicitarea a fost trimisă.",
          lines: [
            "Produsul este salvat și nu apare public.",
            "Echipa Artfest va analiza solicitarea și te va contacta pentru a te ajuta să finalizezi configurarea.",
            ...ticketLines,
            ...collectionLines,
          ],
        },
      });
    } finally {
      publishLockRef.current = false;
      setSaving(false);
    }
  };

  /* ---------------- asistentul AI pentru variante și personalizare ---------------- */

  const runOrderAi = async () => {
    const message = orderAi.message.trim();
    if (!message || orderAi.status === "loading") return;
    setOrderAi((current) => ({ ...current, status: "loading", error: "" }));
    try {
      const proposal = await askOrderAssistant({ api, message, form: draft.form, history: orderAi.history, images: uploadedUrls });
      setOrderAi((current) => ({
        ...current,
        status: "ready",
        proposal,
        message: "",
        history: [
          ...current.history,
          { role: "user", text: message },
          { role: "assistant", text: [proposal.message, ...proposal.questions].filter(Boolean).join("\n") },
        ],
      }));
    } catch (error) {
      // formularul și propunerea anterioară rămân; mesajul scris nu se pierde
      setOrderAi((current) => ({ ...current, status: "failed", error: describeOrderAiError(error) }));
    }
  };

  const applyOrderAi = (proposal, mode) => {
    const next = mergeOrderConfig({ variants, customFields }, proposal, mode, nextId);
    setVariants(next.variants);
    setCustomFields(next.customFields);
    if (next.variants.length) setWantsOptions(true);
    else if (wantsOptions === null) setWantsOptions(false);
    if (next.customFields.length) setWantsPersonalization(true);
    setOrderAi((current) => ({ ...current, proposal: null, status: "idle" }));
    setOrderAiOpen(false);
  };

  /* ---------------- închidere ---------------- */

  const hasProgress = hasMeaningfulDraft(buildDraftSnapshot(draftState)) || photos.length > 0;

  const closeNow = () => {
    flushDraft();
    setCloseConfirm(false);
    onClose?.();
  };

  const requestClose = (source) => {
    // o fereastră din formular e deschisă: ea primește Escape, nu tot formularul
    if (producerEditor || helpOpen || orderAiOpen || draftToDelete || advancedGpsrNotice || closeConfirm) return;
    if (saving) return;
    // X e o alegere clară; Escape și un click pe lângă pot fi accidentale
    if (saveResult || !hasProgress || choosingDraft || (source === "x" && !uploadingCount)) {
      closeNow();
      return;
    }
    flushDraft();
    setCloseConfirm(true);
  };

  if (closeApiRef) closeApiRef.current = { requestClose };

  /* ---------------- navigare ---------------- */

  const stepIndex = STEPS.findIndex((item) => item.key === step);
  const goNext = () => setStep(STEPS[Math.min(STEPS.length - 1, stepIndex + 1)].key);
  const goBack = () => setStep(STEPS[Math.max(0, stepIndex - 1)].key);

  /* ======================= randare ======================= */

  if (!access.allowed) {
    return (
      <div className={styles.page}>
        <section className={styles.card}>
          <h1 className={styles.cardTitle}>Formularul nou nu este disponibil</h1>
          <p className={styles.muted}>Folosește „Adaugă produs” din pagina magazinului tău.</p>
        </section>
      </div>
    );
  }

  if (saveResult) {
    return (
      <SaveResultView
        result={saveResult}
        storeSlug={storeSlug}
        onNavigate={navigate}
        embedded={embedded}
        onClose={closeNow}
        onRestart={onRestart}
      />
    );
  }

  // în fereastră, doar zona formularului are scroll; antetul și butoanele rămân pe loc
  const Body = embedded ? "div" : Fragment;
  const bodyProps = embedded ? { className: styles.modalBody, ref: bodyRef } : {};

  const helpButton = (
    <button
      type="button"
      className={embedded ? styles.linkBtn : styles.helpFab}
      onClick={() => {
        setHelpOpen(true);
      }}
    >
      {embedded ? null : <span aria-hidden="true">💬</span>} Cere ajutor echipei Artfest
    </button>
  );

  const draftIndicator =
    draftStatus.status === "saved" ? (
      <span className={styles.draftStatus} role="status">
        ✓ Ciornă salvată
      </span>
    ) : draftStatus.status === "error" ? (
      <span className={styles.draftStatusError} role="alert">
        Ciorna nu s-a putut salva pe acest dispozitiv
      </span>
    ) : null;

  return (
    <div className={`${styles.page} ${embedded ? styles.pageEmbedded : ""}`}>
      {embedded && (
        <header className={styles.modalHeader}>
          <div className={styles.modalHeading}>
            <h1 id="sl-modal-title" className={styles.modalTitle}>
              Adaugă un produs
            </h1>
            {draftIndicator || <span className={styles.modalTagline}>Adaugă fotografiile. Artfest te ajută cu restul.</span>}
          </div>
          <button type="button" className={styles.modalClose} onClick={() => requestClose("x")} aria-label="Închide formularul">
            ×
          </button>
        </header>
      )}

      <Body {...bodyProps}>
      {isPreview && (
        <div className={styles.previewBanner} role="note">
          <p className={styles.previewBannerText}>
            <strong>Previzualizare Admin</strong> · nimic nu se salvează. Încărcarea fișierelor, analiza AI, publicarea și
            trimiterea către suport sunt dezactivate. Produsele se creează din contul de vânzător.
          </p>
        </div>
      )}

      {!embedded && (
        <header className={styles.header}>
          <h1 className={styles.title}>Adaugă un produs</h1>
          <p className={styles.tagline}>Adaugă fotografiile. Artfest te ajută cu restul.</p>
          {draftIndicator}
        </header>
      )}

      {access.canSave && stores.status === "ready" && stores.items.length > 1 && (
        <label className={styles.storePicker}>
          Magazinul:
          <select value={storeSlug} onChange={(event) => changeStore(event.target.value)} aria-label="Magazinul">
            <option value="">Alege magazinul</option>
            {stores.items.map((store) => (
              <option key={store.slug} value={store.slug}>
                {store.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {access.canSave && stores.status === "ready" && !stores.items.length && (
        <p className={styles.notice}>Nu am găsit un magazin de produse activ pentru contul tău.</p>
      )}

      {access.canSave && declaration.status === "ready" && declaration.blocked && (
        <div className={styles.alert} role="alert">
          <strong>Înainte de primul produs trebuie să accepți declarația pentru produse.</strong>
          <span>Mergi în pagina magazinului și apasă „Adaugă produs” - după acceptare poți reveni aici.</span>
          <button type="button" className={styles.secondaryBtn} onClick={() => navigate(`/magazin/${encodeURIComponent(storeSlug)}`)}>
            Mergi la magazin
          </button>
        </div>
      )}

      {access.canSave && stores.status === "ready" && stores.items.length > 1 && !storeSlug && (
        <p className={styles.hint}>Alege magazinul ca să putem salva ciorna pe parcurs.</p>
      )}

      {draftNotice && (
        <p className={styles.notice} role="status">
          {draftNotice}
        </p>
      )}

      {choosingDraft ? (
        <section className={styles.card} aria-labelledby="sl-drafts-title">
          <h2 id="sl-drafts-title" className={styles.cardTitle}>
            {draftChoices.length === 1 ? "Ai o ciornă salvată" : `Ai ${draftChoices.length} ciorne salvate`}
          </h2>
          <p className={styles.muted}>Ciornele stau doar pe acest dispozitiv, până când le continui sau le elimini.</p>
          <ul className={styles.draftList}>
            {draftChoices.map((entry) => (
              <li key={entry.id || "veche"} className={styles.draftItem}>
                <div className={styles.draftInfo}>
                  <strong>{entry.snapshot.details?.title || "Produs fără titlu"}</strong>
                  <span className={styles.hint}>
                    {new Date(entry.snapshot.savedAt).toLocaleString("ro-RO")} · {entry.snapshot.photos?.length || 0} fotografii
                  </span>
                </div>
                <div className={styles.rowActions}>
                  <button type="button" className={styles.secondaryBtn} onClick={() => restoreDraft(entry)}>
                    Continuă ciorna
                  </button>
                  <button type="button" className={styles.linkBtnDanger} onClick={() => setDraftToDelete(entry)}>
                    Elimină
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <button type="button" className={styles.primaryBtn} onClick={startNewDraft}>
            Începe produs nou
          </button>
        </section>
      ) : (
      <>
      <nav className={styles.stepper} aria-label="Pașii adăugării">
        {STEPS.map((item, index) => {
          // previzualizare: toți pașii rămân accesibili, chiar și fără fotografii
          const locked = !isPreview && index > 0 && !photos.length;
          const blockers = blockerCountByStep[item.key] || 0;
          return (
            <button
              key={item.key}
              type="button"
              className={`${styles.stepDot} ${item.key === step ? styles.stepDotActive : ""}`}
              onClick={() => setStep(item.key)}
              disabled={locked}
              aria-current={item.key === step ? "step" : undefined}
            >
              <span className={styles.stepNumber}>{index + 1}</span>
              <span className={styles.stepLabel}>{item.label}</span>
              {blockers > 0 && step === "review" ? (
                <span className={styles.stepBadge} aria-label={`${blockers} de rezolvat`}>
                  {blockers}
                </span>
              ) : null}
            </button>
          );
        })}
      </nav>

      <main className={styles.main}>
        {step === "photos" && (
          <PhotosStep
            photos={photos}
            photoErrors={photoErrors}
            resolveUrl={services.resolveUrl}
            video={video}
            ai={ai}
            isPreview={isPreview}
            onFiles={addFiles}
            onRemove={removePhoto}
            onMove={movePhoto}
            onMakeMain={makeMain}
            onVideoChange={(url) => setVideo(url ? { url, muted: false } : null)}
            onVideoMuted={(muted) => setVideo((current) => (current ? { ...current, muted } : current))}
            onAnalyze={runAnalysis}
            onManual={continueManually}
          />
        )}

        {step === "details" && (
          <DetailsStep
            ai={ai}
            details={details}
            fieldStatus={fieldStatus}
            pendingConfirmations={pendingConfirmations.length}
            conflicts={conflicts}
            hints={hints}
            onEdit={editDetail}
            onConfirm={confirmField}
            onConflict={decideConflict}
            onHint={decideHint}
            onRetry={() => setStep("photos")}
          />
        )}

        {step === "sell" && (
          <SellStep
            wantsOptions={wantsOptions}
            onWantsOptions={(yes) => (yes ? setWantsOptions(true) : setNoOptions())}
            wantsPersonalization={wantsPersonalization}
            onWantsPersonalization={setWantsPersonalization}
            activeOptionCount={activeVariants.length + activeCustomFields.length}
            onOpenOrderAi={() => setOrderAiOpen(true)}
            onOpenHelp={() => setHelpOpen(true)}
            variantHints={variantHints}
            personalizationHints={personalizationHints}
            variantAnswers={variantAnswers}
            customAnswers={customAnswers}
            variants={variants}
            customFields={customFields}
            onVariantHint={answerVariantHint}
            onCustomHint={answerCustomHint}
            onAddVariant={() =>
              setVariants((current) => [...current, { id: nextId("variant"), label: "", required: true, values: [] }])
            }
            onUpdateVariant={updateVariant}
            onRemoveVariant={removeVariant}
            onAddCustom={() =>
              setCustomFields((current) => [...current, { id: nextId("custom"), label: "", type: "text", required: true, description: "" }])
            }
            onUpdateCustom={updateCustomField}
            onRemoveCustom={removeCustomField}
            optionErrors={draft.errors}
            commerce={commerce}
            setCommerce={setCommerce}
            saleType={draft.saleType}
            notices={draft.notices}
            orderModeHint={ai.proposal?.orderModeHint}
            advancedReasons={advancedReasons}
            onOpenAdvanced={advancedAvailable ? openAdvancedEditor : null}
          />
        )}

        {step === "review" && (
          <ReviewStep
            photos={photos}
            resolveUrl={services.resolveUrl}
            video={video}
            details={details}
            draft={draft}
            prices={prices}
            gate={gate}
            recommendations={check.recommendations}
            onResolve={resolveBlocker}
            onGoTo={goTo}
            onPublish={publish}
            saving={saving}
            canSave={access.canSave && !declaration.blocked}
            saveError={saveError}
            beforePublish={
              // „Adaugă în colecții” (opțional): card propriu, chiar înaintea butonului de publicare
              <SmartListingCollections
                api={api}
                enabled={!isPreview && access.canSave && Boolean(storeSlug)}
                selectedIds={collectionIds}
                onChange={setCollectionIds}
              />
            }
          >
            <ProducerSection
              gpsrState={gpsrState}
              selfProfile={selfProfile}
              otherProducer={otherProducer}
              producerChoice={producerChoice}
              selectedProducer={selectedProducer}
              producerCheck={producerCheck}
              onChoose={setProducerChoice}
              onEdit={(profile) => setProducerEditor({ profile, isNew: false })}
              onCreate={(kind) =>
                setProducerEditor({
                  isNew: true,
                  profile: { id: nextId("producer"), kind, name: "", address: "", email: "", confirmed: false },
                })
              }
              safety={safety}
              setSafety={setSafety}
            />
            <GpsrConfirmation
              checked={gpsrConfirmed}
              onChange={setGpsrConfirmed}
              disabled={isPreview}
              note={
                gpsrWillChange
                  ? "Datele tale de producător se salvează odată cu produsul și se aplică tuturor produselor la care ești producător. Produsele aflate în verificare doar din lipsa acestor date pot fi publicate automat."
                  : ""
              }
            />
          </ReviewStep>
        )}
      </main>
      </>
      )}
      </Body>

      {/* bara de acțiuni - mereu vizibilă */}
      {!choosingDraft && (
      <div className={styles.actionBar}>
        <div className={styles.actionBarLinks}>
          {advancedAvailable && (
            <button
              type="button"
              className={styles.linkBtn}
              onClick={openAdvancedEditor}
              disabled={advancedDisabled}
              title={advancedDisabled ? (storeSlug ? "Așteaptă încărcarea fotografiilor." : "Alege mai întâi magazinul.") : undefined}
            >
              Continuă în Editorul avansat
            </button>
          )}
          {embedded && helpButton}
        </div>
        <button type="button" className={styles.ghostBtn} onClick={goBack} disabled={stepIndex === 0}>
          Înapoi
        </button>
        {step === "review" ? (
          <button
            type="button"
            className={styles.primaryBtn}
            onClick={publish}
            disabled={!gate.ready || saving || !access.canSave || declaration.blocked}
          >
            {saving
              ? "Se salvează…"
              : !access.canSave
                ? "Previzualizare (fără salvare)"
                : gate.ready
                  ? "Publică produsul"
                  : `Mai ai ${gate.blockers.length} de rezolvat`}
          </button>
        ) : step === "photos" && isPreview ? (
          <button type="button" className={styles.primaryBtn} onClick={continueManually}>
            Continuă (fără analiză AI)
          </button>
        ) : step === "photos" ? (
          <button
            type="button"
            className={styles.primaryBtn}
            onClick={runAnalysis}
            disabled={!uploadedUrls.length || uploadingCount > 0 || ai.status === "loading"}
          >
            {ai.status === "loading"
              ? "Artfest analizează…"
              : uploadingCount
                ? "Se încarcă fotografiile…"
                : "Continuă cu Artfest AI"}
          </button>
        ) : (
          <button
            type="button"
            className={styles.primaryBtn}
            onClick={goNext}
            disabled={step === "sell" && wantsOptions === null}
          >
            {step === "sell" && wantsOptions === null ? "Răspunde la întrebarea despre opțiuni" : "Continuă"}
          </button>
        )}
      </div>
      )}

      {!embedded && !choosingDraft && helpButton}

      {draftToDelete && (
        <Sheet title="Elimini ciorna?" onClose={() => setDraftToDelete(null)}>
          <p className={styles.muted}>
            „{draftToDelete.snapshot.details?.title || "Produs fără titlu"}” va dispărea definitiv de pe acest dispozitiv. Celelalte
            ciorne și produsele publicate nu sunt afectate.
          </p>
          <div className={styles.rowActions}>
            <button type="button" className={styles.dangerBtn} onClick={confirmDeleteDraft}>
              Da, elimină ciorna
            </button>
            <button type="button" className={styles.ghostBtn} onClick={() => setDraftToDelete(null)}>
              Renunță
            </button>
          </div>
        </Sheet>
      )}

      {closeConfirm && (
        <Sheet title="Închizi formularul?" onClose={() => setCloseConfirm(false)}>
          <p className={styles.muted}>
            Ce ai completat rămâne în ciornă și îl poți relua la următorul „Adaugă produs”.
            {uploadingCount > 0 ? " Fotografiile care se încarcă acum nu vor fi păstrate." : ""}
          </p>
          <div className={styles.rowActions}>
            <button type="button" className={styles.primaryBtn} onClick={() => setCloseConfirm(false)}>
              Continuă editarea
            </button>
            <button type="button" className={styles.ghostBtn} onClick={closeNow}>
              Închide
            </button>
          </div>
        </Sheet>
      )}

      {producerEditor && (
        <ProducerEditor
          initial={producerEditor.profile}
          isNew={producerEditor.isNew}
          account={accountForSuggestions}
          safety={safety}
          onCancel={() => setProducerEditor(null)}
          onSave={saveProducer}
          gpsrHelpApi={api}
          draftId={draftIdRef.current || null}
          storeSlug={storeSlug}
          helpDisabled={isPreview}
          onRequestPrivateHelp={
            isPreview
              ? null
              : () => {
                  setProducerEditor(null);
                  setHelpOpen(true);
                }
          }
        />
      )}
      {helpOpen && (
        <HelpSheet
          onClose={() => setHelpOpen(false)}
          step={step}
          canSend={!isPreview && access.canSave && Boolean(storeSlug)}
          isPreview={isPreview}
          missing={missingForPrivateSave(draft.form)}
          busy={saving || uploadingCount > 0}
          uploading={uploadingCount > 0}
          onSendPrivate={sendPrivateHelp}
          onSendMessage={sendHelpMessage}
          describeError={describeSaveError}
          onGoTo={(target) => {
            setHelpOpen(false);
            goTo(target);
          }}
        />
      )}
      {orderAiOpen && (
        <OrderAiSheet
          state={orderAi}
          onChangeMessage={(message) => setOrderAi((current) => ({ ...current, message }))}
          onSend={runOrderAi}
          onApply={applyOrderAi}
          onClose={() => setOrderAiOpen(false)}
          hasExisting={variants.length > 0 || customFields.length > 0}
        />
      )}
      {previewEditorForm && (
        <SmartListingPreviewEditor initialForm={previewEditorForm} onClose={() => setPreviewEditorForm(null)} />
      )}
    </div>
  );
}

/* ======================= rezultatul salvării ======================= */

function SaveResultView({ result, storeSlug, onNavigate, embedded = false, onClose, onRestart }) {
  const { view, saved } = result;
  const toneClass = view.tone === "success" ? styles.ready : view.tone === "action" ? styles.alert : styles.notice;
  const Body = embedded ? "div" : Fragment;
  const bodyProps = embedded ? { className: styles.modalBody } : {};
  return (
    <div className={`${styles.page} ${embedded ? styles.pageEmbedded : ""}`}>
      {embedded && (
        <header className={styles.modalHeader}>
          <div className={styles.modalHeading}>
            <h1 id="sl-modal-title" className={styles.modalTitle}>
              Produs adăugat
            </h1>
          </div>
          <button type="button" className={styles.modalClose} onClick={onClose} aria-label="Închide">
            ×
          </button>
        </header>
      )}
      <Body {...bodyProps}>
      <section className={styles.card} aria-live="polite">
        <h1 className={styles.cardTitle}>{view.title}</h1>
        <div className={toneClass}>
          {view.lines.map((line) => (
            <p key={line} className={styles.noticeP}>
              {line}
            </p>
          ))}
        </div>
        <div className={styles.rowActions}>
          {storeSlug && (
            <button type="button" className={styles.primaryBtn} onClick={() => onNavigate(`/magazin/${encodeURIComponent(storeSlug)}`)}>
              Mergi la magazin
            </button>
          )}
          {saved?.id && view.tone === "success" && (
            <button type="button" className={styles.secondaryBtn} onClick={() => onNavigate(`/produs/${encodeURIComponent(saved.id)}`)}>
              Vezi produsul
            </button>
          )}
          <button type="button" className={styles.ghostBtn} onClick={() => (onRestart ? onRestart() : window.location.reload())}>
            Adaugă alt produs
          </button>
        </div>
      </section>
      </Body>
    </div>
  );
}

/* ======================= 1. Fotografii și video ======================= */

function PhotosStep({
  photos,
  photoErrors,
  resolveUrl,
  video,
  ai,
  isPreview = false,
  onFiles,
  onRemove,
  onMove,
  onMakeMain,
  onVideoChange,
  onVideoMuted,
  onAnalyze,
  onManual,
}) {
  const [dragging, setDragging] = useState(false);
  const uploading = photos.some((photo) => photo.status === "uploading");

  return (
    <section className={styles.card} aria-labelledby="sl-photos-title">
      <h2 id="sl-photos-title" className={styles.cardTitle}>
        Fotografii și video
      </h2>
      <p className={styles.muted}>
        Încarcă 1-{MAX_PHOTOS} fotografii clare ale produsului tău. Artfest AI le analizează și propune titlul, descrierea și
        caracteristicile - tu doar verifici.
      </p>

      <div className={styles.photoButtons}>
        <label className={`${styles.dropzone} ${dragging ? styles.dropzoneActive : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            onFiles(event.dataTransfer.files);
          }}
        >
          <input
            type="file"
            accept="image/*,.jpg,.jpeg,.jfif,.png,.webp,.gif,.heic,.heif,.bmp,.tif,.tiff,.avif"
            multiple
            className={styles.visuallyHidden}
            onChange={(event) => {
              onFiles(event.target.files);
              event.target.value = "";
            }}
          />
          <span className={styles.dropIcon} aria-hidden="true">
            🖼️
          </span>
          <strong>{photos.length ? "Adaugă încă o fotografie" : "Alege fotografii din galerie"}</strong>
          <span className={styles.muted}>sau trage fotografiile aici</span>
        </label>
        {/* pe telefon deschide direct camera (ca editorul actual) */}
        <label className={styles.cameraBtn}>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className={styles.visuallyHidden}
            onChange={(event) => {
              onFiles(event.target.files);
              event.target.value = "";
            }}
          />
          📷 Fă o poză
        </label>
      </div>

      {photoErrors.length > 0 && (
        <ul className={styles.inlineErrors} role="alert">
          {photoErrors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}

      {photos.length > 0 && (
        <ul className={styles.thumbs}>
          {photos.map((photo, index) => (
            <li key={photo.id} className={styles.thumb}>
              <img src={photo.uploadedUrl ? resolveUrl(photo.uploadedUrl) : photo.previewUrl} alt={`Fotografia ${index + 1}`} />
              {photo.status === "uploading" && (
                <span className={styles.thumbStatus} role="status">
                  Se încarcă…
                </span>
              )}
              {photo.status === "error" && (
                <span className={styles.thumbStatusError} role="alert" title={photo.error}>
                  Eroare la încărcare
                </span>
              )}
              {index === 0 ? (
                <span className={styles.thumbMain}>Principală</span>
              ) : (
                <button type="button" className={styles.thumbAction} onClick={() => onMakeMain(photo.id)}>
                  Fă principală
                </button>
              )}
              <div className={styles.thumbMove}>
                <button
                  type="button"
                  onClick={() => onMove(photo.id, -1)}
                  disabled={index === 0}
                  aria-label={`Mută fotografia ${index + 1} spre stânga`}
                >
                  ‹
                </button>
                <button
                  type="button"
                  onClick={() => onMove(photo.id, 1)}
                  disabled={index === photos.length - 1}
                  aria-label={`Mută fotografia ${index + 1} spre dreapta`}
                >
                  ›
                </button>
              </div>
              <button
                type="button"
                className={styles.thumbRemove}
                onClick={() => onRemove(photo.id)}
                aria-label={`Șterge fotografia ${index + 1}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {isPreview && (
        <p className={styles.hint}>Previzualizare: fotografiile rămân doar în browser, iar încărcarea video este dezactivată.</p>
      )}

      {/* video: componenta EXISTENTĂ (MP4/WebM, 50 MB, previzualizare, înlocuire, eliminare, fără sunet) */}
      <fieldset disabled={isPreview} className={styles.plainFieldset}>
        <ProductVideoField
          videoUrl={video?.url || null}
          videoMuted={Boolean(video?.muted)}
          onChange={onVideoChange}
          onMutedChange={onVideoMuted}
        />
      </fieldset>

      {ai.status === "loading" && (
        <div className={styles.aiLoading} role="status">
          <span className={styles.spinner} aria-hidden="true" />
          Artfest AI analizează fotografiile tale…
        </div>
      )}

      {ai.status === "failed" && (
        <div className={styles.alert} role="alert">
          <strong>{ai.error}</strong>
          <span>Poți încerca din nou sau poți completa singur detaliile - fotografiile rămân încărcate.</span>
          <div className={styles.rowActions}>
            <button type="button" className={styles.secondaryBtn} onClick={onAnalyze} disabled={uploading}>
              Încearcă din nou
            </button>
            <button type="button" className={styles.ghostBtn} onClick={onManual}>
              Completez manual
            </button>
          </div>
        </div>
      )}

      {photos.length > 0 && ai.status !== "failed" && ai.status !== "loading" && (
        <button type="button" className={styles.linkBtn} onClick={onManual}>
          Prefer să completez singur
        </button>
      )}
    </section>
  );
}


/* ======================= 2. Detalii ======================= */

function StatusBadge({ status, onConfirm }) {
  if (status === FIELD_STATUS.CONFIRM) {
    return (
      <span className={styles.badgeConfirm}>
        De verificat
        <button type="button" onClick={onConfirm}>
          E corect
        </button>
      </span>
    );
  }
  if (status === FIELD_STATUS.SUGGESTED) return <span className={styles.badgeAi}>✨ Propus de AI · poți modifica</span>;
  return null;
}

function Field({ id, label, status, onConfirm, hint, children }) {
  return (
    <div className={`${styles.field} ${status === FIELD_STATUS.CONFIRM ? styles.fieldConfirm : ""}`}>
      <div className={styles.fieldHead}>
        <label htmlFor={id} className={styles.label}>
          {label}
        </label>
        <StatusBadge status={status} onConfirm={onConfirm} />
      </div>
      {children}
      {hint ? <p className={styles.hint}>{hint}</p> : null}
    </div>
  );
}

function TagsInput({ id, value, onChange, suggestions, placeholder }) {
  const [text, setText] = useState("");
  const listId = `${id}-list`;
  const add = (raw) => {
    const tag = String(raw || "").trim();
    if (!tag || value.some((item) => item.toLowerCase() === tag.toLowerCase())) return setText("");
    onChange([...value, tag]);
    setText("");
  };
  return (
    <div className={styles.tags}>
      {value.map((tag) => (
        <span key={tag} className={styles.chip}>
          {tag}
          <button type="button" onClick={() => onChange(value.filter((item) => item !== tag))} aria-label={`Elimină ${tag}`}>
            ×
          </button>
        </span>
      ))}
      <input
        id={id}
        className={styles.tagInput}
        value={text}
        list={listId}
        placeholder={placeholder}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === ",") {
            event.preventDefault();
            add(text);
          }
        }}
        onBlur={() => add(text)}
      />
      <datalist id={listId}>
        {suggestions.map((item) => (
          <option key={item} value={item} />
        ))}
      </datalist>
    </div>
  );
}

function DetailsStep({
  ai,
  details,
  fieldStatus,
  pendingConfirmations,
  conflicts,
  hints,
  onEdit,
  onConfirm,
  onConflict,
  onHint,
  onRetry,
}) {
  const filled = Object.keys(fieldStatus).length;

  return (
    <section className={styles.card} aria-labelledby="sl-details-title">
      <h2 id="sl-details-title" className={styles.cardTitle}>
        Ce am înțeles din fotografii
      </h2>

      {ai.status === "done" ? (
        <div className={styles.aiSummary}>
          <span aria-hidden="true">✨</span>
          <div>
            <strong>
              Am completat {filled} {filled === 1 ? "câmp" : "câmpuri"}
              {ai.proposal?.productType ? ` pentru „${ai.proposal.productType}”` : ""}.
            </strong>
            <span>
              {pendingConfirmations
                ? ` ${pendingConfirmations} ${pendingConfirmations === 1 ? "are" : "au"} nevoie de confirmarea ta. Orice câmp se poate modifica direct.`
                : " Orice câmp se poate modifica direct - scrie peste el."}
            </span>
          </div>
        </div>
      ) : (
        <div className={styles.aiSummaryMuted}>
          Completezi manual. Poți reveni oricând la fotografii ca să încerci analiza AI.{" "}
          <button type="button" className={styles.linkBtn} onClick={onRetry}>
            Înapoi la fotografii
          </button>
        </div>
      )}

      {conflicts.length > 0 && (
        <div className={styles.conflicts}>
          <strong>Ai completat deja aceste câmpuri. Păstrăm ce ai scris?</strong>
          {conflicts.map((conflict) => (
            <div key={conflict.field} className={styles.conflict}>
              <span className={styles.conflictField}>{FIELD_LABELS[conflict.field]}</span>
              <span>
                Tu: <em>{displayValue(conflict.field, conflict.current) || "(gol)"}</em>
              </span>
              <span>
                AI: <em>{displayValue(conflict.field, conflict.proposed)}</em>
              </span>
              <div className={styles.rowActions}>
                <button type="button" className={styles.secondaryBtn} onClick={() => onConflict(conflict, false)}>
                  Păstrez ce am scris
                </button>
                <button type="button" className={styles.ghostBtn} onClick={() => onConflict(conflict, true)}>
                  Folosesc propunerea
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Field id={FIELD_ANCHORS.title} label="Titlu" status={fieldStatus.title} onConfirm={() => onConfirm("title")}>
        <input
          id={FIELD_ANCHORS.title}
          className={styles.input}
          value={details.title}
          maxLength={120}
          placeholder="Ex: Lumânare parfumată din ceară de soia"
          onChange={(event) => onEdit("title", event.target.value)}
        />
      </Field>

      <Field
        id={FIELD_ANCHORS.description}
        label="Descriere"
        status={fieldStatus.description}
        onConfirm={() => onConfirm("description")}
      >
        <textarea
          id={FIELD_ANCHORS.description}
          className={styles.textarea}
          rows={5}
          value={details.description}
          placeholder="Ce este, din ce e făcut, cum se folosește."
          onChange={(event) => onEdit("description", event.target.value)}
        />
      </Field>

      <Field
        id={FIELD_ANCHORS.category}
        label="Categorie"
        status={fieldStatus.category}
        onConfirm={() => onConfirm("category")}
      >
        <select
          id={FIELD_ANCHORS.category}
          className={styles.input}
          value={details.category}
          onChange={(event) => onEdit("category", event.target.value)}
        >
          <option value="">Alege categoria</option>
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
      </Field>

      <Field id={FIELD_ANCHORS.color} label="Culoare principală" status={fieldStatus.color} onConfirm={() => onConfirm("color")}>
        <select
          id={FIELD_ANCHORS.color}
          className={styles.input}
          value={details.color}
          onChange={(event) => onEdit("color", event.target.value)}
        >
          <option value="">Alege</option>
          {COLORS_DETAILED.map((item) => (
            <option key={item.key} value={item.key}>
              {item.label}
            </option>
          ))}
        </select>
      </Field>

      <Field id={FIELD_ANCHORS.styleTags} label="Stil" status={fieldStatus.styleTags} onConfirm={() => onConfirm("styleTags")}>
        <TagsInput
          id={FIELD_ANCHORS.styleTags}
          value={details.styleTags}
          onChange={(value) => onEdit("styleTags", value)}
          suggestions={STYLE_TAGS_DETAILED.map((item) => item.label)}
          placeholder="Adaugă un stil"
        />
      </Field>

      <Field
        id={FIELD_ANCHORS.occasionTags}
        label="Ocazii"
        status={fieldStatus.occasionTags}
        onConfirm={() => onConfirm("occasionTags")}
      >
        <TagsInput
          id={FIELD_ANCHORS.occasionTags}
          value={details.occasionTags}
          onChange={(value) => onEdit("occasionTags", value)}
          suggestions={OCCASION_TAGS_DETAILED.map((item) => item.label)}
          placeholder="Adaugă o ocazie"
        />
      </Field>

      {hints.length > 0 && (
        <p className={styles.muted}>Materialul și modul de lucru nu se pot confirma dintr-o fotografie - confirmă tu:</p>
      )}
      {hints.length > 0 && (
        <ul className={styles.hintList}>
          {hints.map((hint) => (
            <li key={hint.field} className={styles.hintItem}>
              <span>
                AI crede că <strong>{FIELD_LABELS[hint.field].toLowerCase()}</strong> ar putea fi:{" "}
                <em>{displayValue(hint.field, hint.value)}</em>
              </span>
              <div className={styles.rowActions}>
                <button type="button" className={styles.secondaryBtn} onClick={() => onHint(hint, true)}>
                  Da, e corect
                </button>
                <button type="button" className={styles.ghostBtn} onClick={() => onHint(hint, false)}>
                  Nu
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <details
        className={styles.moreDetails}
        open={Boolean(details.materialMain || details.technique || details.careInstructions || details.dimensions)}
      >
        <summary>Mai multe detalii (opțional) · material, tehnică, îngrijire, dimensiuni</summary>
      <div className={styles.grid2}>
        <Field id="sl-material" label="Material principal">
          <input
            id="sl-material"
            className={styles.input}
            value={details.materialMain}
            placeholder="Ex: ceară de soia"
            onChange={(event) => onEdit("materialMain", event.target.value)}
          />
        </Field>
        <Field id="sl-technique" label="Cum este lucrat">
          <input
            id="sl-technique"
            className={styles.input}
            value={details.technique}
            placeholder="Ex: turnat manual"
            onChange={(event) => onEdit("technique", event.target.value)}
          />
        </Field>
      </div>

      <Field id="sl-care" label="Îngrijire">
        <input
          id="sl-care"
          className={styles.input}
          value={details.careInstructions}
          placeholder="Ex: a se feri de surse de căldură"
          onChange={(event) => onEdit("careInstructions", event.target.value)}
        />
      </Field>

      <Field id="sl-dimensions" label="Dimensiuni">
        <input
          id="sl-dimensions"
          className={styles.input}
          value={details.dimensions}
          placeholder="Ex: 8 x 10 cm"
          onChange={(event) => onEdit("dimensions", event.target.value)}
        />
      </Field>
      </details>

      {ai.proposal?.questions?.length > 0 && (
        <div className={styles.questions}>
          <strong>Artfest AI ar vrea să știe:</strong>
          <ul>
            {ai.proposal.questions.map((question) => (
              <li key={question}>{question}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/* ======================= 3. Preț și opțiuni ======================= */

function YesNoButtons({ value, onYes, onNo, yesLabel = "Da", noLabel = "Nu" }) {
  return (
    <div className={styles.rowActions} role="radiogroup">
      <button
        type="button"
        role="radio"
        aria-checked={value === true}
        className={value === true ? styles.choiceActive : styles.choice}
        onClick={onYes}
      >
        {yesLabel}
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={value === false}
        className={value === false ? styles.choiceActive : styles.choice}
        onClick={onNo}
      >
        {noLabel}
      </button>
    </div>
  );
}

function SellStep(props) {
  const {
    wantsOptions,
    onWantsOptions,
    variantHints,
    personalizationHints,
    variantAnswers,
    customAnswers,
    variants,
    customFields,
    onVariantHint,
    onCustomHint,
    onAddVariant,
    onUpdateVariant,
    onRemoveVariant,
    onAddCustom,
    onUpdateCustom,
    onRemoveCustom,
    optionErrors,
    wantsPersonalization,
    onWantsPersonalization,
    activeOptionCount,
  } = props;

  const hasHints = variantHints.length > 0;
  const showEditors = wantsOptions === true;

  return (
    <section className={styles.card} aria-labelledby="sl-sell-title">
      <h2 id="sl-sell-title" className={styles.cardTitle}>
        Preț și opțiuni
      </h2>

      <div className={styles.configHelp}>
        <button type="button" className={styles.secondaryBtn} onClick={props.onOpenOrderAi}>
          ✨ Configurează variantele și personalizarea cu AI
        </button>
        <button type="button" className={styles.ghostBtn} onClick={props.onOpenHelp}>
          Cere ajutor echipei Artfest
        </button>
      </div>

      <div id="sl-options" className={styles.optionsBlock} tabIndex={-1}>
        <strong>Clientul alege o variantă?</strong>
        <span className={styles.hint}>De exemplu mărimea, culoarea, aroma sau materialul.</span>

        {hasHints ? (
          <div className={styles.questionCards}>
            {variantHints.map((hint) => (
              <div key={hint.key} className={styles.questionCard}>
                <span className={styles.questionLead}>✨ Am observat posibile variante</span>
                <strong>
                  Clientul alege „{hint.label}”?
                  {hint.observedValues.length ? ` (în fotografii: ${hint.observedValues.join(", ")})` : ""}
                </strong>
                <YesNoButtons
                  value={variantAnswers[hint.key] === "yes" ? true : variantAnswers[hint.key] === "no" ? false : null}
                  onYes={() => onVariantHint(hint, true)}
                  onNo={() => onVariantHint(hint, false)}
                />
              </div>
            ))}
            {wantsOptions === null && (
              <button type="button" className={styles.linkBtn} onClick={() => onWantsOptions(false)}>
                Nu are variante
              </button>
            )}
          </div>
        ) : (
          <YesNoButtons
            value={showEditors ? true : wantsOptions === false ? false : null}
            onYes={() => onWantsOptions(true)}
            onNo={() => onWantsOptions(false)}
            yesLabel="Da, are variante"
            noLabel="Nu are variante"
          />
        )}

        {showEditors && (
          <>
            <h3 className={styles.subTitle}>Opțiuni din care alege clientul</h3>
            {variants.map((variant) => {
              const hint = variantHints.find((item) => item.key === variant.fromHint);
              return (
                <VariantEditor
                  key={variant.id}
                  variant={variant}
                  observed={hint?.observedValues || []}
                  onChange={(patch) => onUpdateVariant(variant.id, patch)}
                  onRemove={() => onRemoveVariant(variant.id)}
                />
              );
            })}
            <button type="button" className={styles.addBtn} onClick={onAddVariant}>
              + Adaugă o opțiune (ex. Mărime)
            </button>

            {optionErrors.length > 0 && (
              <ul className={styles.inlineErrors} role="alert">
                {optionErrors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            )}

            <div className={styles.footnote}>
              Seturi pentru mai multe persoane sau prețuri speciale pe combinații? Le configurezi în{" "}
              <strong>Editorul avansat</strong> - tot ce ai completat aici se păstrează.
              {props.onOpenAdvanced && (
                <>
                  {" "}
                  <button type="button" className={styles.linkBtn} onClick={props.onOpenAdvanced}>
                    Continuă în Editorul avansat
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>

      <div id="sl-personalization" className={styles.optionsBlock} tabIndex={-1}>
        <strong>Permiți personalizarea produsului?</strong>
        <span className={styles.hint}>
          Clientul completează ce îi ceri, de exemplu un nume, o dată sau o fotografie. Se poate folosi împreună cu variantele.
        </span>

        {personalizationHints.map((hint) => (
          <div key={hint.key} className={styles.questionCard}>
            <span className={styles.questionLead}>✨ Produsul pare personalizabil</span>
            <strong>Clientul îți trimite „{hint.label}”?</strong>
            <YesNoButtons
              value={customAnswers[hint.key] === "yes" ? true : customAnswers[hint.key] === "no" ? false : null}
              onYes={() => onCustomHint(hint, true)}
              onNo={() => onCustomHint(hint, false)}
            />
          </div>
        ))}

        <YesNoButtons
          value={wantsPersonalization === true}
          onYes={() => onWantsPersonalization(true)}
          onNo={() => onWantsPersonalization(false)}
          yesLabel="Da, permit"
          noLabel="Nu"
        />

        {wantsPersonalization && (
          <>
            {customFields.map((field) => (
              <div key={field.id} className={styles.optionCard}>
                <div className={styles.grid2}>
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor={`${field.id}-label`}>
                      Ce îi ceri clientului?
                    </label>
                    <input
                      id={`${field.id}-label`}
                      className={styles.input}
                      value={field.label}
                      placeholder="Ex: Numele de pe tricou"
                      onChange={(event) => onUpdateCustom(field.id, { label: event.target.value })}
                    />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor={`${field.id}-type`}>
                      Cum răspunde
                    </label>
                    <select
                      id={`${field.id}-type`}
                      className={styles.input}
                      value={field.type}
                      onChange={(event) => onUpdateCustom(field.id, { type: event.target.value })}
                    >
                      {CUSTOM_FIELD_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {CUSTOM_TYPE_LABELS[type]}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor={`${field.id}-description`}>
                    Instrucțiuni pentru client (opțional)
                  </label>
                  <input
                    id={`${field.id}-description`}
                    className={styles.input}
                    value={field.description || ""}
                    maxLength={200}
                    placeholder="Ex: Maximum 12 caractere, fără diacritice"
                    onChange={(event) => onUpdateCustom(field.id, { description: event.target.value })}
                  />
                </div>
                <div className={styles.optionFooter}>
                  <label className={styles.check}>
                    <input
                      type="checkbox"
                      checked={field.required}
                      onChange={(event) => onUpdateCustom(field.id, { required: event.target.checked })}
                    />
                    Obligatoriu
                  </label>
                  <button type="button" className={styles.linkBtnDanger} onClick={() => onRemoveCustom(field.id)}>
                    Șterge
                  </button>
                </div>
              </div>
            ))}
            <button type="button" className={styles.addBtn} onClick={onAddCustom}>
              + Cere o informație (ex. un nume)
            </button>
            {!customFields.length && <p className={styles.hint}>Adaugă cel puțin o informație pe care o completează clientul.</p>}
            <p className={styles.hint}>
              Pentru o personalizare cu preț în plus, adaug-o ca variantă (ex. „Gravură”), unde poți seta suma: câmpurile de aici nu
              modifică prețul.
            </p>
          </>
        )}
      </div>

      <CommerceFields {...props} hasOptions={activeOptionCount > 0} />
    </section>
  );
}

function VariantEditor({ variant, observed, onChange, onRemove }) {
  const [newValue, setNewValue] = useState("");
  const [showPrices, setShowPrices] = useState(variant.values.some((value) => value.deltaLei));
  const existing = new Set(variant.values.map((value) => value.label.trim().toLowerCase()));
  const unused = observed.filter((value) => !existing.has(value.toLowerCase()));

  // „lavandă, trandafir” -> două valori separate (splitValueList)
  const addValue = (text) => {
    const added = splitValueList(text, variant.values.map((value) => value.label));
    if (added.length) {
      onChange({
        values: [...variant.values, ...added.map((label) => ({ id: nextId("value"), label, deltaLei: "" }))],
      });
    }
    setNewValue("");
  };

  const setValue = (id, patch) =>
    onChange({ values: variant.values.map((value) => (value.id === id ? { ...value, ...patch } : value)) });

  return (
    <div className={styles.optionCard}>
      <div className={styles.field}>
        <label className={styles.label} htmlFor={`${variant.id}-label`}>
          Numele opțiunii
        </label>
        <input
          id={`${variant.id}-label`}
          className={styles.input}
          value={variant.label}
          placeholder="Ex: Mărime"
          onChange={(event) => onChange({ label: event.target.value })}
        />
      </div>

      <span className={styles.label}>Ce poate alege clientul</span>
      {variant.values.length > 0 && (
        <ul className={styles.valueRows}>
          {variant.values.map((value) => (
            <li key={value.id} className={styles.valueRow}>
              <input
                className={styles.input}
                value={value.label}
                aria-label="Valoare"
                onChange={(event) => setValue(value.id, { label: event.target.value })}
              />
              {showPrices && (
                <span className={styles.deltaInput}>
                  +
                  <input
                    className={styles.input}
                    inputMode="decimal"
                    placeholder="0"
                    aria-label={`Cât costă în plus ${value.label}`}
                    value={value.deltaLei}
                    onChange={(event) => setValue(value.id, { deltaLei: event.target.value })}
                  />
                  lei
                </span>
              )}
              <button
                type="button"
                className={styles.iconBtn}
                onClick={() => onChange({ values: variant.values.filter((item) => item.id !== value.id) })}
                aria-label={`Elimină ${value.label || "valoarea"}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className={styles.addValueRow}>
        <input
          className={styles.input}
          value={newValue}
          placeholder="Ex: lavandă, trandafir (separă cu virgulă)"
          aria-label={`Valoare nouă pentru ${variant.label || "opțiune"}`}
          onChange={(event) => setNewValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addValue(newValue);
            }
          }}
        />
        <button type="button" className={styles.secondaryBtn} onClick={() => addValue(newValue)} disabled={!newValue.trim()}>
          Adaugă
        </button>
      </div>

      {unused.length > 0 && (
        <div className={styles.suggestRow}>
          <span className={styles.hint}>Văzute în fotografii - atinge ca să le adaugi:</span>
          {unused.map((value) => (
            <button key={value} type="button" className={styles.suggestChip} onClick={() => addValue(value)}>
              + {value}
            </button>
          ))}
        </div>
      )}

      {variant.values.length > 0 &&
        (showPrices ? (
          <p className={styles.hint}>Lasă 0 sau gol dacă valoarea nu schimbă prețul. Suma se adaugă la prețul de bază.</p>
        ) : (
          <button type="button" className={styles.linkBtn} onClick={() => setShowPrices(true)}>
            Unele valori costă mai mult?
          </button>
        ))}

      <div className={styles.optionFooter}>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={variant.required}
            onChange={(event) => onChange({ required: event.target.checked })}
          />
          Clientul trebuie să aleagă
        </label>
        <button type="button" className={styles.linkBtnDanger} onClick={onRemove}>
          Șterge opțiunea
        </button>
      </div>
    </div>
  );
}

function CommerceFields({ commerce, setCommerce, saleType, hasOptions, notices, orderModeHint }) {
  const set = (field) => (event) => setCommerce((current) => ({ ...current, [field]: event.target.value }));
  const choose = (value) => setCommerce((current) => ({ ...current, saleType: value }));

  const choices = [
    { value: SALE_TYPES.IN_STOCK, title: "Am produsul gata", text: "Îl trimit imediat, din stoc." },
    { value: SALE_TYPES.WITH_OPTIONS, title: "Îl fac după comandă", text: "Îl realizez după ce comandă clientul." },
    { value: SALE_TYPES.QUOTE, title: "Prețul depinde de cerințe", text: "Clientul îmi trimite o cerere de ofertă." },
  ];

  return (
    <div className={styles.commerceBlock}>
      <div className={styles.divider} />
      <span className={styles.label}>Cum vinzi produsul?</span>
      <div className={styles.saleChoices} role="radiogroup">
        {choices.map((choice) => {
          const disabled = hasOptions && choice.value === SALE_TYPES.IN_STOCK;
          const active = saleType === choice.value;
          return (
            <button
              key={choice.value}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              className={`${styles.saleChoice} ${active ? styles.saleChoiceActive : ""}`}
              onClick={() => choose(choice.value)}
            >
              <strong>{choice.title}</strong>
              <span>{choice.text}</span>
            </button>
          );
        })}
      </div>
      {orderModeHint?.reason && <p className={styles.hint}>✨ Observația AI: {orderModeHint.reason}</p>}
      {notices.map((notice) => (
        <p key={notice} className={styles.notice}>
          {notice}
        </p>
      ))}

      <div className={styles.grid2}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="sl-price">
            {saleType === SALE_TYPES.QUOTE ? "Preț de la (orientativ)" : hasOptions ? "Preț de bază" : "Preț"}
          </label>
          <div className={styles.unitInput}>
            <input
              id="sl-price"
              className={styles.input}
              inputMode="decimal"
              placeholder="Ex: 35"
              value={commerce.price}
              onChange={set("price")}
            />
            <span>lei</span>
          </div>
          {hasOptions && <p className={styles.hint}>Prețul celei mai simple variante. Sumele în plus se adaugă peste.</p>}
        </div>

        {saleType === SALE_TYPES.IN_STOCK ? (
          <div className={styles.field}>
            <label className={styles.label} htmlFor="sl-stock">
              Câte bucăți ai?
            </label>
            <div className={styles.unitInput}>
              <input
                id="sl-stock"
                className={styles.input}
                inputMode="numeric"
                placeholder="Ex: 5"
                value={commerce.stock}
                onChange={set("stock")}
              />
              <span>buc.</span>
            </div>
          </div>
        ) : (
          <div className={styles.field}>
            <label className={styles.label} htmlFor="sl-lead">
              În câte zile îl realizezi?
            </label>
            <div className={styles.unitInput}>
              <input
                id="sl-lead"
                className={styles.input}
                inputMode="numeric"
                placeholder="Ex: 5"
                value={commerce.leadTimeDays}
                onChange={set("leadTimeDays")}
              />
              <span>zile</span>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}

/* ======================= 4. Publicare: siguranță + verificare ======================= */

function PublicPreview({ info }) {
  if (!info) return <p className={styles.hint}>Încă nu există informații de afișat.</p>;
  return (
    <dl className={styles.publicPreview}>
      {info.manufacturer && (
        <>
          <dt>Producător</dt>
          <dd>{info.manufacturer.name}</dd>
          <dt>Adresă poștală de contact</dt>
          <dd>{info.manufacturer.address}</dd>
          <dt>Email de contact</dt>
          <dd>{info.manufacturer.email}</dd>
        </>
      )}
      {info.responsiblePerson && (
        <>
          <dt>Persoană responsabilă în UE</dt>
          <dd>
            {info.responsiblePerson.name}, {info.responsiblePerson.address}, {info.responsiblePerson.email}
          </dd>
        </>
      )}
      {info.safetyWarnings && (
        <>
          <dt>Avertismente de siguranță</dt>
          <dd>{info.safetyWarnings}</dd>
        </>
      )}
      {info.isForChildren && (
        <>
          <dt>Copii</dt>
          <dd>Acest produs este destinat copiilor.</dd>
        </>
      )}
    </dl>
  );
}

function ProducerSection({
  gpsrState,
  selfProfile,
  otherProducer,
  producerChoice,
  selectedProducer,
  producerCheck,
  onChoose,
  onEdit,
  onCreate,
  safety,
  setSafety,
}) {
  const set = (field) => (value) => setSafety((current) => ({ ...current, [field]: value }));
  // „Da” fără text încă: rămâne ales până scrie vânzătorul (valoarea salvată rămâne null = nerăspuns)
  const [warningsYes, setWarningsYes] = useState(false);
  const warningsAnswer = gpsrWarningsAnswer(safety.safetyWarnings, warningsYes);
  const summary = producerSummary(selectedProducer);
  const selfConfigured = Boolean(gpsrState?.complete || gpsrState?.draft);
  const preview = selectedProducer
    ? publicProducerPreview(selectedProducer, { safetyWarnings: safety.safetyWarnings, isForChildren: safety.isForChildren })
    : null;

  return (
    <div id="sl-safety" className={styles.safetyBlock} tabIndex={-1}>
      <h3 className={styles.subTitle}>Producător și siguranță</h3>
      <p className={styles.hint}>Apar public pe pagina produsului. Datele tale de producător le completezi o singură dată.</p>

      {gpsrState?.status === "loading" || gpsrState?.status === "idle" ? (
        <p className={styles.hint} role="status">
          Se încarcă datele producătorului…
        </p>
      ) : gpsrState?.status === "error" ? (
        <p className={styles.notice} role="alert">
          Nu am putut încărca datele producătorului. Reîncarcă pagina sau încearcă mai târziu.
        </p>
      ) : null}

      <span className={styles.label}>Cine a realizat produsul?</span>
      <div className={styles.producerList} role="radiogroup">
        <button
          type="button"
          role="radio"
          aria-checked={producerChoice === "self"}
          className={`${styles.saleChoice} ${producerChoice === "self" ? styles.saleChoiceActive : ""}`}
          onClick={() => (selfConfigured ? onChoose("self") : onCreate(PRODUCER_KINDS.SELF))}
        >
          <strong>{selfConfigured ? `Eu · ${selfProfile.name || "profilul meu"}` : "Eu am realizat produsul"}</strong>
          <span>{selfConfigured ? "Folosesc datele mele de producător salvate" : "Completezi o singură dată datele de producător"}</span>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={producerChoice === "other"}
          className={`${styles.saleChoice} ${producerChoice === "other" ? styles.saleChoiceActive : ""}`}
          onClick={() => (otherProducer ? onChoose("other") : onCreate(PRODUCER_KINDS.OTHER))}
        >
          <strong>{otherProducer ? otherProducer.name : "Altă persoană sau firmă"}</strong>
          <span>Datele producătorului real, doar pentru acest produs</span>
        </button>
      </div>

      {selectedProducer && (
        <div className={styles.producerSummary}>
          <div>
            <span>
              Producător: <strong>{summary.name}</strong>
            </span>
            <span>
              Date de contact:{" "}
              {summary.status === "complete" ? (
                <strong className={styles.okText}>✓ complete</strong>
              ) : (
                <strong className={styles.warnText}>⚠ incomplete</strong>
              )}
            </span>
          </div>
          <button type="button" className={styles.secondaryBtn} onClick={() => onEdit(selectedProducer)}>
            Modifică datele producătorului
          </button>
          {producerCheck && !producerCheck.ok && (
            <ul className={styles.inlineErrors}>
              {summary.missing.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className={styles.field}>
        <span className={styles.label} id="sl-warnings-question">
          {GPSR_WARNINGS_QUESTION}
        </span>
        <YesNoButtons
          value={warningsAnswer === null ? null : warningsAnswer === "yes"}
          onYes={() => {
            setWarningsYes(true);
            if (safety.safetyWarnings === "") set("safetyWarnings")(null);
          }}
          onNo={() => {
            setWarningsYes(false);
            set("safetyWarnings")("");
          }}
        />
        {warningsAnswer === "yes" && (
          <>
            <textarea
              id="sl-warnings"
              className={styles.textarea}
              rows={2}
              aria-labelledby="sl-warnings-question"
              value={safety.safetyWarnings || ""}
              placeholder="Ex: Nu lăsa lumânarea aprinsă nesupravegheată."
              onChange={(event) => set("safetyWarnings")(event.target.value || null)}
            />
            <span className={styles.hint}>{GPSR_WARNINGS_HINT}</span>
          </>
        )}
      </div>

      <div className={styles.field}>
        <span className={styles.label}>{GPSR_CHILDREN_QUESTION}</span>
        <YesNoButtons
          value={safety.isForChildren}
          onYes={() => set("isForChildren")(true)}
          onNo={() => set("isForChildren")(false)}
        />
        {safety.isForChildren === true && <span className={styles.hint}>{GPSR_CHILDREN_HINT}</span>}
      </div>

      <details className={styles.details}>
        <summary>Ce va vedea clientul pe pagina produsului</summary>
        <PublicPreview info={preview} />
        <p className={styles.hint}>Adresele de ridicare, retur și facturare rămân private și nu apar aici.</p>
      </details>

      <GpsrInfoPanel />
    </div>
  );
}


function ProducerEditor({ initial, isNew, account, safety, onCancel, onSave, gpsrHelpApi, storeSlug, draftId = null, helpDisabled = false, onRequestPrivateHelp = null }) {
  const [profile, setProfile] = useState(() => ({ ...initial }));
  const [showErrors, setShowErrors] = useState(false);
  const isSelf = profile.kind === PRODUCER_KINDS.SELF;
  const suggestions = isSelf ? producerSuggestions(account) : { name: [], email: [], address: [] };
  const check = validateProducerProfile(profile);
  const errorsFor = (field) => (showErrors ? check.errors.filter((item) => item.field === field) : []);
  // orice modificare a datelor cere o nouă confirmare
  const set = (field) => (value) =>
    setProfile((current) => ({ ...current, [field]: value, ...(field === "confirmed" ? {} : { confirmed: false }) }));
  const preview = publicProducerPreview({ ...profile }, safety);

  const fieldErrors = (field) =>
    errorsFor(field).map((item) => (
      <p key={item.message} className={styles.inlineError} role="alert">
        {item.message}
      </p>
    ));

  return (
    <Sheet title={isSelf ? "Datele tale de producător" : "Alt producător"} onClose={onCancel}>
      <div className={styles.sheetBody}>
        <p className={styles.hint}>
          {isSelf
            ? "Le completezi o singură dată și le refolosești la celelalte produse. Apar public pe pagina produsului."
            : "Datele persoanei sau firmei care a realizat produsul, doar pentru acest produs. Apar public pe pagina produsului."}
        </p>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="producer-name">
            {isSelf ? "Nume / denumire sub care produci" : "Nume / denumire producător"}
          </label>
          <input
            id="producer-name"
            className={styles.input}
            value={profile.name}
            maxLength={200}
            placeholder={isSelf ? "Ex: Atelier Mara" : "Ex: Ceramica Exemplu SRL"}
            onChange={(event) => set("name")(event.target.value)}
          />
          {suggestions.name.length > 0 && (
            <div className={styles.suggestRow}>
              <span className={styles.hint}>Folosește:</span>
              {suggestions.name.map((item) => (
                <button key={item.value} type="button" className={styles.suggestChip} onClick={() => set("name")(item.value)}>
                  {item.value} <small>({item.source})</small>
                </button>
              ))}
            </div>
          )}
          {fieldErrors("name")}
        </div>

        <div className={styles.field}>
          <GpsrAddressChoice
            helpActions={
              <>
                {isSelf && onRequestPrivateHelp && (
                  <button type="button" className={styles.ghostBtn} onClick={onRequestPrivateHelp}>
                    Salvează produsul privat și cere ajutor Artfest
                  </button>
                )}
                <GpsrAddressHelp api={gpsrHelpApi} storeSlug={storeSlug} draftId={draftId} disabled={helpDisabled} />
              </>
            }
          >
            <label className={styles.label} htmlFor="producer-address">
              Adresă poștală de contact
            </label>
            <input
              id="producer-address"
              className={styles.input}
              value={profile.address}
              maxLength={500}
              autoComplete="off"
              placeholder="Ex: Str. Florilor 10, Cluj-Napoca, jud. Cluj"
              onChange={(event) => set("address")(event.target.value)}
            />
            {fieldErrors("address")}
          </GpsrAddressChoice>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="producer-email">
            Email de contact
          </label>
          <input
            id="producer-email"
            className={styles.input}
            type="email"
            value={profile.email}
            maxLength={320}
            placeholder="Ex: contact@ateliermara.ro"
            onChange={(event) => set("email")(event.target.value)}
          />
          {suggestions.email.map((item) => (
            <div key={item.value} className={styles.suggestRow}>
              <button type="button" className={styles.suggestChip} onClick={() => set("email")(item.value)}>
                {item.value} <small>({item.source})</small>
              </button>
              <span className={styles.hint}>{item.warning}</span>
            </div>
          ))}
          {fieldErrors("email")}
        </div>

        {!isSelf && (
          <>
            <div className={styles.field}>
              <span className={styles.label}>Producătorul este stabilit în UE?</span>
              <YesNoButtons
                value={profile.inEU ?? null}
                onYes={() => set("inEU")(true)}
                onNo={() => set("inEU")(false)}
              />
              {fieldErrors("inEU")}
            </div>
            {profile.inEU === false && (
              <div className={styles.subCard}>
                <strong>Persoana responsabilă din UE</strong>
                <input
                  className={styles.input}
                  aria-label="Nume persoană responsabilă"
                  placeholder="Nume / denumire"
                  value={profile.rpName || ""}
                  onChange={(event) => set("rpName")(event.target.value)}
                />
                <input
                  className={styles.input}
                  aria-label="Adresă persoană responsabilă"
                  placeholder="Adresă poștală în UE"
                  value={profile.rpAddress || ""}
                  onChange={(event) => set("rpAddress")(event.target.value)}
                />
                <input
                  className={styles.input}
                  aria-label="Email persoană responsabilă"
                  type="email"
                  placeholder="Email"
                  value={profile.rpEmail || ""}
                  onChange={(event) => set("rpEmail")(event.target.value)}
                />
                {check.errors
                  .filter((item) => showErrors && item.field.startsWith("rp-"))
                  .map((item) => (
                    <p key={item.message} className={styles.inlineError} role="alert">
                      {item.message}
                    </p>
                  ))}
              </div>
            )}
          </>
        )}

        <details className={styles.details}>
          <summary>Așa va apărea public</summary>
          <PublicPreview info={preview} />
        </details>

        {!isNew && isSelf && (
          <p className={styles.hint}>
            Modificarea se aplică tuturor produselor la care ești producător, abia după ce confirmi și salvezi produsul.
          </p>
        )}

        <div className={styles.rowActions}>
          <button
            type="button"
            className={styles.primaryBtn}
            onClick={() => {
              setShowErrors(true);
              if (check.ok) onSave(profile);
            }}
          >
            {isNew ? "Salvează profilul" : "Salvează modificările"}
          </button>
          <button type="button" className={styles.ghostBtn} onClick={onCancel}>
            Renunță
          </button>
        </div>
      </div>
    </Sheet>
  );
}


function ReviewStep({
  photos,
  video,
  details,
  draft,
  prices,
  gate,
  recommendations,
  onResolve,
  onGoTo,
  onPublish,
  children,
  beforePublish = null,
  resolveUrl = (value) => value,
  saving = false,
  canSave = false,
  saveError = null,
}) {
  const { form, saleType } = draft;
  const hasVariants = form.optionsSchema.length > 0;

  return (
    <section className={styles.card} aria-labelledby="sl-review-title">
      <h2 id="sl-review-title" className={styles.cardTitle}>
        Verifică și publică
      </h2>

      <div className={styles.preview}>
        {photos[0] && (
          <img
            src={photos[0].uploadedUrl ? resolveUrl(photos[0].uploadedUrl) : photos[0].previewUrl}
            alt=""
            className={styles.previewImg}
          />
        )}
        <div>
          <strong className={styles.previewTitle}>{details.title || "Produs fără titlu"}</strong>
          <span className={styles.muted}>{CATEGORY_LABELS[details.category] || "Fără categorie"}</span>
          <span className={styles.previewPrice}>
            {saleType === SALE_TYPES.QUOTE
              ? `Cerere de ofertă · de la ${formatLei(prices.minCents)}`
              : prices.minCents !== prices.maxCents
                ? `De la ${formatLei(prices.minCents)}`
                : formatLei(prices.minCents)}
          </span>
          <span className={styles.muted}>
            {saleType === SALE_TYPES.IN_STOCK
              ? `${form.readyQty || 0} buc. în stoc`
              : `Realizat în ${form.leadTimeDays || "?"} zile`}
            {` · ${photos.length} ${photos.length === 1 ? "fotografie" : "fotografii"}`}
            {video ? ` · video${video.muted ? " fără sunet" : ""}` : ""}
          </span>
          <button type="button" className={styles.linkBtn} onClick={() => onGoTo("details")}>
            Modifică detaliile
          </button>
        </div>
      </div>

      {saleType !== SALE_TYPES.QUOTE && (
        <div className={styles.priceBlock}>
          <div className={styles.fieldHead}>
            <h3 className={styles.subTitleFlat}>Ce plătește clientul</h3>
            <button type="button" className={styles.linkBtn} onClick={() => onGoTo("sell", "sl-options")}>
              Modifică prețul sau opțiunile
            </button>
          </div>
          <table className={styles.priceTable}>
            <thead>
              <tr>
                <th scope="col">{hasVariants ? "Alegere" : "Produs"}</th>
                <th scope="col">Preț final</th>
              </tr>
            </thead>
            <tbody>
              {prices.rows.map((row) => (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  <td>
                    {formatLei(row.unitPriceCents)}
                    {row.deltaCents > 0 ? <span className={styles.delta}> (+{formatLei(row.deltaCents)})</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {prices.truncated && <p className={styles.hint}>Afișăm primele {prices.rows.length} din {prices.total} combinații.</p>}
          {hasVariants && <p className={styles.hint}>Calculat cu aceeași regulă ca în coș: prețul de bază + sumele valorilor alese.</p>}
        </div>
      )}

      <div className={styles.divider} />
      {children}
      <div className={styles.divider} />

      {gate.ready ? (
        <p className={styles.ready}>✅ Produsul este gata de publicare.</p>
      ) : (
        <div className={styles.issues} role="alert">
          <strong>Mai ai de rezolvat ({gate.blockers.length}):</strong>
          <ul>
            {gate.blockers.map((blocker) => (
              <li key={`${blocker.code}|${blocker.message}`}>
                <span>{blocker.message}</span>
                <button type="button" className={styles.linkBtn} onClick={() => onResolve(blocker)}>
                  Rezolvă
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {recommendations.length > 0 && (
        <details className={styles.details}>
          <summary>Recomandări ({recommendations.length}) - nu blochează</summary>
          <ul>
            {recommendations.map((issue) => (
              <li key={`${issue.code}|${issue.message}`}>{issue.message}</li>
            ))}
          </ul>
        </details>
      )}


      {beforePublish}

      {saveError && (
        <div className={styles.alert} role="alert">
          <strong>{saveError.message}</strong>
          {saveError.link && (
            <a className={styles.linkBtn} href={saveError.link}>
              Vezi abonamentul
            </a>
          )}
        </div>
      )}

      <button type="button" className={styles.primaryBtnWide} onClick={onPublish} disabled={!gate.ready || saving || !canSave}>
        {saving ? "Se salvează…" : canSave ? "Publică produsul" : "Previzualizare - salvarea nu e disponibilă"}
      </button>
      <p className={styles.hint}>
        După salvare, produsul trece prin verificarea automată Artfest. Poate fi publicat imediat sau după o verificare
        suplimentară.
      </p>
    </section>
  );
}

/* ======================= ferestre ======================= */

function Sheet({ title, onClose, children }) {
  useEffect(() => {
    const onKey = (event) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className={styles.sheetBackdrop} onClick={onClose} role="presentation">
      <div className={styles.sheet} role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <div className={styles.sheetHead}>
          <strong>{title}</strong>
          <button type="button" className={styles.sheetClose} onClick={onClose} aria-label="Închide">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function HelpSheet({
  onClose,
  step,
  canSend,
  isPreview = false,
  missing = [],
  busy = false,
  uploading = false,
  onSendPrivate,
  onSendMessage,
  describeError,
  onGoTo,
}) {
  const [note, setNote] = useState("");
  const [state, setState] = useState({ status: "idle", error: "" });
  const sending = state.status === "sending";
  const noteReady = note.trim().length >= 3;

  const send = async (action) => {
    setState({ status: "sending", error: "" });
    try {
      const result = await action(note);
      setState({ status: result ? "sent" : "idle", error: "" });
    } catch (error) {
      setState({
        status: "idle",
        error: `${describeError(error).message} Ce ai completat a rămas în ciornă.`,
      });
    }
  };

  return (
    <Sheet title="Cere ajutor echipei Artfest" onClose={onClose}>
      {state.status === "sent" ? (
        <div className={styles.ready} role="status">
          <p className={styles.noticeP}>Am trimis mesajul. Echipa Artfest îți răspunde în secțiunea Suport.</p>
          <p className={styles.noticeP}>Produsul nu a fost salvat. Ciorna rămâne pe acest dispozitiv și poți continua oricând.</p>
          <a href="/support" className={styles.linkBtn}>
            Vezi conversația în Suport
          </a>
        </div>
      ) : (
        <>
          <label className={styles.label} htmlFor="sl-help-note">
            Cu ce te putem ajuta să configurezi produsul?
          </label>
          <textarea
            id="sl-help-note"
            className={styles.textarea}
            rows={4}
            maxLength={HELP_MESSAGE_MAX}
            value={note}
            placeholder={step === "sell" ? "Ex: Nu reușesc să configurez cele trei dimensiuni și diferențele de preț." : "Ex: Nu știu ce categorie să aleg."}
            onChange={(event) => setNote(event.target.value)}
          />
          <p className={styles.hint} aria-live="polite">
            {note.length}/{HELP_MESSAGE_MAX} caractere. Mesajul ajunge integral la echipa Artfest.
          </p>
          <p className={styles.muted}>
            Salvăm produsul fără să îl afișăm public. Echipa Artfest va analiza solicitarea și te va contacta pentru a te ajuta să
            finalizezi configurarea.
          </p>

          {missing.length > 0 && (
            <div className={styles.notice} role="status">
              <p className={styles.noticeP}>Ca să putem salva produsul, mai avem nevoie de:</p>
              <ul className={styles.helpMissing}>
                {missing.map((item) => (
                  <li key={item.field}>
                    <button type="button" className={styles.linkBtn} onClick={() => onGoTo(item.step)}>
                      {item.label}
                    </button>
                  </li>
                ))}
              </ul>
              <p className={styles.noticeP}>Dacă te-ai blocat chiar aici, trimite-ne doar mesajul.</p>
            </div>
          )}
          {uploading && <p className={styles.hint}>Așteaptă să se încarce fotografiile.</p>}
          {state.error && (
            <p className={styles.inlineError} role="alert">
              {state.error}
            </p>
          )}
          {!canSend && (
            <p className={styles.hint}>
              {isPreview
                ? "Previzualizare: mesajul nu se trimite și nu se creează niciun produs."
                : "Trimiterea e disponibilă doar din contul de vânzător, cu magazinul ales."}
            </p>
          )}

          <button
            type="button"
            className={styles.primaryBtnWide}
            onClick={() => send(onSendPrivate)}
            disabled={!canSend || sending || busy || !noteReady || missing.length > 0}
          >
            {sending ? "Se trimite…" : "Salvează privat și cere ajutor"}
          </button>
          {(missing.length > 0 || state.error) && (
            <button type="button" className={styles.ghostBtn} onClick={() => send(onSendMessage)} disabled={!canSend || sending || !noteReady}>
              Trimite doar mesajul, fără produs
            </button>
          )}
        </>
      )}
    </Sheet>
  );
}

/* ======================= asistentul AI: variante și personalizare ======================= */

function OrderAiSheet({ state, onChangeMessage, onSend, onApply, onClose, hasExisting }) {
  const { proposal, status, error, message } = state;
  const [draft, setDraft] = useState(null);
  const [mode, setMode] = useState("");
  const [replaceConfirmed, setReplaceConfirmed] = useState(false);

  // o propunere nouă înlocuiește sumele scrise în rezumatul precedent
  useEffect(() => {
    setDraft(proposal);
    setMode("");
    setReplaceConfirmed(false);
  }, [proposal]);

  const setDelta = (variantIndex, valueIndex, deltaLei) =>
    setDraft((current) => ({
      ...current,
      variants: current.variants.map((variant, i) =>
        i !== variantIndex
          ? variant
          : { ...variant, values: variant.values.map((value, j) => (j === valueIndex ? { ...value, deltaLei } : value)) }
      ),
    }));

  const required = draft?.customFields?.filter((field) => field.required) || [];
  const optional = draft?.customFields?.filter((field) => !field.required) || [];
  const canApply = draft?.hasConfig && (!hasExisting || mode === APPLY_MODES.COMPLETE || (mode === APPLY_MODES.REPLACE && replaceConfirmed));

  return (
    <Sheet title="Configurează variantele și personalizarea cu AI" onClose={onClose}>
      <div className={styles.sheetBody}>
        <label className={styles.label} htmlFor="sl-order-ai">
          Spune-ne ce poate alege clientul și ce trebuie să îți trimită
        </label>
        <textarea
          id="sl-order-ai"
          className={styles.textarea}
          rows={4}
          maxLength={ORDER_AI_MAX_MESSAGE}
          value={message}
          placeholder="Ex: Vând invitații în trei culori, cu două tipuri de hârtie. Hârtia premium costă 5 lei în plus. Clientul îmi trimite numele mirilor și data evenimentului."
          onChange={(event) => onChangeMessage(event.target.value)}
        />
        <button type="button" className={styles.secondaryBtn} onClick={onSend} disabled={status === "loading" || !message.trim()}>
          {status === "loading" ? "Artfest analizează…" : proposal ? "Trimite precizarea" : "Propune configurația"}
        </button>

        {status === "failed" && (
          <p className={styles.inlineError} role="alert">
            {error}
          </p>
        )}

        {draft && (
          <div className={styles.aiProposal} aria-live="polite">
            {draft.message && <p className={styles.noticeP}>{draft.message}</p>}

            {draft.questions.length > 0 && (
              <div className={styles.notice}>
                <strong>Ne mai trebuie câteva informații:</strong>
                <ul className={styles.helpMissing}>
                  {draft.questions.map((question) => (
                    <li key={question}>{question}</li>
                  ))}
                </ul>
                <span className={styles.hint}>Răspunde mai sus și trimite precizarea.</span>
              </div>
            )}

            {draft.suggestsQuote && (
              <p className={styles.notice}>
                Pare un produs cu preț stabilit după cerințe. Dacă așa este, alege „Prețul depinde de cerințe” în formular. Nu schimbăm noi
                modul de vânzare.
              </p>
            )}

            {draft.variants.length > 0 && (
              <section>
                <h3 className={styles.subTitle}>Variante propuse</h3>
                {draft.variants.map((variant, variantIndex) => (
                  <div key={variant.label} className={styles.optionCard}>
                    <strong>
                      {variant.label}
                      {variant.required ? " (clientul trebuie să aleagă)" : " (opțional)"}
                    </strong>
                    {variant.values.length === 0 && <span className={styles.warnText}>Fără valori: le adaugi după aplicare.</span>}
                    <ul className={styles.aiValues}>
                      {variant.values.map((value, valueIndex) => (
                        <li key={value.label}>
                          <span>{value.label}</span>
                          <label className={styles.aiDelta}>
                            + lei
                            <input
                              className={styles.input}
                              inputMode="decimal"
                              placeholder="0"
                              value={value.deltaLei}
                              aria-label={`Diferență de preț pentru ${value.label}`}
                              onChange={(event) => setDelta(variantIndex, valueIndex, event.target.value)}
                            />
                          </label>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                <p className={styles.hint}>
                  Am completat doar sumele spuse de tine. Verifică-le și modifică-le aici: nimic nu se aplică până nu apeși „Aplică în formular”.
                </p>
              </section>
            )}

            {draft.customFields.length > 0 && (
              <section>
                <h3 className={styles.subTitle}>Personalizări propuse</h3>
                {required.length > 0 && (
                  <p className={styles.noticeP}>
                    <strong>Obligatorii:</strong> {required.map((field) => field.label).join(", ")}
                  </p>
                )}
                {optional.length > 0 && (
                  <p className={styles.noticeP}>
                    <strong>Opționale:</strong> {optional.map((field) => field.label).join(", ")}
                  </p>
                )}
              </section>
            )}

            {draft.hasConfig && hasExisting && (
              <fieldset className={styles.aiApplyChoice}>
                <legend className={styles.label}>Ai deja variante sau personalizări completate</legend>
                <label className={styles.check}>
                  <input type="radio" name="sl-ai-mode" checked={mode === APPLY_MODES.COMPLETE} onChange={() => setMode(APPLY_MODES.COMPLETE)} />
                  Completează: păstrează ce am scris și adaugă doar ce lipsește
                </label>
                <label className={styles.check}>
                  <input type="radio" name="sl-ai-mode" checked={mode === APPLY_MODES.REPLACE} onChange={() => setMode(APPLY_MODES.REPLACE)} />
                  Înlocuiește configurația mea cu această propunere
                </label>
                {mode === APPLY_MODES.REPLACE && (
                  <label className={styles.check}>
                    <input type="checkbox" checked={replaceConfirmed} onChange={(event) => setReplaceConfirmed(event.target.checked)} />
                    Da, variantele și personalizările mele actuale vor fi șterse din formular
                  </label>
                )}
                <span className={styles.hint}>Ca să păstrezi configurația neschimbată, închide fereastra.</span>
              </fieldset>
            )}

            {draft.hasConfig && (
              <button type="button" className={styles.primaryBtnWide} onClick={() => onApply(draft, hasExisting ? mode : APPLY_MODES.COMPLETE)} disabled={!canApply}>
                Aplică în formular
              </button>
            )}
          </div>
        )}

        <p className={styles.hint}>Nu se aplică nimic până nu confirmi. Prețul de bază, stocul și termenul rămân cum le-ai completat.</p>
      </div>
    </Sheet>
  );
}
