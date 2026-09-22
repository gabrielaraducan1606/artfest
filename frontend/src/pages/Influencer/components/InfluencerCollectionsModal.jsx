import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { api } from "../../../lib/api.js";

import styles from "./InfluencerCollectionsModal.module.css";

/*
 * Oglindesc EXACT constantele din backend
 * (influencerCollectionRoutes.js) - doar pentru validare client-side
 * instantanee, înainte de request. Sursa de adevăr rămâne backend-ul
 * (Zod) - dacă vreodată aceste numere diverg, serverul tot respinge
 * corect, doar mesajul instant de-aici ar întârzia cu un round-trip.
 */
const MAX_TITLE_LENGTH = 160;
const MAX_DESCRIPTION_LENGTH = 5000;
const MAX_COLLECTION_PRODUCTS = 100;

const AI_PROMPT_EXAMPLES = [
  "Cadouri sub 100 lei",
  "Bijuterii minimaliste",
  "Cadouri pentru profesoare",
  "Produse pentru botez",
];

const CREATE_COLLECTION_FORM_ID =
  "influencer-create-collection-form";

export default function InfluencerCollectionsModal({
  onClose,
}) {
  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    collections,
    setCollections,
  ] = useState([]);

  const [
    selectedId,
    setSelectedId,
  ] = useState(null);

  const [
    selectedCollection,
    setSelectedCollection,
  ] = useState(null);

  const [
    detailLoading,
    setDetailLoading,
  ] = useState(false);

  /*
   * Mesajele de eroare/succes sunt SCOPATE pe zonă ("field"), nu mai
   * e un singur banner global - fiecare acțiune (listă/creare/detaliu/
   * AI/căutare/produse) își arată mesajul lângă zona ei, nu în capul
   * modalului. `setErrorFor`/`setSuccessFor` sunt singurele locuri
   * care scriu în aceste 4 state-uri - restul codului le folosește pe
   * acestea, nu `setError`/`setSuccess` direct.
   */
  const [
    error,
    setError,
  ] = useState("");

  const [
    errorField,
    setErrorField,
  ] = useState("");

  const [
    success,
    setSuccess,
  ] = useState("");

  const [
    successField,
    setSuccessField,
  ] = useState("");

  const setErrorFor = useCallback(
    (field, message) => {
      setError(message || "");
      setErrorField(message ? field : "");
    },
    []
  );

  const setSuccessFor = useCallback(
    (field, message) => {
      setSuccess(message || "");
      setSuccessField(message ? field : "");
    },
    []
  );

  const clearMessages = useCallback(
    (field) => {
      if (!field || errorField === field) {
        setError("");
        setErrorField("");
      }

      if (!field || successField === field) {
        setSuccess("");
        setSuccessField("");
      }
    },
    [errorField, successField]
  );

  const [
    title,
    setTitle,
  ] = useState("");

  const [
    description,
    setDescription,
  ] = useState("");

  const [
    saving,
    setSaving,
  ] = useState(false);

  const [
    productSearch,
    setProductSearch,
  ] = useState("");

  const [
    productSuggestions,
    setProductSuggestions,
  ] = useState([]);

  const [
    productSearchLoading,
    setProductSearchLoading,
  ] = useState(false);

  const [
    productBusyId,
    setProductBusyId,
  ] = useState("");

  const [
    reorderBusy,
    setReorderBusy,
  ] = useState(false);

  const [
    copiedCollectionId,
    setCopiedCollectionId,
  ] = useState("");

  const [
    referralCode,
    setReferralCode,
  ] = useState("");

  /* =========================================================
     AI

     `productTab` e strict vizual (Manual/AI) - înlocuiește vechiul
     toggle `aiOpen`. Nu schimbă nimic din logica de selecție/adăugare
     produse, doar CARE panou e vizibil.
  ========================================================= */

  const [
    productTab,
    setProductTab,
  ] = useState("manual");

  const [
    aiPrompt,
    setAiPrompt,
  ] = useState("");

  const [
    aiBudgetMin,
    setAiBudgetMin,
  ] = useState("");

  const [
    aiBudgetMax,
    setAiBudgetMax,
  ] = useState("");

  const [
    aiLimit,
    setAiLimit,
  ] = useState(12);

  const [
    aiLoading,
    setAiLoading,
  ] = useState(false);

  const [
    aiRecommendations,
    setAiRecommendations,
  ] = useState([]);

  const [
    aiSelectedIds,
    setAiSelectedIds,
  ] = useState([]);

  const [
    aiAdding,
    setAiAdding,
  ] = useState(false);

  /* =========================================================
     MODAL

     Escape închide, Tab/Shift+Tab rămân captive în interiorul
     modalului (focus trap simplu, fără librărie nouă), iar focusul
     pleacă automat pe primul element focusabil la deschidere.
  ========================================================= */

  const modalRef =
    useRef(null);

  useEffect(() => {
    const previous =
      document.body.style
        .overflow;

    document.body.style.overflow =
      "hidden";

    const previouslyFocused =
      document.activeElement;

    function getFocusable() {
      const node =
        modalRef.current;

      if (!node) {
        return [];
      }

      return Array.from(
        node.querySelectorAll(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter(
        (element) =>
          element.offsetParent !==
          null
      );
    }

    const initialFocusTimer =
      window.setTimeout(
        () => {
          getFocusable()[0]?.focus();
        },
        0
      );

    function onKeyDown(
      event
    ) {
      if (
        event.key ===
        "Escape"
      ) {
        onClose?.();

        return;
      }

      if (
        event.key !==
        "Tab"
      ) {
        return;
      }

      const focusable =
        getFocusable();

      if (
        !focusable.length
      ) {
        return;
      }

      const first =
        focusable[0];

      const last =
        focusable[
          focusable.length -
            1
        ];

      if (
        event.shiftKey &&
        document.activeElement ===
          first
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        document.activeElement ===
          last
      ) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener(
      "keydown",
      onKeyDown
    );

    return () => {
      window.clearTimeout(
        initialFocusTimer
      );

      document.body.style.overflow =
        previous;

      document.removeEventListener(
        "keydown",
        onKeyDown
      );

      if (
        previouslyFocused instanceof
        HTMLElement
      ) {
        previouslyFocused.focus();
      }
    };
  }, [onClose]);

  /* =========================================================
     COLLECTIONS
  ========================================================= */

  const loadCollections =
    useCallback(
      async () => {
        setLoading(true);
        clearMessages("list");

        try {
          const data =
            await api(
              "/api/influencer/collections"
            );

          setCollections(
            Array.isArray(
              data?.collections
            )
              ? data.collections
              : []
          );
        } catch (err) {
          setErrorFor(
            "list",
            err?.data?.message ||
              err?.message ||
              "Nu am putut încărca colecțiile. Încearcă din nou."
          );
        } finally {
          setLoading(false);
        }
      },
      [clearMessages, setErrorFor]
    );

  useEffect(() => {
    loadCollections();
  }, [loadCollections]);

  /* =========================================================
     REFERRAL CODE

     Aceeași sursă folosită de InfluencerDashboardPage.jsx
     (GET /api/influencer/me -> profile.referralCode) - necesar
     pentru ca linkul copiat al colecției să poarte ?ref=,
     altfel comenzile din colecție nu se mai atribuie
     influencerului.
  ========================================================= */

  useEffect(() => {
    let active = true;

    api("/api/influencer/me")
      .then((data) => {
        if (!active) return;

        setReferralCode(
          data?.profile?.referralCode || ""
        );
      })
      .catch(() => {
        // Link-ul rămâne funcțional fără ?ref= dacă nu putem
        // afla codul - nu blocăm restul modalului din cauza asta.
      });

    return () => {
      active = false;
    };
  }, []);

  /* =========================================================
     DETAIL
  ========================================================= */

  const loadCollectionDetail =
    useCallback(
      async (
        collectionId
      ) => {
        if (!collectionId) {
          setSelectedCollection(
            null
          );

          return;
        }

        setDetailLoading(true);
        clearMessages("detail");

        try {
          const data =
            await api(
              `/api/influencer/collections/${collectionId}`
            );

          setSelectedCollection(
            data?.collection ||
              null
          );
        } catch (err) {
          setErrorFor(
            "detail",
            err?.data?.message ||
              err?.message ||
              "Nu am putut încărca această colecție. Încearcă din nou."
          );
        } finally {
          setDetailLoading(false);
        }
      },
      [clearMessages, setErrorFor]
    );

  useEffect(() => {
    if (selectedId) {
      loadCollectionDetail(
        selectedId
      );
    } else {
      setSelectedCollection(
        null
      );
    }
  }, [
    selectedId,
    loadCollectionDetail,
  ]);

  /*
   * Nu păstrăm rezultate AI / căutări
   * când influencerul schimbă colecția.
   */
  useEffect(() => {
    setProductTab("manual");
    setAiPrompt("");
    setAiBudgetMin("");
    setAiBudgetMax("");
    setAiLimit(12);
    setAiRecommendations([]);
    setAiSelectedIds([]);

    setProductSearch("");
    setProductSuggestions([]);

    clearMessages("ai");
    clearMessages("search");
    clearMessages("products");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  /* =========================================================
     CREATE

     Validări client-side (feedback instant, lângă câmp) - backend-ul
     (Zod) rămâne sursa de adevăr finală, aceste verificări doar evită
     un round-trip pentru greșeli evidente.
  ========================================================= */

  async function createCollection(
    event
  ) {
    event.preventDefault();

    if (saving) {
      // previne double-submit (ex. Enter + click rapid pe buton)
      return;
    }

    const cleanTitle =
      title.trim();

    const cleanDescription =
      description.trim();

    if (!cleanTitle) {
      setErrorFor(
        "create",
        "Adaugă un titlu pentru colecție."
      );

      return;
    }

    if (
      cleanTitle.length < 2
    ) {
      setErrorFor(
        "create",
        "Titlul este prea scurt. Scrie minimum 2 caractere."
      );

      return;
    }

    if (
      cleanTitle.length >
      MAX_TITLE_LENGTH
    ) {
      setErrorFor(
        "create",
        `Titlul poate avea cel mult ${MAX_TITLE_LENGTH} de caractere.`
      );

      return;
    }

    if (
      cleanDescription.length >
      MAX_DESCRIPTION_LENGTH
    ) {
      setErrorFor(
        "create",
        `Descrierea poate avea cel mult ${MAX_DESCRIPTION_LENGTH} de caractere.`
      );

      return;
    }

    setSaving(true);
    clearMessages("create");

    try {
      const data =
        await api(
          "/api/influencer/collections",
          {
            method:
              "POST",

            body: {
              title:
                cleanTitle,

              description:
                cleanDescription ||
                null,

              isActive:
                true,
            },
          }
        );

      setTitle("");
      setDescription("");

      await loadCollections();

      if (
        data?.collection?.id
      ) {
        setSelectedId(
          data.collection.id
        );
      }

      setSuccessFor(
        "create",
        "Colecția a fost creată."
      );
    } catch (err) {
      /*
       * Datele completate NU se pierd la eroare - title/description
       * se golesc DOAR în ramura de succes de mai sus.
       */
      setErrorFor(
        "create",
        err?.data?.message ||
          err?.message ||
          "Nu am putut crea colecția. Încearcă din nou."
      );
    } finally {
      setSaving(false);
    }
  }

  /* =========================================================
     DELETE
  ========================================================= */

  async function deleteCollection(
    collection
  ) {
    const confirmed =
      window.confirm(
        `Ștergi colecția „${collection.title}”? Produsele nu vor fi șterse din Artfest.`
      );

    if (!confirmed) {
      return;
    }

    clearMessages("list");

    try {
      await api(
        `/api/influencer/collections/${collection.id}`,
        {
          method:
            "DELETE",
        }
      );

      if (
        selectedId ===
        collection.id
      ) {
        setSelectedId(
          null
        );

        setSelectedCollection(
          null
        );
      }

      await loadCollections();

      setSuccessFor(
        "list",
        "Colecția a fost ștearsă."
      );
    } catch (err) {
      setErrorFor(
        "list",
        err?.data?.message ||
          err?.message ||
          "Nu am putut șterge colecția. Încearcă din nou."
      );
    }
  }

  /* =========================================================
     PUBLIC / HIDDEN
  ========================================================= */

  async function toggleCollection(
    collection
  ) {
    clearMessages("list");

    try {
      await api(
        `/api/influencer/collections/${collection.id}`,
        {
          method:
            "PATCH",

          body: {
            isActive:
              !collection.isActive,
          },
        }
      );

      await loadCollections();

      if (
        selectedId ===
        collection.id
      ) {
        await loadCollectionDetail(
          collection.id
        );
      }
    } catch (err) {
      setErrorFor(
        "list",
        err?.data?.message ||
          err?.message ||
          "Nu am putut actualiza colecția. Încearcă din nou."
      );
    }
  }

  /* =========================================================
     COPY
  ========================================================= */

  async function copyCollectionLink(
    collection
  ) {
    if (!collection?.slug) {
      return;
    }

    const base =
      `${window.location.origin}/selectii/${collection.slug}`;

    const url =
      referralCode
        ? `${base}?ref=${encodeURIComponent(referralCode)}`
        : base;

    try {
      await navigator.clipboard.writeText(
        url
      );

      setCopiedCollectionId(
        collection.id
      );

      window.setTimeout(
        () =>
          setCopiedCollectionId(
            ""
          ),
        1500
      );
    } catch {
      setErrorFor(
        "detail",
        "Nu am putut copia linkul."
      );
    }
  }

  /* =========================================================
     EXISTING PRODUCTS
  ========================================================= */

  const existingProductIds =
    useMemo(
      () =>
        new Set(
          (
            selectedCollection
              ?.items || []
          ).map(
            (item) =>
              item.productId
          )
        ),
      [
        selectedCollection
          ?.items,
      ]
    );

  /* =========================================================
     MANUAL SEARCH
  ========================================================= */

  useEffect(() => {
    const term =
      productSearch.trim();

    if (
      term.length < 2 ||
      !selectedCollection
    ) {
      setProductSuggestions(
        []
      );

      setProductSearchLoading(
        false
      );

      return;
    }

    const controller =
      new AbortController();

    const timer =
      window.setTimeout(
        async () => {
          try {
            setProductSearchLoading(
              true
            );

            clearMessages(
              "search"
            );

            /*
             * BUGFIX (audit /api): folosea fetch() brut, cu path
             * relativ hardcodat - ocolea helperul central (nu
             * respecta VITE_API_URL/VITE_API_BASE_URL, nu trecea
             * prin gestionarea uniformă a erorilor/politicilor).
             * api() întoarce direct JSON-ul parsat și aruncă pe
             * răspuns non-2xx (prins mai jos, la fel ca înainte).
             */
            const data =
              await api(
                `/api/public/products/suggest?q=${encodeURIComponent(
                  term
                )}`,
                {
                  signal:
                    controller.signal,
                }
              );

            const products =
              Array.isArray(
                data?.products
              )
                ? data.products
                : [];

            setProductSuggestions(
              products.filter(
                (product) =>
                  !existingProductIds.has(
                    product.id
                  )
              )
            );
          } catch (err) {
            if (
              err?.name !==
              "AbortError"
            ) {
              setProductSuggestions(
                []
              );

              setErrorFor(
                "search",
                "Nu am putut încărca produsele. Încearcă din nou."
              );
            }
          } finally {
            if (
              !controller.signal
                .aborted
            ) {
              setProductSearchLoading(
                false
              );
            }
          }
        },
        250
      );

    return () => {
      window.clearTimeout(
        timer
      );

      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    productSearch,
    selectedCollection?.id,
    existingProductIds, selectedCollection
  ]);

  /* =========================================================
     AI
  ========================================================= */

  async function loadAiRecommendations() {
    if (
      !selectedCollection?.id
    ) {
      return;
    }

    const prompt =
      aiPrompt.trim() ||
      selectedCollection
        .description
        ?.trim() ||
      selectedCollection
        .title
        ?.trim();

    if (!prompt) {
      setErrorFor(
        "ai",
        "Scrie ce fel de produse vrei să găsească AI-ul."
      );

      return;
    }

    const min =
      aiBudgetMin !== ""
        ? Number(
            aiBudgetMin
          )
        : null;

    const max =
      aiBudgetMax !== ""
        ? Number(
            aiBudgetMax
          )
        : null;

    if (
      min !== null &&
      (
        !Number.isFinite(
          min
        ) ||
        min < 0
      )
    ) {
      setErrorFor(
        "ai",
        "Bugetul minim nu este valid."
      );

      return;
    }

    if (
      max !== null &&
      (
        !Number.isFinite(
          max
        ) ||
        max < 0
      )
    ) {
      setErrorFor(
        "ai",
        "Bugetul maxim nu este valid."
      );

      return;
    }

    if (
      min !== null &&
      max !== null &&
      min > max
    ) {
      setErrorFor(
        "ai",
        "Bugetul minim nu poate fi mai mare decât bugetul maxim."
      );

      return;
    }

    setAiLoading(true);
    clearMessages("ai");
    setAiRecommendations([]);
    setAiSelectedIds([]);

    try {
      const response =
        await api(
          "/api/influencer/collections/ai-recommend",
          {
            method:
              "POST",

            body: {
              collectionId:
                selectedCollection.id,

              prompt,

              budgetMin:
                min,

              budgetMax:
                max,

              limit:
                Number(
                  aiLimit
                ) || 12,
            },
          }
        );

      const recommendations =
        Array.isArray(
          response
            ?.recommendations
        )
          ? response
              .recommendations
          : [];

      const filtered =
        recommendations.filter(
          (item) =>
            item?.productId &&
            !existingProductIds.has(
              item.productId
            )
        );

      setAiRecommendations(
        filtered
      );

      setAiSelectedIds(
        filtered.map(
          (item) =>
            item.productId
        )
      );

      if (
        !filtered.length
      ) {
        setErrorFor(
          "ai",
          "Nu am găsit suficiente produse potrivite. Încearcă o descriere mai generală."
        );
      }
    } catch (err) {
      setErrorFor(
        "ai",
        err?.data?.message ||
          err?.message ||
          "Nu am putut genera recomandările acum. Poți încerca din nou sau selecta produsele manual."
      );
    } finally {
      setAiLoading(false);
    }
  }

  function toggleAiProduct(
    productId,
    checked
  ) {
    if (!productId) {
      return;
    }

    setAiSelectedIds(
      (current) => {
        if (checked) {
          if (
            current.includes(
              productId
            )
          ) {
            return current;
          }

          return [
            ...current,
            productId,
          ];
        }

        return current.filter(
          (id) =>
            id !== productId
        );
      }
    );
  }

  async function addAiSelectedProducts() {
    if (!selectedCollection?.id) {
      return;
    }

    if (!aiSelectedIds.length) {
      setErrorFor(
        "ai",
        "Selectează cel puțin un produs din recomandări."
      );

      return;
    }

    setAiAdding(true);
    clearMessages("ai");

    try {
      const data =
        await api(
          `/api/influencer/collections/${selectedCollection.id}/products`,
          {
            method:
              "POST",

            body: {
              productIds:
                aiSelectedIds,
            },
          }
        );

      setAiRecommendations(
        []
      );

      setAiSelectedIds(
        []
      );

      setAiPrompt("");
      setAiBudgetMin("");
      setAiBudgetMax("");

      await loadCollectionDetail(
        selectedCollection.id
      );

      await loadCollections();

      setSuccessFor(
        "ai",
        data?.added
          ? "Produsele selectate au fost adăugate în colecție."
          : "Produsele erau deja în colecție."
      );
    } catch (err) {
      setErrorFor(
        "ai",
        err?.data?.message ||
          err?.message ||
          "Nu am putut adăuga produsele recomandate. Încearcă din nou."
      );
    } finally {
      setAiAdding(false);
    }
  }

  const allAiSelected =
    aiRecommendations.length >
      0 &&
    aiRecommendations.every(
      (item) =>
        aiSelectedIds.includes(
          item.productId
        )
    );

  /* =========================================================
     MANUAL ADD
  ========================================================= */

  async function addProduct(
    product
  ) {
    if (
      !selectedCollection?.id ||
      !product?.id
    ) {
      return;
    }

    setProductBusyId(
      product.id
    );

    clearMessages("search");
    clearMessages("products");

    try {
      await api(
        `/api/influencer/collections/${selectedCollection.id}/products`,
        {
          method:
            "POST",

          body: {
            productIds: [
              product.id,
            ],
          },
        }
      );

      setProductSearch("");
      setProductSuggestions([]);

      /*
       * Produsul tocmai adăugat manual nu mai trebuie oferit și ca
       * recomandare AI încă bifată - AI + manual nu trebuie să
       * lucreze contra unul altuia (cerință #7).
       */
      setAiRecommendations(
        (current) =>
          current.filter(
            (item) =>
              item.productId !==
              product.id
          )
      );

      setAiSelectedIds(
        (current) =>
          current.filter(
            (id) =>
              id !==
              product.id
          )
      );

      await loadCollectionDetail(
        selectedCollection.id
      );

      await loadCollections();
    } catch (err) {
      setErrorFor(
        "search",
        err?.data?.message ||
          err?.message ||
          "Nu am putut adăuga produsul. Încearcă din nou."
      );
    } finally {
      setProductBusyId(
        ""
      );
    }
  }

  /* =========================================================
     REMOVE
  ========================================================= */

  async function removeProduct(
    productId
  ) {
    if (
      !selectedCollection?.id
    ) {
      return;
    }

    setProductBusyId(
      productId
    );

    clearMessages("products");

    try {
      await api(
        `/api/influencer/collections/${selectedCollection.id}/products/${productId}`,
        {
          method:
            "DELETE",
        }
      );

      await loadCollectionDetail(
        selectedCollection.id
      );

      await loadCollections();
    } catch (err) {
      setErrorFor(
        "products",
        err?.data?.message ||
          err?.message ||
          "Nu am putut elimina produsul. Încearcă din nou."
      );
    } finally {
      setProductBusyId(
        ""
      );
    }
  }

  /* =========================================================
     REORDER
  ========================================================= */

  async function moveProduct(
    index,
    direction
  ) {
    if (
      !selectedCollection?.id
    ) {
      return;
    }

    const items = [
      ...(
        selectedCollection.items ||
        []
      ),
    ];

    const targetIndex =
      index +
      direction;

    if (
      targetIndex < 0 ||
      targetIndex >=
        items.length
    ) {
      return;
    }

    const temp =
      items[index];

    items[index] =
      items[targetIndex];

    items[targetIndex] =
      temp;

    setReorderBusy(true);
    clearMessages("products");

    try {
      await api(
        `/api/influencer/collections/${selectedCollection.id}/products/reorder`,
        {
          method:
            "PATCH",

          body: {
            items:
              items.map(
                (
                  item,
                  position
                ) => ({
                  productId:
                    item.productId,

                  position,
                })
              ),
          },
        }
      );

      await loadCollectionDetail(
        selectedCollection.id
      );
    } catch (err) {
      setErrorFor(
        "products",
        err?.data?.message ||
          err?.message ||
          "Nu am putut schimba ordinea produselor. Încearcă din nou."
      );
    } finally {
      setReorderBusy(false);
    }
  }

  /* =========================================================
     UI
  ========================================================= */

  return (
    <div
      className={
        styles.backdrop
      }
      onMouseDown={
        onClose
      }
    >
      <div
        ref={
          modalRef
        }
        className={
          styles.modal
        }
        role="dialog"
        aria-modal="true"
        aria-labelledby="influencer-collections-title"
        onMouseDown={(event) =>
          event.stopPropagation()
        }
      >
        <header
          className={
            styles.header
          }
        >
          <div
            className={
              styles.headerText
            }
          >
            <div
              className={
                styles.eyebrow
              }
            >
              PROMOVARE
            </div>

            <h2
              id="influencer-collections-title"
            >
              Colecțiile mele
            </h2>

            <p
              className={
                styles.headerSubtitle
              }
            >
              Creează selecții de produse și distribuie-le comunității tale.
            </p>
          </div>

          <button
            type="button"
            className={
              styles.closeIconButton
            }
            aria-label="Închide fereastra"
            onClick={
              onClose
            }
          >
            ×
          </button>
        </header>

        <div
          className={
            styles.body
          }
        >
          {errorField === "list" &&
            error && (
              <div
                className={
                  styles.errorBox
                }
                role="alert"
                aria-live="polite"
              >
                {error}
              </div>
            )}

          {successField ===
            "list" &&
            success && (
              <div
                className={
                  styles.successBox
                }
                role="status"
                aria-live="polite"
              >
                {success}
              </div>
            )}

          {/* CREATE */}

          <section
            className={
              styles.sectionCard
            }
          >
            <div
              className={
                styles.sectionCardHeader
              }
            >
              <span
                className={
                  styles.sectionBadge
                }
              >
                1
              </span>

              <div>
                <h3
                  className={
                    styles.sectionTitle
                  }
                >
                  Detalii colecție
                </h3>

                <p
                  className={
                    styles.sectionSubtitle
                  }
                >
                  Numele și descrierea pe care le vede comunitatea ta.
                </p>
              </div>
            </div>

            <form
              id={
                CREATE_COLLECTION_FORM_ID
              }
              onSubmit={
                createCollection
              }
              className={
                styles.createForm
              }
            >
              {errorField ===
                "create" &&
                error && (
                  <div
                    className={
                      styles.errorBox
                    }
                    role="alert"
                    aria-live="polite"
                    id="create-collection-error"
                  >
                    {error}
                  </div>
                )}

              {successField ===
                "create" &&
                success && (
                  <div
                    className={
                      styles.successBox
                    }
                    role="status"
                    aria-live="polite"
                  >
                    {success}
                  </div>
                )}

              <label
                className={
                  styles.field
                }
              >
                <span
                  className={
                    styles.fieldLabel
                  }
                >
                  Titlu colecție
                </span>

                <input
                  className={
                    styles.textInput
                  }
                  value={
                    title
                  }
                  onChange={(event) =>
                    setTitle(
                      event.target.value
                    )
                  }
                  placeholder="Ex: Cadouri pentru profesoare"
                  maxLength={
                    MAX_TITLE_LENGTH
                  }
                  aria-invalid={
                    errorField ===
                    "create"
                  }
                  aria-describedby={
                    errorField ===
                    "create"
                      ? "create-collection-error"
                      : undefined
                  }
                />

                <small
                  className={
                    styles.helperText
                  }
                >
                  {
                    title.length
                  }
                  /
                  {
                    MAX_TITLE_LENGTH
                  }
                </small>
              </label>

              <label
                className={
                  styles.field
                }
              >
                <span
                  className={
                    styles.fieldLabel
                  }
                >
                  Descriere (opțional)
                </span>

                <textarea
                  className={
                    styles.textInput
                  }
                  value={
                    description
                  }
                  onChange={(event) =>
                    setDescription(
                      event.target.value
                    )
                  }
                  placeholder="Descriere opțională..."
                  rows={
                    2
                  }
                  maxLength={
                    MAX_DESCRIPTION_LENGTH
                  }
                />
              </label>
            </form>
          </section>

          {loading ? (
            <div
              className={
                styles.centerState
              }
            >
              Se încarcă…
            </div>
          ) : !collections.length ? (
            <div
              className={
                styles.emptyState
              }
            >
              Nu ai creat încă nicio colecție.
            </div>
          ) : (
          <div
            className={
              styles.layout
            }
          >
            {/* LIST */}

            <aside
              className={
                styles.collectionList
              }
            >
              {collections.map(
                (
                  collection
                ) => (
                  <button
                    key={
                      collection.id
                    }
                    type="button"
                    className={`${styles.collectionCard} ${
                      selectedId ===
                      collection.id
                        ? styles.collectionCardActive
                        : ""
                    }`}
                    onClick={() =>
                      setSelectedId(
                        collection.id
                      )
                    }
                  >
                    <div
                      className={
                        styles.collectionCardTop
                      }
                    >
                      <strong>
                        {
                          collection.title
                        }
                      </strong>

                      <span
                        className={
                          collection.isActive
                            ? styles.activeBadge
                            : styles.inactiveBadge
                        }
                      >
                        {collection.isActive
                          ? "Publică"
                          : "Ascunsă"}
                      </span>
                    </div>

                    <div
                      className={
                        styles.collectionMeta
                      }
                    >
                      {collection.productsCount ||
                        0}{" "}
                      produse ·{" "}
                      {collection.visits ||
                        0}{" "}
                      vizite
                    </div>
                  </button>
                )
              )}
            </aside>

            {/* DETAIL */}

            <section
              className={
                styles.detail
              }
            >
              {!selectedId ? (
                <div
                  className={
                    styles.selectState
                  }
                >
                  Selectează o colecție pentru a gestiona produsele.
                </div>
              ) : detailLoading ? (
                <div
                  className={
                    styles.centerState
                  }
                >
                  Se încarcă…
                </div>
              ) : selectedCollection ? (
                <>
                  <div
                    className={
                      styles.detailHeader
                    }
                  >
                    <div>
                      <h3>
                        {
                          selectedCollection.title
                        }
                      </h3>

                      {selectedCollection.description && (
                        <p>
                          {
                            selectedCollection.description
                          }
                        </p>
                      )}
                    </div>

                    <div
                      className={
                        styles.actions
                      }
                    >
                      <button
                        type="button"
                        className={
                          styles.secondaryButton
                        }
                        onClick={() =>
                          copyCollectionLink(
                            selectedCollection
                          )
                        }
                      >
                        {copiedCollectionId ===
                        selectedCollection.id
                          ? "Copiat ✓"
                          : "Copiază link"}
                      </button>

                      <button
                        type="button"
                        className={
                          styles.secondaryButton
                        }
                        onClick={() =>
                          toggleCollection(
                            selectedCollection
                          )
                        }
                      >
                        {selectedCollection.isActive
                          ? "Ascunde"
                          : "Publică"}
                      </button>

                      <button
                        type="button"
                        className={`${styles.secondaryButton} ${styles.dangerText}`}
                        onClick={() =>
                          deleteCollection(
                            selectedCollection
                          )
                        }
                      >
                        Șterge
                      </button>
                    </div>
                  </div>

                  {errorField ===
                    "detail" &&
                    error && (
                      <div
                        className={
                          styles.errorBox
                        }
                        role="alert"
                        aria-live="polite"
                      >
                        {error}
                      </div>
                    )}

                  {successField ===
                    "detail" &&
                    success && (
                      <div
                        className={
                          styles.successBox
                        }
                        role="status"
                        aria-live="polite"
                      >
                        {success}
                      </div>
                    )}

                  {/* ALEGE PRODUSELE */}

                  <section
                    className={
                      styles.sectionCard
                    }
                  >
                    <div
                      className={
                        styles.sectionCardHeader
                      }
                    >
                      <span
                        className={
                          styles.sectionBadge
                        }
                      >
                        2
                      </span>

                      <div>
                        <h3
                          className={
                            styles.sectionTitle
                          }
                        >
                          Alege produsele
                        </h3>

                        <p
                          className={
                            styles.sectionSubtitle
                          }
                        >
                          Manual sau cu ajutorul AI-ului.
                        </p>
                      </div>
                    </div>

                    <div
                      className={
                        styles.tabs
                      }
                      role="tablist"
                      aria-label="Mod de selecție produse"
                    >
                      <button
                        type="button"
                        role="tab"
                        id="product-tab-manual"
                        aria-selected={
                          productTab ===
                          "manual"
                        }
                        aria-controls="product-panel-manual"
                        className={`${styles.tab} ${
                          productTab ===
                          "manual"
                            ? styles.tabActive
                            : ""
                        }`}
                        onClick={() =>
                          setProductTab(
                            "manual"
                          )
                        }
                      >
                        🔍 Manual
                      </button>

                      <button
                        type="button"
                        role="tab"
                        id="product-tab-ai"
                        aria-selected={
                          productTab ===
                          "ai"
                        }
                        aria-controls="product-panel-ai"
                        className={`${styles.tab} ${
                          productTab ===
                          "ai"
                            ? styles.tabActive
                            : ""
                        }`}
                        onClick={() =>
                          setProductTab(
                            "ai"
                          )
                        }
                      >
                        ✨ Cu AI
                      </button>
                    </div>

                    {productTab ===
                      "manual" && (
                      <div
                        id="product-panel-manual"
                        role="tabpanel"
                        aria-labelledby="product-tab-manual"
                        className={
                          styles.tabPanel
                        }
                      >
                        <label
                          className={
                            styles.field
                          }
                        >
                          <span
                            className={
                              styles.srOnly
                            }
                          >
                            Caută produse Artfest
                          </span>

                          <input
                            className={
                              styles.textInput
                            }
                            type="search"
                            value={
                              productSearch
                            }
                            onChange={(event) =>
                              setProductSearch(
                                event.target.value
                              )
                            }
                            placeholder="Caută produse Artfest..."
                            aria-describedby={
                              errorField ===
                              "search"
                                ? "manual-search-error"
                                : undefined
                            }
                          />
                        </label>

                        {productSearchLoading && (
                          <div
                            className={
                              styles.searchStatus
                            }
                            role="status"
                            aria-live="polite"
                          >
                            Se caută…
                          </div>
                        )}

                        {!productSearchLoading &&
                          errorField ===
                            "search" &&
                          error && (
                            <div
                              className={
                                styles.searchMessage
                              }
                              id="manual-search-error"
                              role="alert"
                              aria-live="polite"
                            >
                              {
                                error
                              }
                            </div>
                          )}

                        {!productSearchLoading &&
                          errorField !==
                            "search" &&
                          productSearch.trim()
                            .length >=
                            2 &&
                          !productSuggestions.length && (
                            <div
                              className={
                                styles.searchMessage
                              }
                            >
                              Nu am găsit produse pentru „
                              {
                                productSearch.trim()
                              }
                              ”.
                            </div>
                          )}

                        {productSuggestions.length >
                          0 && (
                          <div
                            className={
                              styles.productGrid
                            }
                          >
                            {productSuggestions.map(
                              (
                                product
                              ) => (
                                <div
                                  key={
                                    product.id
                                  }
                                  className={
                                    styles.productCard
                                  }
                                >
                                  <ProductThumb
                                    product={
                                      product
                                    }
                                  />

                                  <div
                                    className={
                                      styles.productCardBody
                                    }
                                  >
                                    <strong
                                      className={
                                        styles.productTitle
                                      }
                                    >
                                      {
                                        product.title
                                      }
                                    </strong>

                                    <div
                                      className={
                                        styles.productMetaRow
                                      }
                                    >
                                      <b
                                        className={
                                          styles.productPrice
                                        }
                                      >
                                        {formatPriceCents(
                                          product.priceCents,
                                          product.currency
                                        )}
                                      </b>

                                      {product
                                        ?.service
                                        ?.vendor
                                        ?.displayName && (
                                        <span
                                          className={
                                            styles.productVendor
                                          }
                                        >
                                          {
                                            product
                                              .service
                                              .vendor
                                              .displayName
                                          }
                                        </span>
                                      )}
                                    </div>
                                  </div>

                                  <button
                                    type="button"
                                    className={
                                      styles.selectButton
                                    }
                                    aria-label={`Adaugă ${product.title} în colecție`}
                                    disabled={
                                      productBusyId ===
                                      product.id
                                    }
                                    onClick={() =>
                                      addProduct(
                                        product
                                      )
                                    }
                                  >
                                    {productBusyId ===
                                    product.id
                                      ? "…"
                                      : "Selectează"}
                                  </button>
                                </div>
                              )
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {productTab ===
                      "ai" && (
                      <div
                        id="product-panel-ai"
                        role="tabpanel"
                        aria-labelledby="product-tab-ai"
                        className={`${styles.tabPanel} ${styles.aiPanel}`}
                      >
                        <div
                          className={
                            styles.aiPanelIntro
                          }
                        >
                          <span
                            className={
                              styles.aiIconBadge
                            }
                            aria-hidden="true"
                          >
                            ✨
                          </span>

                          <div>
                            <strong
                              className={
                                styles.aiPanelTitle
                              }
                            >
                              Alege produse cu AI
                            </strong>

                            <p
                              className={
                                styles.aiPanelSubtitle
                              }
                            >
                              Spune ce fel de colecție vrei, iar AI-ul îți propune produse potrivite din Artfest. Nimic nu se adaugă fără confirmarea ta.
                            </p>
                          </div>
                        </div>

                        <div
                          className={
                            styles.aiForm
                          }
                        >
                          <label
                            className={
                              styles.field
                            }
                          >
                            <span
                              className={
                                styles.fieldLabel
                              }
                            >
                              Ce fel de produse cauți?
                            </span>

                            <textarea
                              className={`${styles.textInput} ${styles.aiTextarea}`}
                              value={
                                aiPrompt
                              }
                              rows={
                                3
                              }
                              maxLength={
                                1500
                              }
                              onChange={(event) =>
                                setAiPrompt(
                                  event.target.value
                                )
                              }
                              placeholder={`Ex: ${
                                selectedCollection.title ||
                                "Cadouri pentru profesoare sub 100 lei"
                              }`}
                            />

                            <small
                              className={
                                styles.helperText
                              }
                            >
                              Dacă îl lași gol, AI-ul folosește automat titlul și descrierea colecției.
                            </small>

                            <div
                              className={
                                styles.aiExamples
                              }
                            >
                              {AI_PROMPT_EXAMPLES.map(
                                (
                                  example
                                ) => (
                                  <button
                                    key={
                                      example
                                    }
                                    type="button"
                                    className={
                                      styles.aiExampleChip
                                    }
                                    onClick={() =>
                                      setAiPrompt(
                                        example
                                      )
                                    }
                                  >
                                    {
                                      example
                                    }
                                  </button>
                                )
                              )}
                            </div>
                          </label>

                          <details
                            className={
                              styles.aiAdvanced
                            }
                          >
                            <summary>
                              Buget și număr de sugestii (opțional)
                            </summary>

                            <div
                              className={
                                styles.aiFieldsGrid
                              }
                            >
                              <label
                                className={
                                  styles.field
                                }
                              >
                                <span
                                  className={
                                    styles.fieldLabel
                                  }
                                >
                                  Buget minim
                                </span>

                                <input
                                  className={
                                    styles.textInput
                                  }
                                  type="number"
                                  min="0"
                                  step="1"
                                  value={
                                    aiBudgetMin
                                  }
                                  onChange={(event) =>
                                    setAiBudgetMin(
                                      event.target.value
                                    )
                                  }
                                  placeholder="50"
                                />
                              </label>

                              <label
                                className={
                                  styles.field
                                }
                              >
                                <span
                                  className={
                                    styles.fieldLabel
                                  }
                                >
                                  Buget maxim
                                </span>

                                <input
                                  className={
                                    styles.textInput
                                  }
                                  type="number"
                                  min="0"
                                  step="1"
                                  value={
                                    aiBudgetMax
                                  }
                                  onChange={(event) =>
                                    setAiBudgetMax(
                                      event.target.value
                                    )
                                  }
                                  placeholder="150"
                                />
                              </label>

                              <label
                                className={
                                  styles.field
                                }
                              >
                                <span
                                  className={
                                    styles.fieldLabel
                                  }
                                >
                                  Sugestii
                                </span>

                                <select
                                  className={
                                    styles.textInput
                                  }
                                  value={
                                    aiLimit
                                  }
                                  onChange={(event) =>
                                    setAiLimit(
                                      Number(
                                        event.target.value
                                      )
                                    )
                                  }
                                >
                                  <option
                                    value={
                                      6
                                    }
                                  >
                                    6 produse
                                  </option>

                                  <option
                                    value={
                                      12
                                    }
                                  >
                                    12 produse
                                  </option>

                                  <option
                                    value={
                                      18
                                    }
                                  >
                                    18 produse
                                  </option>

                                  <option
                                    value={
                                      24
                                    }
                                  >
                                    24 produse
                                  </option>
                                </select>
                              </label>
                            </div>
                          </details>

                          <button
                            type="button"
                            className={
                              styles.aiPrimaryButton
                            }
                            disabled={
                              aiLoading
                            }
                            onClick={
                              loadAiRecommendations
                            }
                          >
                            {aiLoading
                              ? "AI caută produse potrivite pentru colecția ta…"
                              : "✨ Găsește produse potrivite"}
                          </button>
                        </div>

                        {aiLoading && (
                          <div
                            className={
                              styles.aiStatus
                            }
                            role="status"
                            aria-live="polite"
                          >
                            <span
                              className={
                                styles.aiSpinner
                              }
                              aria-hidden="true"
                            />
                            AI caută produse potrivite pentru colecția ta…
                          </div>
                        )}

                        {!aiLoading &&
                          errorField ===
                            "ai" &&
                          error && (
                            <div
                              className={
                                styles.aiStatus
                              }
                              role="alert"
                              aria-live="polite"
                            >
                              <p>
                                {
                                  error
                                }
                              </p>

                              <button
                                type="button"
                                className={
                                  styles.secondaryButton
                                }
                                onClick={
                                  loadAiRecommendations
                                }
                              >
                                Încearcă din nou
                              </button>
                            </div>
                          )}

                        {!aiLoading &&
                          successField ===
                            "ai" &&
                          success && (
                            <div
                              className={
                                styles.successBox
                              }
                              role="status"
                              aria-live="polite"
                            >
                              {
                                success
                              }
                            </div>
                          )}

                        {aiRecommendations.length >
                          0 && (
                          <div
                            className={
                              styles.aiResults
                            }
                          >
                            <div
                              className={
                                styles.aiResultsHeader
                              }
                            >
                              <div>
                                <strong>
                                  Sugestii AI
                                </strong>

                                <span>
                                  {
                                    aiRecommendations.length
                                  }{" "}
                                  recomandări ·{" "}
                                  {
                                    aiSelectedIds.length
                                  }{" "}
                                  selectate
                                </span>
                              </div>

                              <label
                                className={
                                  styles.checkAll
                                }
                              >
                                <input
                                  type="checkbox"
                                  checked={
                                    allAiSelected
                                  }
                                  onChange={(event) => {
                                    setAiSelectedIds(
                                      event.target.checked
                                        ? aiRecommendations.map(
                                            (
                                              item
                                            ) =>
                                              item.productId
                                          )
                                        : []
                                    );
                                  }}
                                />

                                Selectează toate
                              </label>
                            </div>

                            <div
                              className={
                                styles.productGrid
                              }
                            >
                              {aiRecommendations.map(
                                (
                                  recommendation
                                ) => {
                                  const product =
                                    recommendation.product;

                                  const checked =
                                    aiSelectedIds.includes(
                                      recommendation.productId
                                    );

                                  return (
                                    <label
                                      key={
                                        recommendation.productId
                                      }
                                      className={`${styles.productCard} ${styles.aiProductCard} ${
                                        checked
                                          ? styles.productCardSelected
                                          : ""
                                      }`}
                                    >
                                      <input
                                        type="checkbox"
                                        className={
                                          styles.srOnly
                                        }
                                        checked={
                                          checked
                                        }
                                        onChange={(event) =>
                                          toggleAiProduct(
                                            recommendation.productId,
                                            event.target.checked
                                          )
                                        }
                                      />

                                      <div
                                        className={
                                          styles.productThumbWrap
                                        }
                                      >
                                        <ProductThumb
                                          product={
                                            product
                                          }
                                        />

                                        {checked && (
                                          <span
                                            className={
                                              styles.selectedCheck
                                            }
                                            aria-hidden="true"
                                          >
                                            ✓
                                          </span>
                                        )}
                                      </div>

                                      <div
                                        className={
                                          styles.productCardBody
                                        }
                                      >
                                        <strong
                                          className={
                                            styles.productTitle
                                          }
                                        >
                                          {product?.title ||
                                            "Produs"}
                                        </strong>

                                        <div
                                          className={
                                            styles.productMetaRow
                                          }
                                        >
                                          <b
                                            className={
                                              styles.productPrice
                                            }
                                          >
                                            {formatPriceCents(
                                              product?.priceCents,
                                              product?.currency
                                            )}
                                          </b>

                                          {product
                                            ?.service
                                            ?.vendor
                                            ?.displayName && (
                                            <span
                                              className={
                                                styles.productVendor
                                              }
                                            >
                                              {
                                                product
                                                  .service
                                                  .vendor
                                                  .displayName
                                              }
                                            </span>
                                          )}
                                        </div>

                                        {recommendation.reason && (
                                          <p
                                            className={
                                              styles.aiReason
                                            }
                                          >
                                            {
                                              recommendation.reason
                                            }
                                          </p>
                                        )}
                                      </div>

                                      <span
                                        className={`${styles.selectButton} ${
                                          checked
                                            ? styles.selectButtonActive
                                            : ""
                                        }`}
                                        aria-hidden="true"
                                      >
                                        {checked
                                          ? "Selectat ✓"
                                          : "Selectează"}
                                      </span>
                                    </label>
                                  );
                                }
                              )}
                            </div>

                            <button
                              type="button"
                              className={
                                styles.aiPrimaryButton
                              }
                              disabled={
                                aiAdding ||
                                !aiSelectedIds.length
                              }
                              onClick={
                                addAiSelectedProducts
                              }
                            >
                              {aiAdding
                                ? "Se adaugă produsele…"
                                : `Adaugă ${aiSelectedIds.length} ${
                                    aiSelectedIds.length ===
                                    1
                                      ? "produs"
                                      : "produse"
                                  } în colecție`}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </section>

                  {/* PRODUSE SELECTATE */}

                  <section
                    className={
                      styles.sectionCard
                    }
                  >
                    <div
                      className={
                        styles.sectionCardHeader
                      }
                    >
                      <span
                        className={
                          styles.sectionBadge
                        }
                      >
                        3
                      </span>

                      <div>
                        <h3
                          className={
                            styles.sectionTitle
                          }
                        >
                          Produse selectate (
                          {selectedCollection
                            .items
                            ?.length ||
                            0}
                          )
                        </h3>

                        <p
                          className={
                            styles.sectionSubtitle
                          }
                        >
                          {selectedCollection
                            .items
                            ?.length ||
                            0}
                          {" "}
                          din maximum{" "}
                          {
                            MAX_COLLECTION_PRODUCTS
                          }
                        </p>
                      </div>
                    </div>

                    {errorField ===
                      "products" &&
                      error && (
                        <div
                          className={
                            styles.errorBox
                          }
                          role="alert"
                          aria-live="polite"
                        >
                          {error}
                        </div>
                      )}

                    {!selectedCollection
                      .items?.length ? (
                      <div
                        className={
                          styles.emptyProducts
                        }
                      >
                        Colecția nu are încă produse. Folosește AI sau caută manual mai sus.
                      </div>
                    ) : (
                      <div
                        className={
                          styles.selectedList
                        }
                      >
                        {selectedCollection.items.map(
                          (
                            item,
                            index
                          ) => {
                            const unavailable =
                              item.product &&
                              (item.product
                                .isActive ===
                                false ||
                                item.product
                                  .isHidden ===
                                  true ||
                                item.product
                                  .availability ===
                                  "SOLD_OUT");

                            return (
                            <div
                              key={
                                item.productId
                              }
                              className={
                                styles.selectedRow
                              }
                            >
                              <ProductThumb
                                product={
                                  item.product
                                }
                              />

                              <div
                                className={
                                  styles.productCardBody
                                }
                              >
                                <strong
                                  className={
                                    styles.productTitle
                                  }
                                >
                                  {item
                                    .product
                                    ?.title ||
                                    "Produs"}
                                </strong>

                                <div
                                  className={
                                    styles.productMetaRow
                                  }
                                >
                                  <b
                                    className={
                                      styles.productPrice
                                    }
                                  >
                                    {formatPriceCents(
                                      item
                                        .product
                                        ?.priceCents,
                                      item
                                        .product
                                        ?.currency
                                    )}
                                  </b>

                                  {item
                                    .product
                                    ?.service
                                    ?.vendor
                                    ?.displayName && (
                                    <span
                                      className={
                                        styles.productVendor
                                      }
                                    >
                                      {
                                        item
                                          .product
                                          .service
                                          .vendor
                                          .displayName
                                      }
                                    </span>
                                  )}
                                </div>

                                {(!item.product ||
                                  unavailable) && (
                                  <span
                                    className={
                                      styles.unavailableBadge
                                    }
                                  >
                                    {!item.product
                                      ? "Produs indisponibil"
                                      : "Momentan indisponibil"}
                                  </span>
                                )}
                              </div>

                              <div
                                className={
                                  styles.selectedRowActions
                                }
                              >
                                <button
                                  type="button"
                                  className={
                                    styles.iconButton
                                  }
                                  aria-label={`Mută ${
                                    item.product
                                      ?.title ||
                                    "produsul"
                                  } mai sus`}
                                  disabled={
                                    index ===
                                      0 ||
                                    reorderBusy
                                  }
                                  onClick={() =>
                                    moveProduct(
                                      index,
                                      -1
                                    )
                                  }
                                >
                                  ↑
                                </button>

                                <button
                                  type="button"
                                  className={
                                    styles.iconButton
                                  }
                                  aria-label={`Mută ${
                                    item.product
                                      ?.title ||
                                    "produsul"
                                  } mai jos`}
                                  disabled={
                                    index ===
                                      selectedCollection
                                        .items
                                        .length -
                                        1 ||
                                    reorderBusy
                                  }
                                  onClick={() =>
                                    moveProduct(
                                      index,
                                      1
                                    )
                                  }
                                >
                                  ↓
                                </button>

                                <button
                                  type="button"
                                  className={`${styles.iconButton} ${styles.iconButtonDanger}`}
                                  aria-label={`Elimină ${
                                    item.product
                                      ?.title ||
                                    "produsul"
                                  } din colecție`}
                                  disabled={
                                    productBusyId ===
                                    item.productId
                                  }
                                  onClick={() =>
                                    removeProduct(
                                      item.productId
                                    )
                                  }
                                >
                                  {productBusyId ===
                                  item.productId
                                    ? "…"
                                    : "🗑"}
                                </button>
                              </div>
                            </div>
                            );
                          }
                        )}
                      </div>
                    )}
                  </section>
                </>
              ) : null}
            </section>
          </div>
          )}
        </div>

        <footer
          className={
            styles.footer
          }
        >
          <button
            type="button"
            className={
              styles.footerCancelButton
            }
            onClick={
              onClose
            }
          >
            Închide
          </button>

          <button
            type="submit"
            form={
              CREATE_COLLECTION_FORM_ID
            }
            className={
              styles.footerPrimaryButton
            }
            disabled={
              saving
            }
          >
            {saving
              ? "Se creează colecția…"
              : "Creează colecția"}
          </button>
        </footer>
      </div>
    </div>
  );
}

/* =========================================================
   PRODUCT THUMB
========================================================= */

function ProductThumb({
  product,
}) {
  const src =
    product?.images?.[0];

  return (
    <div
      className={
        styles.productThumb
      }
    >
      {src ? (
        <img
          src={
            src
          }
          alt={
            product?.title ||
            ""
          }
        />
      ) : (
        <span>
          🛍️
        </span>
      )}
    </div>
  );
}

/* =========================================================
   PRICE
========================================================= */

function formatPriceCents(
  value,
  currency = "RON"
) {
  return new Intl.NumberFormat(
    "ro-RO",
    {
      style:
        "currency",

      currency:
        currency ||
        "RON",

      minimumFractionDigits:
        2,
    }
  ).format(
    Number(
      value || 0
    ) / 100
  );
}