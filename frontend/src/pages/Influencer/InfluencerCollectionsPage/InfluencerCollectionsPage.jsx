import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Link2,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";

import { useNavigate } from "react-router-dom";

import { api } from "../../lib/api.js";

import styles from "./InfluencerCollectionsPage.module.css";

const EMPTY_FORM = {
  title: "",
  description: "",
  coverImage: "",
  isActive: true,
};

export default function InfluencerCollectionsPage() {
  const navigate =
    useNavigate();

  const [collections, setCollections] =
    useState([]);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  const [success, setSuccess] =
    useState("");

  const [createOpen, setCreateOpen] =
    useState(false);

  const [form, setForm] =
    useState(EMPTY_FORM);

  const [saving, setSaving] =
    useState(false);

  const [
    selectedCollectionId,
    setSelectedCollectionId,
  ] = useState(null);

  const [
    selectedCollection,
    setSelectedCollection,
  ] = useState(null);

  const [detailLoading, setDetailLoading] =
    useState(false);

  const [editMode, setEditMode] =
    useState(false);

  const [editForm, setEditForm] =
    useState(EMPTY_FORM);

  const [deleteBusy, setDeleteBusy] =
    useState(false);

  const [copyId, setCopyId] =
    useState("");

  /* =========================================================
     LOAD COLLECTIONS
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
          console.error(
            "loadCollections error:",
            err
          );

          setError(
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
     LOAD COLLECTION DETAIL
  ========================================================= */

  const loadCollection =
    useCallback(
      async (collectionId) => {
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

          const collection =
            data?.collection ||
            null;

          setSelectedCollection(
            collection
          );

          if (collection) {
            setEditForm({
              title:
                collection.title ||
                "",

              description:
                collection.description ||
                "",

              coverImage:
                collection.coverImage ||
                "",

              isActive:
                collection.isActive !==
                false,
            });
          }
        } catch (err) {
          console.error(
            "loadCollection error:",
            err
          );

          setError(
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
    if (
      selectedCollectionId
    ) {
      loadCollection(
        selectedCollectionId
      );
    } else {
      setSelectedCollection(
        null
      );
    }
  }, [
    selectedCollectionId,
    loadCollection,
  ]);

  /* =========================================================
     CREATE
  ========================================================= */

  async function createCollection(
    event
  ) {
    event.preventDefault();

    const title =
      form.title.trim();

    if (title.length < 2) {
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
            method: "POST",

            body: {
              title,

              description:
                form.description.trim() ||
                null,

              coverImage:
                form.coverImage.trim() ||
                null,

              isActive:
                form.isActive,
            },
          }
        );

      const created =
        data?.collection;

      setForm(
        EMPTY_FORM
      );

      setCreateOpen(
        false
      );

      await loadCollections();

      if (created?.id) {
        setSelectedCollectionId(
          created.id
        );
      }

      setSuccess(
        "Colecția a fost creată."
      );
    } catch (err) {
      console.error(
        "createCollection error:",
        err
      );

      setError(
        err?.message ||
          "Nu am putut crea colecția."
      );
    } finally {
      setSaving(false);
    }
  }

  /* =========================================================
     UPDATE
  ========================================================= */

  async function updateCollection(
    event
  ) {
    event.preventDefault();

    if (
      !selectedCollection?.id
    ) {
      return;
    }

    const title =
      editForm.title.trim();

    if (title.length < 2) {
      setError(
        "Titlul trebuie să aibă minimum 2 caractere."
      );
      return;
    }

    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const data =
        await api(
          `/api/influencer/collections/${selectedCollection.id}`,
          {
            method:
              "PATCH",

            body: {
              title,

              description:
                editForm.description.trim() ||
                null,

              coverImage:
                editForm.coverImage.trim() ||
                null,

              isActive:
                editForm.isActive,
            },
          }
        );

      const updated =
        data?.collection;

      setSelectedCollection(
        (current) => ({
          ...current,
          ...updated,
        })
      );

      setEditMode(
        false
      );

      await loadCollections();

      setSuccess(
        "Colecția a fost actualizată."
      );
    } catch (err) {
      console.error(
        "updateCollection error:",
        err
      );

      setError(
        err?.message ||
          "Nu am putut salva modificările."
      );
    } finally {
      setSaving(false);
    }
  }

  /* =========================================================
     TOGGLE ACTIVE
  ========================================================= */

  async function toggleActive(
    collection
  ) {
    if (!collection?.id) {
      return;
    }

    setError("");

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
        selectedCollection?.id ===
        collection.id
      ) {
        await loadCollection(
          collection.id
        );
      }
    } catch (err) {
      setError(
        err?.message ||
          "Nu am putut modifica vizibilitatea."
      );
    }
  }

  /* =========================================================
     DELETE
  ========================================================= */

  async function deleteCollection() {
    if (
      !selectedCollection?.id
    ) {
      return;
    }

    const confirmed =
      window.confirm(
        `Ștergi colecția „${selectedCollection.title}”? Produsele nu vor fi șterse din Artfest.`
      );

    if (!confirmed) {
      return;
    }

    setDeleteBusy(true);
    setError("");

    try {
      await api(
        `/api/influencer/collections/${selectedCollection.id}`,
        {
          method:
            "DELETE",
        }
      );

      setSelectedCollectionId(
        null
      );

      setSelectedCollection(
        null
      );

      await loadCollections();

      setSuccess(
        "Colecția a fost ștearsă."
      );
    } catch (err) {
      setError(
        err?.message ||
          "Nu am putut șterge colecția."
      );
    } finally {
      setDeleteBusy(false);
    }
  }

  /* =========================================================
     PUBLIC URL
  ========================================================= */

  function publicUrl(
    collection
  ) {
    if (!collection?.slug) {
      return "";
    }

    return `${window.location.origin}/colectii/${collection.slug}`;
  }

  async function copyLink(
    collection
  ) {
    const url =
      publicUrl(
        collection
      );

    if (!url) {
      return;
    }

    try {
      await navigator.clipboard.writeText(
        url
      );

      setCopyId(
        collection.id
      );

      window.setTimeout(
        () =>
          setCopyId(
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
     UI
  ========================================================= */

  if (loading) {
    return (
      <main
        className={
          styles.page
        }
      >
        <div
          className={
            styles.centerState
          }
        >
          <Loader2
            size={28}
            className={
              styles.spinner
            }
          />

          <span>
            Se încarcă colecțiile…
          </span>
        </div>
      </main>
    );
  }

  return (
    <main
      className={
        styles.page
      }
    >
      <div
        className={
          styles.shell
        }
      >
        {/* HEADER */}

        <div
          className={
            styles.topBar
          }
        >
          <div
            className={
              styles.headingWrap
            }
          >
            <button
              type="button"
              className={
                styles.backButton
              }
              onClick={() =>
                navigate(
                  "/influencer"
                )
              }
            >
              <ArrowLeft
                size={18}
              />

              Dashboard
            </button>

            <h1
              className={
                styles.title
              }
            >
              Colecțiile mele
            </h1>

            <p
              className={
                styles.subtitle
              }
            >
              Creează selecții de produse Artfest și distribuie-le comunității tale.
            </p>
          </div>

          <button
            type="button"
            className={
              styles.primaryButton
            }
            onClick={() => {
              setForm(
                EMPTY_FORM
              );
              setCreateOpen(
                true
              );
            }}
          >
            <Plus
              size={18}
            />
            Colecție nouă
          </button>
        </div>

        {error && (
          <div
            className={
              styles.errorBox
            }
          >
            {error}

            <button
              type="button"
              onClick={() =>
                setError(
                  ""
                )
              }
            >
              <X
                size={16}
              />
            </button>
          </div>
        )}

        {success && (
          <div
            className={
              styles.successBox
            }
          >
            <Check
              size={18}
            />

            {success}

            <button
              type="button"
              onClick={() =>
                setSuccess(
                  ""
                )
              }
            >
              <X
                size={16}
              />
            </button>
          </div>
        )}

        {/* EMPTY */}

        {!collections.length ? (
          <section
            className={
              styles.emptyCard
            }
          >
            <div
              className={
                styles.emptyIcon
              }
            >
              ✦
            </div>

            <h2>
              Creează prima ta colecție
            </h2>

            <p>
              Poți grupa produse Artfest într-o selecție proprie și distribui apoi un singur link.
            </p>

            <button
              type="button"
              className={
                styles.primaryButton
              }
              onClick={() =>
                setCreateOpen(
                  true
                )
              }
            >
              <Plus
                size={18}
              />

              Creează colecție
            </button>
          </section>
        ) : (
          <div
            className={
              styles.layout
            }
          >
            {/* COLLECTION LIST */}

            <aside
              className={
                styles.collectionList
              }
            >
              <div
                className={
                  styles.sectionHeader
                }
              >
                <div>
                  <h2>
                    Colecții
                  </h2>

                  <span>
                    {
                      collections.length
                    }{" "}
                    {collections.length ===
                    1
                      ? "colecție"
                      : "colecții"}
                  </span>
                </div>
              </div>

              <div
                className={
                  styles.collectionCards
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
                        selectedCollectionId ===
                        collection.id
                          ? styles.collectionCardActive
                          : ""
                      }`}
                      onClick={() =>
                        setSelectedCollectionId(
                          collection.id
                        )
                      }
                    >
                      <div
                        className={
                          styles.collectionThumb
                        }
                      >
                        {collection.coverImage ? (
                          <img
                            src={
                              collection.coverImage
                            }
                            alt=""
                          />
                        ) : (
                          <span>
                            ✦
                          </span>
                        )}
                      </div>

                      <div
                        className={
                          styles.collectionCardBody
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
                          <span>
                            {collection.productsCount ||
                              0}{" "}
                            produse
                          </span>

                          <span>
                            {collection.visits ||
                              0}{" "}
                            vizite
                          </span>
                        </div>
                      </div>
                    </button>
                  )
                )}
              </div>
            </aside>

            {/* DETAIL */}

            <section
              className={
                styles.detailPanel
              }
            >
              {!selectedCollectionId ? (
                <div
                  className={
                    styles.selectState
                  }
                >
                  <div>
                    ✦
                  </div>

                  <h2>
                    Selectează o colecție
                  </h2>

                  <p>
                    De aici o poți edita, poți adăuga produse și poți copia linkul public.
                  </p>
                </div>
              ) : detailLoading ? (
                <div
                  className={
                    styles.centerState
                  }
                >
                  <Loader2
                    size={26}
                    className={
                      styles.spinner
                    }
                  />

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
                      <div
                        className={
                          styles.detailStatus
                        }
                      >
                        {selectedCollection.isActive ? (
                          <>
                            <Eye
                              size={15}
                            />
                            Colecție publică
                          </>
                        ) : (
                          <>
                            <EyeOff
                              size={15}
                            />
                            Colecție ascunsă
                          </>
                        )}
                      </div>

                      <h2>
                        {
                          selectedCollection.title
                        }
                      </h2>

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
                        styles.headerActions
                      }
                    >
                      <button
                        type="button"
                        className={
                          styles.iconTextButton
                        }
                        onClick={() =>
                          toggleActive(
                            selectedCollection
                          )
                        }
                      >
                        {selectedCollection.isActive ? (
                          <EyeOff
                            size={17}
                          />
                        ) : (
                          <Eye
                            size={17}
                          />
                        )}

                        {selectedCollection.isActive
                          ? "Ascunde"
                          : "Publică"}
                      </button>

                      <button
                        type="button"
                        className={
                          styles.iconTextButton
                        }
                        onClick={() =>
                          setEditMode(
                            true
                          )
                        }
                      >
                        <Pencil
                          size={17}
                        />
                        Editează
                      </button>
                    </div>
                  </div>

                  {/* SHARE */}

                  <div
                    className={
                      styles.shareBox
                    }
                  >
                    <div
                      className={
                        styles.shareIcon
                      }
                    >
                      <Link2
                        size={20}
                      />
                    </div>

                    <div
                      className={
                        styles.shareContent
                      }
                    >
                      <span>
                        Link public
                      </span>

                      <strong>
                        {publicUrl(
                          selectedCollection
                        )}
                      </strong>
                    </div>

                    <button
                      type="button"
                      className={
                        styles.copyButton
                      }
                      onClick={() =>
                        copyLink(
                          selectedCollection
                        )
                      }
                    >
                      {copyId ===
                      selectedCollection.id ? (
                        <>
                          <Check
                            size={16}
                          />
                          Copiat
                        </>
                      ) : (
                        <>
                          <Copy
                            size={16}
                          />
                          Copiază
                        </>
                      )}
                    </button>

                    {selectedCollection.isActive && (
                      <a
                        href={publicUrl(
                          selectedCollection
                        )}
                        target="_blank"
                        rel="noreferrer"
                        className={
                          styles.openButton
                        }
                      >
                        <ExternalLink
                          size={16}
                        />
                      </a>
                    )}
                  </div>

                  {/* STATS */}

                  <div
                    className={
                      styles.statsGrid
                    }
                  >
                    <MiniStat
                      label="Produse"
                      value={
                        selectedCollection
                          .items
                          ?.length ||
                        0
                      }
                    />

                    <MiniStat
                      label="Vizite"
                      value={
                        selectedCollection.visits ||
                        0
                      }
                    />

                    <MiniStat
                      label="Clickuri"
                      value={
                        selectedCollection.clicks ||
                        0
                      }
                    />
                  </div>

                  {/* PRODUCTS */}

                  <CollectionProducts
                    collection={
                      selectedCollection
                    }
                    onChanged={async () => {
                      await loadCollection(
                        selectedCollection.id
                      );

                      await loadCollections();
                    }}
                    onError={
                      setError
                    }
                  />

                  {/* DELETE */}

                  <div
                    className={
                      styles.dangerZone
                    }
                  >
                    <div>
                      <strong>
                        Șterge colecția
                      </strong>

                      <p>
                        Produsele rămân în Artfest. Se șterge doar selecția ta.
                      </p>
                    </div>

                    <button
                      type="button"
                      className={
                        styles.dangerButton
                      }
                      disabled={
                        deleteBusy
                      }
                      onClick={
                        deleteCollection
                      }
                    >
                      <Trash2
                        size={17}
                      />

                      {deleteBusy
                        ? "Se șterge…"
                        : "Șterge"}
                    </button>
                  </div>
                </>
              ) : null}
            </section>
          </div>
        )}
      </div>

      {/* CREATE MODAL */}

      {createOpen && (
        <Modal
          title="Colecție nouă"
          onClose={() =>
            !saving &&
            setCreateOpen(
              false
            )
          }
        >
          <CollectionForm
            form={
              form
            }
            setForm={
              setForm
            }
            saving={
              saving
            }
            submitLabel="Creează colecția"
            onSubmit={
              createCollection
            }
          />
        </Modal>
      )}

      {/* EDIT MODAL */}

      {editMode &&
        selectedCollection && (
          <Modal
            title="Editează colecția"
            onClose={() =>
              !saving &&
              setEditMode(
                false
              )
            }
          >
            <CollectionForm
              form={
                editForm
              }
              setForm={
                setEditForm
              }
              saving={
                saving
              }
              submitLabel="Salvează modificările"
              onSubmit={
                updateCollection
              }
            />
          </Modal>
        )}
    </main>
  );
}

/* =========================================================
   COLLECTION PRODUCTS
========================================================= */

function CollectionProducts({
  collection,
  onChanged,
  onError,
}) {
  const [search, setSearch] =
    useState("");

  const [
    suggestions,
    setSuggestions,
  ] = useState([]);

  const [
    searchLoading,
    setSearchLoading,
  ] = useState(false);

  const [busyId, setBusyId] =
    useState("");

  const [
    reorderBusy,
    setReorderBusy,
  ] = useState(false);

  /* =========================================================
     AI RECOMMENDATIONS
  ========================================================= */

  const [aiOpen, setAiOpen] =
    useState(false);

  const [aiPrompt, setAiPrompt] =
    useState("");

  const [
    aiBudgetMin,
    setAiBudgetMin,
  ] = useState("");

  const [
    aiBudgetMax,
    setAiBudgetMax,
  ] = useState("");

  const [aiLimit, setAiLimit] =
    useState(12);

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

  const existingIds =
    useMemo(
      () =>
        new Set(
          (
            collection?.items ||
            []
          ).map(
            (item) =>
              item.productId
          )
        ),
      [collection?.items]
    );

  /* =========================================================
     RESET AI WHEN COLLECTION CHANGES
  ========================================================= */

  useEffect(() => {
    setAiOpen(false);
    setAiPrompt("");
    setAiBudgetMin("");
    setAiBudgetMax("");
    setAiLimit(12);
    setAiRecommendations([]);
    setAiSelectedIds([]);
  }, [collection?.id]);

  /* =========================================================
     SEARCH PRODUCTS MANUALLY
  ========================================================= */

  useEffect(() => {
    const term =
      search.trim();

    if (
      term.length < 2
    ) {
      setSuggestions(
        []
      );

      setSearchLoading(
        false
      );

      return;
    }

    const controller =
      new AbortController();

    const timeout =
      window.setTimeout(
        async () => {
          try {
            setSearchLoading(
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
                "search_failed"
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

            setSuggestions(
              products.filter(
                (product) =>
                  !existingIds.has(
                    product.id
                  )
              )
            );
          } catch (err) {
            if (
              err?.name !==
              "AbortError"
            ) {
              setSuggestions(
                []
              );
            }
          } finally {
            if (
              !controller.signal
                .aborted
            ) {
              setSearchLoading(
                false
              );
            }
          }
        },
        250
      );

    return () => {
      window.clearTimeout(
        timeout
      );

      controller.abort();
    };
  }, [
    search,
    existingIds,
  ]);

  /* =========================================================
     AI - GET RECOMMENDATIONS
  ========================================================= */

  async function loadAiRecommendations() {
    if (!collection?.id) {
      return;
    }

    const prompt =
      aiPrompt.trim() ||
      collection.description?.trim() ||
      collection.title?.trim();

    if (!prompt) {
      onError?.(
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
      (!Number.isFinite(
        min
      ) ||
        min < 0)
    ) {
      onError?.(
        "Bugetul minim nu este valid."
      );

      return;
    }

    if (
      max !== null &&
      (!Number.isFinite(
        max
      ) ||
        max < 0)
    ) {
      onError?.(
        "Bugetul maxim nu este valid."
      );

      return;
    }

    if (
      min !== null &&
      max !== null &&
      min > max
    ) {
      onError?.(
        "Bugetul minim nu poate fi mai mare decât bugetul maxim."
      );

      return;
    }

    setAiLoading(true);
    setAiRecommendations([]);
    setAiSelectedIds([]);

    try {
      const data =
        await api(
          "/api/influencer/collections/ai-recommend",
          {
            method:
              "POST",

            body: {
              collectionId:
                collection.id,

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
          data?.recommendations
        )
          ? data.recommendations
          : [];

      const filtered =
        recommendations.filter(
          (item) =>
            item?.productId &&
            !existingIds.has(
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
        onError?.(
          "AI-ul nu a găsit momentan produse potrivite pentru această selecție."
        );
      }
    } catch (err) {
      onError?.(
        err?.data?.message ||
          err?.message ||
          "AI-ul nu a putut genera recomandările."
      );
    } finally {
      setAiLoading(false);
    }
  }

  /* =========================================================
     AI - TOGGLE ONE RESULT
  ========================================================= */

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
            id !==
            productId
        );
      }
    );
  }

  /* =========================================================
     AI - ADD SELECTED
  ========================================================= */

  async function addAiSelectedProducts() {
    if (
      !collection?.id ||
      !aiSelectedIds.length
    ) {
      return;
    }

    setAiAdding(true);

    try {
      await api(
        `/api/influencer/collections/${collection.id}/products`,
        {
          method:
            "POST",

          body: {
            productIds:
              aiSelectedIds,
          },
        }
      );

      setAiRecommendations([]);
      setAiSelectedIds([]);
      setAiPrompt("");
      setAiBudgetMin("");
      setAiBudgetMax("");

      await onChanged?.();
    } catch (err) {
      onError?.(
        err?.data?.message ||
          err?.message ||
          "Nu am putut adăuga produsele recomandate."
      );
    } finally {
      setAiAdding(false);
    }
  }

  /* =========================================================
     ADD ONE PRODUCT MANUALLY
  ========================================================= */

  async function addProduct(
    product
  ) {
    if (
      !collection?.id ||
      !product?.id
    ) {
      return;
    }

    setBusyId(
      product.id
    );

    try {
      await api(
        `/api/influencer/collections/${collection.id}/products`,
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

      setSearch(
        ""
      );

      setSuggestions(
        []
      );

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

      await onChanged?.();
    } catch (err) {
      onError?.(
        err?.data?.message ||
          err?.message ||
          "Nu am putut adăuga produsul."
      );
    } finally {
      setBusyId(
        ""
      );
    }
  }

  /* =========================================================
     REMOVE PRODUCT
  ========================================================= */

  async function removeProduct(
    productId
  ) {
    setBusyId(
      productId
    );

    try {
      await api(
        `/api/influencer/collections/${collection.id}/products/${productId}`,
        {
          method:
            "DELETE",
        }
      );

      await onChanged?.();
    } catch (err) {
      onError?.(
        err?.data?.message ||
          err?.message ||
          "Nu am putut elimina produsul."
      );
    } finally {
      setBusyId(
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
    const items = [
      ...(collection.items ||
        []),
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

    setReorderBusy(
      true
    );

    try {
      await api(
        `/api/influencer/collections/${collection.id}/products/reorder`,
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

      await onChanged?.();
    } catch (err) {
      onError?.(
        err?.data?.message ||
          err?.message ||
          "Nu am putut schimba ordinea produselor."
      );
    } finally {
      setReorderBusy(
        false
      );
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
     UI
  ========================================================= */

  return (
    <section
      className={
        styles.productsSection
      }
    >
      <div
        className={
          styles.productsHeader
        }
      >
        <div>
          <h3>
            Produsele colecției
          </h3>

          <p>
            Alege manual produse din Artfest sau lasă AI-ul să găsească o selecție potrivită pentru campania ta.
          </p>
        </div>
      </div>

      {/* =====================================================
          AI SELECTOR
      ===================================================== */}

      <div
        style={{
          marginBottom:
            20,
          padding:
            16,
          border:
            "1px solid rgba(111, 78, 67, 0.18)",
          borderRadius:
            14,
          background:
            "rgba(111, 78, 67, 0.045)",
        }}
      >
        <div
          style={{
            display:
              "flex",
            justifyContent:
              "space-between",
            alignItems:
              "flex-start",
            gap: 14,
            flexWrap:
              "wrap",
          }}
        >
          <div
            style={{
              flex:
                "1 1 320px",
            }}
          >
            <strong
              style={{
                display:
                  "block",
                fontSize:
                  15,
              }}
            >
              ✨ Alege produse cu AI
            </strong>

            <p
              style={{
                margin:
                  "5px 0 0",
                color:
                  "var(--color-text-muted, #6b7280)",
                fontSize:
                  13,
                lineHeight:
                  1.5,
              }}
            >
              AI-ul folosește produse reale din Artfest și îți propune o selecție potrivită pentru tema colecției.
            </p>
          </div>

          <button
            type="button"
            className={
              styles.iconTextButton
            }
            onClick={() =>
              setAiOpen(
                (current) =>
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
            style={{
              display:
                "grid",
              gap: 12,
              marginTop:
                16,
              paddingTop:
                16,
              borderTop:
                "1px solid rgba(111, 78, 67, 0.14)",
            }}
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
                rows={3}
                maxLength={
                  1500
                }
                onChange={(event) =>
                  setAiPrompt(
                    event.target.value
                  )
                }
                placeholder={`Ex: ${
                  collection.title ||
                  "Cadouri elegante pentru profesoare, personalizabile și potrivite pentru final de an"
                }`}
              />

              <small>
                Dacă lași câmpul gol, AI-ul va folosi automat titlul și descrierea colecției.
              </small>
            </label>

            <div
              style={{
                display:
                  "grid",
                gridTemplateColumns:
                  "repeat(3, minmax(0, 1fr))",
                gap: 10,
              }}
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
                  Câte sugestii?
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
                  style={{
                    width:
                      "100%",
                    boxSizing:
                      "border-box",
                    border:
                      "1px solid var(--color-border, #d1d5db)",
                    borderRadius:
                      11,
                    background:
                      "var(--color-surface, #fff)",
                    color:
                      "inherit",
                    padding:
                      "11px 12px",
                    font:
                      "inherit",
                    outline:
                      "none",
                  }}
                >
                  <option value={6}>
                    6 produse
                  </option>

                  <option value={12}>
                    12 produse
                  </option>

                  <option value={18}>
                    18 produse
                  </option>

                  <option value={24}>
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
              {aiLoading ? (
                <>
                  <Loader2
                    size={17}
                    className={
                      styles.spinner
                    }
                  />

                  AI caută produse…
                </>
              ) : (
                "✨ Găsește produse potrivite"
              )}
            </button>
          </div>
        )}

        {aiRecommendations.length >
          0 && (
          <div
            style={{
              marginTop:
                18,
              paddingTop:
                16,
              borderTop:
                "1px solid rgba(111, 78, 67, 0.14)",
            }}
          >
            <div
              style={{
                display:
                  "flex",
                justifyContent:
                  "space-between",
                gap: 12,
                alignItems:
                  "center",
                flexWrap:
                  "wrap",
                marginBottom:
                  12,
              }}
            >
              <div>
                <strong>
                  Sugestii AI
                </strong>

                <div
                  style={{
                    marginTop:
                      3,
                    fontSize:
                      12,
                    color:
                      "var(--color-text-muted, #6b7280)",
                  }}
                >
                  {
                    aiRecommendations.length
                  }{" "}
                  produse recomandate ·{" "}
                  {
                    aiSelectedIds.length
                  }{" "}
                  selectate
                </div>
              </div>

              <label
                style={{
                  display:
                    "inline-flex",
                  alignItems:
                    "center",
                  gap: 7,
                  fontSize:
                    12,
                  fontWeight:
                    600,
                  cursor:
                    "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={
                    allAiSelected
                  }
                  onChange={(event) => {
                    if (
                      event.target.checked
                    ) {
                      setAiSelectedIds(
                        aiRecommendations.map(
                          (
                            item
                          ) =>
                            item.productId
                        )
                      );
                    } else {
                      setAiSelectedIds(
                        []
                      );
                    }
                  }}
                />

                Selectează toate
              </label>
            </div>

            <div
              style={{
                display:
                  "grid",
                gap: 9,
                marginBottom:
                  14,
              }}
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
                      style={{
                        display:
                          "flex",
                        alignItems:
                          "flex-start",
                        gap: 11,
                        padding:
                          11,
                        border:
                          checked
                            ? "1px solid rgba(111, 78, 67, 0.38)"
                            : "1px solid var(--color-border, #e5e7eb)",
                        borderRadius:
                          12,
                        background:
                          checked
                            ? "rgba(111, 78, 67, 0.06)"
                            : "var(--color-surface, #fff)",
                        cursor:
                          "pointer",
                      }}
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
                        style={{
                          marginTop:
                            18,
                        }}
                      />

                      <ProductImage
                        product={
                          product
                        }
                      />

                      <div
                        style={{
                          flex:
                            1,
                          minWidth:
                            0,
                        }}
                      >
                        <strong
                          style={{
                            display:
                              "block",
                            fontSize:
                              13,
                          }}
                        >
                          {product?.title ||
                            "Produs"}
                        </strong>

                        <div
                          style={{
                            marginTop:
                              4,
                            fontSize:
                              12,
                            fontWeight:
                              700,
                          }}
                        >
                          {formatPrice(
                            product?.priceCents,
                            product?.currency
                          )}
                        </div>

                        {product?.service
                          ?.vendor
                          ?.displayName && (
                          <div
                            style={{
                              marginTop:
                                3,
                              fontSize:
                                11,
                              color:
                                "var(--color-text-muted, #6b7280)",
                            }}
                          >
                            {
                              product
                                .service
                                .vendor
                                .displayName
                            }
                          </div>
                        )}

                        {recommendation.reason && (
                          <p
                            style={{
                              margin:
                                "7px 0 0",
                              fontSize:
                                12,
                              lineHeight:
                                1.45,
                              color:
                                "var(--color-text-muted, #6b7280)",
                            }}
                          >
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

      {/* =====================================================
          MANUAL SEARCH
      ===================================================== */}

      <div
        style={{
          margin:
            "0 0 9px",
          fontSize:
            12,
          fontWeight:
            700,
          color:
            "var(--color-text-muted, #6b7280)",
        }}
      >
        Sau caută manual
      </div>

      <div
        className={
          styles.productSearchWrap
        }
      >
        <Search
          size={18}
          className={
            styles.searchIcon
          }
        />

        <input
          type="search"
          value={
            search
          }
          onChange={(event) =>
            setSearch(
              event.target.value
            )
          }
          placeholder="Caută un produs Artfest..."
          className={
            styles.productSearch
          }
        />

        {searchLoading && (
          <Loader2
            size={17}
            className={`${styles.spinner} ${styles.searchLoader}`}
          />
        )}

        {suggestions.length >
          0 && (
          <div
            className={
              styles.suggestions
            }
          >
            {suggestions.map(
              (
                product
              ) => (
                <div
                  key={
                    product.id
                  }
                  className={
                    styles.suggestionItem
                  }
                >
                  <ProductImage
                    product={
                      product
                    }
                  />

                  <div
                    className={
                      styles.suggestionMeta
                    }
                  >
                    <strong>
                      {
                        product.title
                      }
                    </strong>

                    <span>
                      {formatPrice(
                        product.priceCents,
                        product.currency
                      )}
                    </span>
                  </div>

                  <button
                    type="button"
                    className={
                      styles.addProductButton
                    }
                    disabled={
                      busyId ===
                      product.id
                    }
                    onClick={() =>
                      addProduct(
                        product
                      )
                    }
                  >
                    {busyId ===
                    product.id ? (
                      <Loader2
                        size={16}
                        className={
                          styles.spinner
                        }
                      />
                    ) : (
                      <Plus
                        size={16}
                      />
                    )}

                    Adaugă
                  </button>
                </div>
              )
            )}
          </div>
        )}
      </div>

      {/* =====================================================
          CURRENT COLLECTION ITEMS
      ===================================================== */}

      {!collection.items
        ?.length ? (
        <div
          className={
            styles.noProducts
          }
        >
          <span>
            🛍️
          </span>

          <strong>
            Colecția este goală
          </strong>

          <p>
            Folosește AI-ul sau caută manual produsele pe care vrei să le recomanzi.
          </p>
        </div>
      ) : (
        <div
          className={
            styles.productList
          }
        >
          {collection.items.map(
            (
              item,
              index
            ) => {
              const product =
                item.product;

              return (
                <div
                  key={
                    item.productId
                  }
                  className={
                    styles.productRow
                  }
                >
                  <ProductImage
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

                    <span>
                      {product?.service
                        ?.vendor
                        ?.displayName ||
                        product
                          ?.service
                          ?.title ||
                        ""}
                    </span>

                    <small>
                      {formatPrice(
                        product?.priceCents,
                        product?.currency
                      )}
                    </small>
                  </div>

                  <div
                    className={
                      styles.productActions
                    }
                  >
                    <button
                      type="button"
                      title="Mută mai sus"
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
                      <ArrowUp
                        size={17}
                      />
                    </button>

                    <button
                      type="button"
                      title="Mută mai jos"
                      disabled={
                        index ===
                          collection
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
                      <ArrowDown
                        size={17}
                      />
                    </button>

                    <button
                      type="button"
                      title="Elimină din colecție"
                      disabled={
                        busyId ===
                        item.productId
                      }
                      className={
                        styles.removeProductButton
                      }
                      onClick={() =>
                        removeProduct(
                          item.productId
                        )
                      }
                    >
                      {busyId ===
                      item.productId ? (
                        <Loader2
                          size={17}
                          className={
                            styles.spinner
                          }
                        />
                      ) : (
                        <Trash2
                          size={17}
                        />
                      )}
                    </button>
                  </div>
                </div>
              );
            }
          )}
        </div>
      )}
    </section>
  );
}

/* =========================================================
   COLLECTION FORM
========================================================= */

function CollectionForm({
  form,
  setForm,
  saving,
  submitLabel,
  onSubmit,
}) {
  return (
    <form
      onSubmit={
        onSubmit
      }
      className={
        styles.form
      }
    >
      <label
        className={
          styles.field
        }
      >
        <span>
          Numele colecției *
        </span>

        <input
          value={
            form.title
          }
          maxLength={
            160
          }
          onChange={(event) =>
            setForm(
              (
                current
              ) => ({
                ...current,

                title:
                  event
                    .target
                    .value,
              })
            )
          }
          placeholder="Ex: Cadouri handmade pentru Crăciun"
          autoFocus
        />
      </label>

      <label
        className={
          styles.field
        }
      >
        <span>
          Descriere
        </span>

        <textarea
          value={
            form.description
          }
          rows={5}
          maxLength={
            5000
          }
          onChange={(event) =>
            setForm(
              (
                current
              ) => ({
                ...current,

                description:
                  event
                    .target
                    .value,
              })
            )
          }
          placeholder="Spune comunității tale de ce ai ales aceste produse..."
        />
      </label>

      <label
        className={
          styles.field
        }
      >
        <span>
          Imagine copertă
        </span>

        <input
          value={
            form.coverImage
          }
          onChange={(event) =>
            setForm(
              (
                current
              ) => ({
                ...current,

                coverImage:
                  event
                    .target
                    .value,
              })
            )
          }
          placeholder="https://..."
        />

        <small>
          Momentan poți introduce URL-ul unei imagini. Putem lega ulterior uploadul direct din galerie.
        </small>
      </label>

      {form.coverImage && (
        <div
          className={
            styles.coverPreview
          }
        >
          <img
            src={
              form.coverImage
            }
            alt="Previzualizare copertă"
          />
        </div>
      )}

      <label
        className={
          styles.toggleRow
        }
      >
        <div>
          <strong>
            Colecție publică
          </strong>

          <span>
            Dacă este dezactivată, colecția rămâne salvată dar nu poate fi accesată public.
          </span>
        </div>

        <input
          type="checkbox"
          checked={
            form.isActive
          }
          onChange={(event) =>
            setForm(
              (
                current
              ) => ({
                ...current,

                isActive:
                  event
                    .target
                    .checked,
              })
            )
          }
        />
      </label>

      <button
        type="submit"
        className={
          styles.primaryButton
        }
        disabled={
          saving
        }
      >
        {saving && (
          <Loader2
            size={17}
            className={
              styles.spinner
            }
          />
        )}

        {saving
          ? "Se salvează…"
          : submitLabel}
      </button>
    </form>
  );
}

/* =========================================================
   MODAL
========================================================= */

function Modal({
  title,
  onClose,
  children,
}) {
  useEffect(() => {
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

    const previous =
      document.body.style
        .overflow;

    document.body.style.overflow =
      "hidden";

    return () => {
      document.removeEventListener(
        "keydown",
        onKeyDown
      );

      document.body.style.overflow =
        previous;
    };
  }, [onClose]);

  return (
    <div
      className={
        styles.modalBackdrop
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
        <div
          className={
            styles.modalHeader
          }
        >
          <h2>
            {title}
          </h2>

          <button
            type="button"
            onClick={
              onClose
            }
            className={
              styles.modalClose
            }
          >
            <X
              size={20}
            />
          </button>
        </div>

        {children}
      </div>
    </div>
  );
}

/* =========================================================
   HELPERS
========================================================= */

function MiniStat({
  label,
  value,
}) {
  return (
    <div
      className={
        styles.miniStat
      }
    >
      <span>
        {label}
      </span>

      <strong>
        {Number(
          value || 0
        ).toLocaleString(
          "ro-RO"
        )}
      </strong>
    </div>
  );
}

function ProductImage({
  product,
}) {
  const src =
    product?.images?.[0];

  return (
    <div
      className={
        styles.productImage
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

function formatPrice(
  priceCents,
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
      priceCents || 0
    ) / 100
  );
}