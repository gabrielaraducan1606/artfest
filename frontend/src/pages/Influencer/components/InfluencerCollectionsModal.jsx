import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { api } from "../../../lib/api.js";

import styles from "./InfluencerCollectionsModal.module.css";

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

  const [
    error,
    setError,
  ] = useState("");

  const [
    success,
    setSuccess,
  ] = useState("");

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

  /* =========================================================
     AI
  ========================================================= */

  const [
    aiOpen,
    setAiOpen,
  ] = useState(false);

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
  ========================================================= */

  useEffect(() => {
    const previous =
      document.body.style
        .overflow;

    document.body.style.overflow =
      "hidden";

    function onKeyDown(
      event
    ) {
      if (
        event.key ===
        "Escape"
      ) {
        onClose?.();
      }
    }

    document.addEventListener(
      "keydown",
      onKeyDown
    );

    return () => {
      document.body.style.overflow =
        previous;

      document.removeEventListener(
        "keydown",
        onKeyDown
      );
    };
  }, [onClose]);

  /* =========================================================
     COLLECTIONS
  ========================================================= */

  const loadCollections =
    useCallback(
      async () => {
        setLoading(true);
        setError("");

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
          setError(
            err?.data?.message ||
              err?.message ||
              "Nu am putut încărca colecțiile."
          );
        } finally {
          setLoading(false);
        }
      },
      []
    );

  useEffect(() => {
    loadCollections();
  }, [loadCollections]);

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
        setError("");

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
          setError(
            err?.data?.message ||
              err?.message ||
              "Nu am putut încărca această colecție."
          );
        } finally {
          setDetailLoading(false);
        }
      },
      []
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
    setAiOpen(false);
    setAiPrompt("");
    setAiBudgetMin("");
    setAiBudgetMax("");
    setAiLimit(12);
    setAiRecommendations([]);
    setAiSelectedIds([]);

    setProductSearch("");
    setProductSuggestions([]);
  }, [selectedId]);

  /* =========================================================
     CREATE
  ========================================================= */

  async function createCollection(
    event
  ) {
    event.preventDefault();

    const cleanTitle =
      title.trim();

    if (
      cleanTitle.length < 2
    ) {
      setError(
        "Scrie un nume pentru colecție."
      );

      return;
    }

    setSaving(true);
    setError("");
    setSuccess("");

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
                description.trim() ||
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

      setSuccess(
        "Colecția a fost creată."
      );
    } catch (err) {
      setError(
        err?.data?.message ||
          err?.message ||
          "Nu am putut crea colecția."
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

    setError("");
    setSuccess("");

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

      setSuccess(
        "Colecția a fost ștearsă."
      );
    } catch (err) {
      setError(
        err?.data?.message ||
          err?.message ||
          "Nu am putut șterge colecția."
      );
    }
  }

  /* =========================================================
     PUBLIC / HIDDEN
  ========================================================= */

  async function toggleCollection(
    collection
  ) {
    setError("");
    setSuccess("");

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
      setError(
        err?.data?.message ||
          err?.message ||
          "Nu am putut actualiza colecția."
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

    const url =
      `${window.location.origin}/selectii/${collection.slug}`;

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
      setError(
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

            const response =
              await fetch(
                `/api/public/products/suggest?q=${encodeURIComponent(
                  term
                )}`,
                {
                  signal:
                    controller.signal,
                }
              );

            if (
              !response.ok
            ) {
              throw new Error(
                "product_search_failed"
              );
            }

            const data =
              await response.json();

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
      setError(
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
      setError(
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
      setError(
        "Bugetul maxim nu este valid."
      );

      return;
    }

    if (
      min !== null &&
      max !== null &&
      min > max
    ) {
      setError(
        "Bugetul minim nu poate fi mai mare decât bugetul maxim."
      );

      return;
    }

    setAiLoading(true);
    setError("");
    setSuccess("");
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
        setError(
          "AI-ul nu a găsit momentan produse potrivite pentru această selecție."
        );
      }
    } catch (err) {
      setError(
        err?.data?.message ||
          err?.message ||
          "AI-ul nu a putut genera recomandările."
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
    if (
      !selectedCollection?.id ||
      !aiSelectedIds.length
    ) {
      return;
    }

    setAiAdding(true);
    setError("");
    setSuccess("");

    try {
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

      setSuccess(
        "Produsele selectate au fost adăugate în colecție."
      );
    } catch (err) {
      setError(
        err?.data?.message ||
          err?.message ||
          "Nu am putut adăuga produsele recomandate."
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

    setError("");

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
      setError(
        err?.data?.message ||
          err?.message ||
          "Nu am putut adăuga produsul."
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

    setError("");

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
      setError(
        err?.data?.message ||
          err?.message ||
          "Nu am putut elimina produsul."
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
      setError(
        err?.data?.message ||
          err?.message ||
          "Nu am putut schimba ordinea produselor."
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
        className={
          styles.modal
        }
        onMouseDown={(event) =>
          event.stopPropagation()
        }
      >
        <header
          className={
            styles.header
          }
        >
          <div>
            <div
              className={
                styles.eyebrow
              }
            >
              PROMOVARE
            </div>

            <h2>
              Colecțiile mele
            </h2>

            <p>
              Creează selecții de produse și distribuie-le comunității tale.
            </p>
          </div>

          <button
            type="button"
            className={
              styles.secondaryButton
            }
            onClick={
              onClose
            }
          >
            Închide
          </button>
        </header>

        {error && (
          <div
            className={
              styles.errorBox
            }
          >
            {error}
          </div>
        )}

        {success && (
          <div
            className={
              styles.successBox
            }
          >
            {success}
          </div>
        )}

        {/* CREATE */}

        <form
          onSubmit={
            createCollection
          }
          className={
            styles.createBox
          }
        >
          <strong>
            Colecție nouă
          </strong>

          <input
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
              160
            }
          />

          <textarea
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
              3
            }
          />

          <button
            type="submit"
            className={
              styles.primaryButton
            }
            disabled={
              saving
            }
          >
            {saving
              ? "Se creează…"
              : "Creează colecția"}
          </button>
        </form>

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

                  {/* AI */}

                  <div
                    className={
                      styles.aiBox
                    }
                  >
                    <div
                      className={
                        styles.aiHeader
                      }
                    >
                      <div>
                        <strong>
                          ✨ Alege produse cu AI
                        </strong>

                        <p>
                          Spune ce fel de selecție vrei, iar AI-ul îți recomandă produse reale din Artfest. Tu alegi ce adaugi.
                        </p>
                      </div>

                      <button
                        type="button"
                        className={
                          styles.secondaryButton
                        }
                        onClick={() =>
                          setAiOpen(
                            (
                              current
                            ) =>
                              !current
                          )
                        }
                      >
                        {aiOpen
                          ? "Închide AI"
                          : "Folosește AI"}
                      </button>
                    </div>

                    {aiOpen && (
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
                          <span>
                            Ce fel de produse cauți?
                          </span>

                          <textarea
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
                              "Cadouri elegante pentru profesoare"
                            }`}
                          />

                          <small>
                            Dacă îl lași gol, AI-ul folosește automat titlul și descrierea colecției.
                          </small>
                        </label>

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
                            <span>
                              Buget minim
                            </span>

                            <input
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
                            <span>
                              Buget maxim
                            </span>

                            <input
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
                            <span>
                              Sugestii
                            </span>

                            <select
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

                        <button
                          type="button"
                          className={
                            styles.primaryButton
                          }
                          disabled={
                            aiLoading
                          }
                          onClick={
                            loadAiRecommendations
                          }
                        >
                          {aiLoading
                            ? "AI caută produse…"
                            : "✨ Găsește produse potrivite"}
                        </button>
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
                            styles.aiList
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
                                  className={`${styles.aiItem} ${
                                    checked
                                      ? styles.aiItemSelected
                                      : ""
                                  }`}
                                >
                                  <input
                                    type="checkbox"
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

                                  <ProductThumb
                                    product={
                                      product
                                    }
                                  />

                                  <div
                                    className={
                                      styles.productMeta
                                    }
                                  >
                                    <strong>
                                      {product?.title ||
                                        "Produs"}
                                    </strong>

                                    <b>
                                      {formatPriceCents(
                                        product?.priceCents,
                                        product?.currency
                                      )}
                                    </b>

                                    {product
                                      ?.service
                                      ?.vendor
                                      ?.displayName && (
                                      <span>
                                        {
                                          product
                                            .service
                                            .vendor
                                            .displayName
                                        }
                                      </span>
                                    )}

                                    {recommendation.reason && (
                                      <p>
                                        <strong>
                                          De ce îl recomandă AI:
                                        </strong>{" "}
                                        {
                                          recommendation.reason
                                        }
                                      </p>
                                    )}
                                  </div>
                                </label>
                              );
                            }
                          )}
                        </div>

                        <button
                          type="button"
                          className={
                            styles.primaryButton
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

                  {/* MANUAL */}

                  <div
                    className={
                      styles.manualLabel
                    }
                  >
                    Sau caută manual
                  </div>

                  <div
                    className={
                      styles.searchWrap
                    }
                  >
                    <input
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
                    />

                    {productSearchLoading && (
                      <div
                        className={
                          styles.searchStatus
                        }
                      >
                        Se caută…
                      </div>
                    )}

                    {productSuggestions.length >
                      0 && (
                      <div
                        className={
                          styles.suggestions
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
                                styles.suggestion
                              }
                            >
                              <ProductThumb
                                product={
                                  product
                                }
                              />

                              <div
                                className={
                                  styles.productMeta
                                }
                              >
                                <strong>
                                  {
                                    product.title
                                  }
                                </strong>

                                <span>
                                  {formatPriceCents(
                                    product.priceCents,
                                    product.currency
                                  )}
                                </span>
                              </div>

                              <button
                                type="button"
                                className={
                                  styles.primaryButton
                                }
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
                                  ? "..."
                                  : "Adaugă"}
                              </button>
                            </div>
                          )
                        )}
                      </div>
                    )}
                  </div>

                  {/* PRODUCTS */}

                  {!selectedCollection
                    .items?.length ? (
                    <div
                      className={
                        styles.emptyProducts
                      }
                    >
                      Colecția nu are încă produse.
                    </div>
                  ) : (
                    <div
                      className={
                        styles.productList
                      }
                    >
                      {selectedCollection.items.map(
                        (
                          item,
                          index
                        ) => (
                          <div
                            key={
                              item.productId
                            }
                            className={
                              styles.productRow
                            }
                          >
                            <ProductThumb
                              product={
                                item.product
                              }
                            />

                            <div
                              className={
                                styles.productMeta
                              }
                            >
                              <strong>
                                {item
                                  .product
                                  ?.title ||
                                  "Produs"}
                              </strong>

                              <span>
                                {item
                                  .product
                                  ?.service
                                  ?.vendor
                                  ?.displayName ||
                                  ""}
                              </span>

                              <b>
                                {formatPriceCents(
                                  item
                                    .product
                                    ?.priceCents,
                                  item
                                    .product
                                    ?.currency
                                )}
                              </b>
                            </div>

                            <div
                              className={
                                styles.productActions
                              }
                            >
                              <button
                                type="button"
                                className={
                                  styles.secondaryButton
                                }
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
                                  styles.secondaryButton
                                }
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
                                className={`${styles.secondaryButton} ${styles.dangerText}`}
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
                                  ? "..."
                                  : "Elimină"}
                              </button>
                            </div>
                          </div>
                        )
                      )}
                    </div>
                  )}
                </>
              ) : null}
            </section>
          </div>
        )}
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