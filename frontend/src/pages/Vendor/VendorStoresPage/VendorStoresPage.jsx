// frontend/src/pages/Vendor/VendorStores/VendorStoresPage.jsx

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  ArrowLeft,
  Eye,
  Pencil,
  Plus,
  Power,
  PowerOff,
  RefreshCw,
  Star,
  Store,
  Trash2,
  Users,
} from "lucide-react";

import {
  Link,
  useNavigate,
} from "react-router-dom";

import { api } from "../../../lib/api";
import { useAuth } from "../../Auth/Context/context.js";

import styles from "./VendorStoresPage.module.css";

/* =========================================================
   HELPERS
========================================================= */

function toISODate(date) {
  return date.toISOString().slice(0, 10);
}

function lastNDaysRange(days) {
  const to = new Date();
  const from = new Date();

  from.setDate(
    to.getDate() - (days - 1)
  );

  return {
    from: toISODate(from),
    to: toISODate(to),
  };
}

function getStoreName(store) {
  return (
    store?.profile?.displayName ||
    store?.title ||
    store?.type?.name ||
    store?.typeName ||
    "Magazin"
  );
}

function getStoreStats(stats, serviceId) {
  return (
    stats?.byService?.[serviceId] || {
      visitors: 0,
      followers: 0,
    }
  );
}

function getStoreReviews(
  reviews,
  serviceId
) {
  return (
    reviews?.byService?.[serviceId] || {
      product: 0,
      store: 0,
    }
  );
}

function humanizeAddStoreError(error) {
  const data =
    error?.data ||
    error?.response?.data ||
    {};

  const code =
    data?.error ||
    error?.error ||
    error?.code ||
    "";

  if (code === "store_limit_reached") {
    return [
      data?.title,
      data?.message,
      data?.hint,
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  return (
    data?.message ||
    error?.message ||
    "Nu am putut crea un magazin nou."
  );
}

function humanizeActivateError(error) {
  const data =
    error?.data ||
    error?.response?.data ||
    {};

  if (
    Array.isArray(data?.missing) &&
    data.missing.length
  ) {
    return `Nu poți activa încă. Mai ai de completat:\n\n${data.missing.join(
      "\n"
    )}`;
  }

  return (
    data?.message ||
    error?.message ||
    "Nu am putut activa magazinul."
  );
}

/* =========================================================
   PAGE
========================================================= */

export default function VendorStoresPage() {
  const navigate = useNavigate();

  const {
    me,
    loading: authLoading,
  } = useAuth();

  const [stores, setStores] =
    useState([]);

  const [stats, setStats] =
    useState({
      visitors: 0,
      followers: 0,
      byService: {},
    });

  const [reviews, setReviews] =
    useState({
      product: 0,
      store: 0,
      byService: {},
    });

  const [loading, setLoading] =
    useState(true);

  const [refreshing, setRefreshing] =
    useState(false);

  const [busy, setBusy] =
    useState({});

  const [error, setError] =
    useState("");

  /* =========================================================
     COUNTS
  ========================================================= */

  const activeCount = useMemo(
    () =>
      stores.filter(
        (store) =>
          store?.isActive &&
          store?.status === "ACTIVE"
      ).length,
    [stores]
  );

  const totalVisitors = useMemo(
    () =>
      stores.reduce(
        (total, store) =>
          total +
          Number(
            getStoreStats(
              stats,
              store.id
            ).visitors || 0
          ),
        0
      ),
    [stores, stats]
  );

  const totalFollowers = useMemo(
    () =>
      stores.reduce(
        (total, store) =>
          total +
          Number(
            getStoreStats(
              stats,
              store.id
            ).followers || 0
          ),
        0
      ),
    [stores, stats]
  );

  /* =========================================================
     LOAD
  ========================================================= */

  const loadStores = useCallback(
    async ({ silent = false } = {}) => {
      try {
        if (silent) {
          setRefreshing(true);
        } else {
          setLoading(true);
        }

        setError("");

        const { from, to } =
          lastNDaysRange(7);

        const [
          storesResponse,
          statsResponse,
          reviewsResponse,
        ] = await Promise.all([
          api(
            "/api/vendors/me/services?includeProfile=1"
          ).catch(() => ({
            items: [],
          })),

          api(
            `/api/vendors/me/visitors/kpi?from=${from}&to=${to}`
          ).catch(() => null),

          api(
            "/api/vendors/me/reviews/kpi"
          ).catch(() => null),
        ]);

        setStores(
          storesResponse?.items || []
        );

        const statsData =
          statsResponse?.data ||
          statsResponse;

        if (statsData) {
          setStats({
            visitors:
              statsData.visitors || 0,

            followers:
              statsData.followers || 0,

            byService:
              statsData.byService || {},
          });
        }

        const reviewData =
          reviewsResponse?.data ||
          reviewsResponse;

        if (reviewData) {
          setReviews({
            product:
              reviewData.product ??
              reviewData.productReviews ??
              0,

            store:
              reviewData.store ??
              reviewData.storeReviews ??
              0,

            byService:
              reviewData.byService || {},
          });
        }
      } catch (err) {
        console.error(err);

        setError(
          err?.message ||
            "Nu am putut încărca magazinele."
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    []
  );

  useEffect(() => {
    if (authLoading) {
      return;
    }

    if (
      !me ||
      me.role !== "VENDOR"
    ) {
      setLoading(false);
      return;
    }

    loadStores();
  }, [
    authLoading,
    me,
    loadStores,
  ]);

  /* =========================================================
     ADD STORE
  ========================================================= */

  const handleAddStore =
    useCallback(async () => {
      try {
        setError("");

        const result = await api(
          "/api/vendors/me/services/products/new",
          {
            method: "POST",
          }
        );

        const newId =
          result?.item?.id || null;

        if (newId) {
          navigate(
            `/onboarding/details?serviceId=${encodeURIComponent(
              newId
            )}`
          );
        } else {
          navigate(
            "/onboarding/details"
          );
        }
      } catch (err) {
        const data =
          err?.data ||
          err?.response?.data ||
          {};

        const code =
          data?.error ||
          err?.error ||
          err?.code ||
          "";

        const ctaUrl =
          data?.cta?.url || "";

        alert(
          humanizeAddStoreError(err)
        );

        if (
          code ===
            "store_limit_reached" &&
          ctaUrl
        ) {
          navigate(ctaUrl);
        }
      }
    }, [navigate]);

  /* =========================================================
     ACTIVATE
  ========================================================= */

  const handleActivate =
    useCallback(
      async (serviceId) => {
        try {
          setBusy((current) => ({
            ...current,
            [serviceId]:
              "activate",
          }));

          await api(
            `/api/vendors/me/services/${serviceId}/activate`,
            {
              method: "POST",
            }
          );

          await loadStores({
            silent: true,
          });
        } catch (err) {
          alert(
            humanizeActivateError(
              err
            )
          );
        } finally {
          setBusy((current) => {
            const next = {
              ...current,
            };

            delete next[serviceId];

            return next;
          });
        }
      },
      [loadStores]
    );

  /* =========================================================
     DEACTIVATE
  ========================================================= */

  const handleDeactivate =
    useCallback(
      async (serviceId) => {
        try {
          setBusy((current) => ({
            ...current,
            [serviceId]:
              "deactivate",
          }));

          await api(
            `/api/vendors/me/services/${serviceId}/deactivate`,
            {
              method: "POST",
            }
          );

          await loadStores({
            silent: true,
          });
        } catch (err) {
          alert(
            err?.message ||
              "Nu am putut dezactiva magazinul."
          );
        } finally {
          setBusy((current) => {
            const next = {
              ...current,
            };

            delete next[serviceId];

            return next;
          });
        }
      },
      [loadStores]
    );

  /* =========================================================
     DELETE
  ========================================================= */

  const handleDelete =
    useCallback(
      async (store) => {
        const isActive =
          store?.isActive &&
          store?.status ===
            "ACTIVE";

        if (isActive) {
          alert(
            "Magazinul este activ. Dezactivează-l înainte de a-l șterge."
          );

          return;
        }

        const accepted =
          window.confirm(
            `Ești sigur că vrei să ștergi definitiv magazinul „${getStoreName(
              store
            )}”? Acțiunea nu poate fi anulată.`
          );

        if (!accepted) {
          return;
        }

        try {
          setBusy((current) => ({
            ...current,
            [store.id]: "delete",
          }));

          await api(
            `/api/vendors/me/services/${store.id}`,
            {
              method: "DELETE",
            }
          );

          await loadStores({
            silent: true,
          });
        } catch (err) {
          alert(
            err?.message ||
              "Nu am putut șterge magazinul."
          );
        } finally {
          setBusy((current) => {
            const next = {
              ...current,
            };

            delete next[store.id];

            return next;
          });
        }
      },
      [loadStores]
    );

  /* =========================================================
     PREVIEW
  ========================================================= */

  const handlePreview =
    useCallback(
      (store) => {
        const slug =
          store?.profile?.slug;

        if (slug) {
          window.open(
            `/magazin/${slug}`,
            "_blank",
            "noopener,noreferrer"
          );

          return;
        }

        navigate(
          `/onboarding/details?serviceId=${encodeURIComponent(
            store.id
          )}`
        );
      },
      [navigate]
    );

  /* =========================================================
     ACCESS
  ========================================================= */

  if (authLoading) {
    return (
      <div
        className={
          styles.loadingPage
        }
      >
        Se încarcă…
      </div>
    );
  }

  if (
    !me ||
    me.role !== "VENDOR"
  ) {
    return (
      <div className={styles.page}>
        Acces doar pentru vendori.
      </div>
    );
  }

  /* =========================================================
     RENDER
  ========================================================= */

  return (
    <main className={styles.page}>
      {/* HEADER */}

      <header
        className={
          styles.header
        }
      >
        <div
          className={
            styles.headerLeft
          }
        >
          <button
            type="button"
            className={
              styles.backButton
            }
            onClick={() =>
              navigate(-1)
            }
            aria-label="Înapoi"
          >
            <ArrowLeft size={20} />
          </button>

          <div>
            <div
              className={
                styles.eyebrow
              }
            >
              <Store size={15} />

              Vendor Artfest
            </div>

            <h1>
              Magazinele mele
            </h1>

            <p>
              Administrează
              magazinele, profilurile
              și vizibilitatea lor în
              Artfest.
            </p>
          </div>
        </div>

        <div
          className={
            styles.headerActions
          }
        >
          <button
            type="button"
            className={
              styles.refreshButton
            }
            disabled={refreshing}
            onClick={() =>
              loadStores({
                silent: true,
              })
            }
          >
            <RefreshCw
              size={17}
              className={
                refreshing
                  ? styles.spinning
                  : ""
              }
            />

            Actualizează
          </button>

          <button
            type="button"
            className={
              styles.addButton
            }
            onClick={
              handleAddStore
            }
          >
            <Plus size={18} />

            Adaugă magazin
          </button>
        </div>
      </header>

      {/* SUMMARY */}

      <section
        className={
          styles.summaryGrid
        }
      >
        <div
          className={
            styles.summaryCard
          }
        >
          <div
            className={
              styles.summaryIcon
            }
          >
            <Store size={20} />
          </div>

          <div>
            <span>
              Magazine
            </span>

            <strong>
              {stores.length}
            </strong>

            <small>
              {activeCount} active
            </small>
          </div>
        </div>

        <div
          className={
            styles.summaryCard
          }
        >
          <div
            className={
              styles.summaryIcon
            }
          >
            <Eye size={20} />
          </div>

          <div>
            <span>
              Vizitatori
            </span>

            <strong>
              {totalVisitors}
            </strong>

            <small>
              ultimele 7 zile
            </small>
          </div>
        </div>

        <div
          className={
            styles.summaryCard
          }
        >
          <div
            className={
              styles.summaryIcon
            }
          >
            <Users size={20} />
          </div>

          <div>
            <span>
              Urmăritori
            </span>

            <strong>
              {totalFollowers}
            </strong>

            <small>
              total magazine
            </small>
          </div>
        </div>

        <div
          className={
            styles.summaryCard
          }
        >
          <div
            className={
              styles.summaryIcon
            }
          >
            <Star size={20} />
          </div>

          <div>
            <span>
              Recenzii
            </span>

            <strong>
              {Number(
                reviews.store || 0
              ) +
                Number(
                  reviews.product ||
                    0
                )}
            </strong>

            <small>
              magazin + produse
            </small>
          </div>
        </div>
      </section>

      {error && (
        <div
          className={
            styles.error
          }
        >
          {error}
        </div>
      )}

      {/* STORES */}

      <section
        className={
          styles.contentCard
        }
      >
        <div
          className={
            styles.sectionHeader
          }
        >
          <div>
            <h2>
              Magazine
            </h2>

            <p>
              {activeCount} active din{" "}
              {stores.length}
            </p>
          </div>
        </div>

        {loading ? (
          <div
            className={
              styles.loadingState
            }
          >
            Se încarcă magazinele…
          </div>
        ) : stores.length ===
          0 ? (
          <div
            className={
              styles.emptyState
            }
          >
            <div
              className={
                styles.emptyIcon
              }
            >
              <Store size={28} />
            </div>

            <h3>
              Nu ai încă niciun
              magazin
            </h3>

            <p>
              Creează primul magazin
              și completează profilul
              pentru a începe să
              publici produse.
            </p>

            <button
              type="button"
              className={
                styles.addButton
              }
              onClick={
                handleAddStore
              }
            >
              <Plus size={18} />

              Adaugă primul magazin
            </button>
          </div>
        ) : (
          <div
            className={
              styles.storeList
            }
          >
            {stores.map(
              (store) => {
                const isActive =
                  !!(
                    store.isActive &&
                    store.status ===
                      "ACTIVE"
                  );

                const isBusy =
                  !!busy[store.id];

                const storeStats =
                  getStoreStats(
                    stats,
                    store.id
                  );

                const storeReviews =
                  getStoreReviews(
                    reviews,
                    store.id
                  );

                const name =
                  getStoreName(
                    store
                  );

                const logo =
                  store?.profile
                    ?.logoUrl;

                return (
                  <article
                    key={
                      store.id
                    }
                    className={
                      styles.storeCard
                    }
                  >
                    <div
                      className={
                        styles.storeTop
                      }
                    >
                      <div
                        className={
                          styles.storeIdentity
                        }
                      >
                        <div
                          className={
                            styles.storeLogo
                          }
                        >
                          {logo ? (
                            <img
                              src={
                                logo
                              }
                              alt=""
                            />
                          ) : (
                            <Store
                              size={
                                25
                              }
                            />
                          )}
                        </div>

                        <div>
                          <div
                            className={
                              styles.nameRow
                            }
                          >
                            <h3>
                              {
                                name
                              }
                            </h3>

                            <span
                              className={
                                isActive
                                  ? styles.statusActive
                                  : styles.statusInactive
                              }
                            >
                              <span />

                              {isActive
                                ? "Activ"
                                : "Inactiv"}
                            </span>
                          </div>

                          <p
                            className={
                              styles.storeMeta
                            }
                          >
                            {store
                              ?.type
                              ?.name ||
                              store?.typeName ||
                              "Magazin"}

                            {store
                              ?.city &&
                              ` · ${store.city}`}
                          </p>
                        </div>
                      </div>

                      <div
                        className={
                          styles.storeActionsDesktop
                        }
                      >
                        <Link
                          to={`/onboarding/details?serviceId=${encodeURIComponent(
                            store.id
                          )}`}
                          className={
                            styles.secondaryButton
                          }
                        >
                          <Pencil
                            size={
                              16
                            }
                          />

                          Editează
                        </Link>

                        <button
                          type="button"
                          className={
                            styles.secondaryButton
                          }
                          disabled={
                            isBusy
                          }
                          onClick={() =>
                            handlePreview(
                              store
                            )
                          }
                        >
                          <Eye
                            size={
                              16
                            }
                          />

                          Previzualizează
                        </button>
                      </div>
                    </div>

                    <div
                      className={
                        styles.metricsGrid
                      }
                    >
                      <div
                        className={
                          styles.metric
                        }
                      >
                        <span>
                          Vizitatori
                        </span>

                        <strong>
                          {storeStats.visitors ??
                            0}
                        </strong>

                        <small>
                          ultimele 7
                          zile
                        </small>
                      </div>

                      <div
                        className={
                          styles.metric
                        }
                      >
                        <span>
                          Urmăritori
                        </span>

                        <strong>
                          {storeStats.followers ??
                            0}
                        </strong>

                        <small>
                          magazin
                        </small>
                      </div>

                      <div
                        className={
                          styles.metric
                        }
                      >
                        <span>
                          Recenzii
                          magazin
                        </span>

                        <strong>
                          {storeReviews.store ??
                            0}
                        </strong>

                        <small>
                          primite
                        </small>
                      </div>

                      <div
                        className={
                          styles.metric
                        }
                      >
                        <span>
                          Recenzii
                          produse
                        </span>

                        <strong>
                          {storeReviews.product ??
                            0}
                        </strong>

                        <small>
                          primite
                        </small>
                      </div>
                    </div>

                    <div
                      className={
                        styles.detailsRow
                      }
                    >
                      <div>
                        <span>
                          Brand
                        </span>

                        <strong>
                          {store
                            ?.profile
                            ?.displayName ||
                            "—"}
                        </strong>
                      </div>

                      <div>
                        <span>
                          Status
                        </span>

                        <strong>
                          {store.status ||
                            "—"}
                        </strong>
                      </div>

                      <div>
                        <span>
                          Tip
                        </span>

                        <strong>
                          {store
                            ?.type
                            ?.name ||
                            store?.typeName ||
                            "—"}
                        </strong>
                      </div>
                    </div>

                    <div
                      className={
                        styles.mobileMainActions
                      }
                    >
                      <Link
                        to={`/onboarding/details?serviceId=${encodeURIComponent(
                          store.id
                        )}`}
                        className={
                          styles.secondaryButton
                        }
                      >
                        <Pencil
                          size={16}
                        />

                        Editează
                      </Link>

                      <button
                        type="button"
                        className={
                          styles.secondaryButton
                        }
                        onClick={() =>
                          handlePreview(
                            store
                          )
                        }
                      >
                        <Eye
                          size={16}
                        />

                        Vezi
                      </button>
                    </div>

                    <div
                      className={
                        styles.manageRow
                      }
                    >
                      {isActive ? (
                        <button
                          type="button"
                          className={
                            styles.deactivateButton
                          }
                          disabled={
                            isBusy
                          }
                          onClick={() =>
                            handleDeactivate(
                              store.id
                            )
                          }
                        >
                          <PowerOff
                            size={
                              16
                            }
                          />

                          {busy[
                            store.id
                          ] ===
                          "deactivate"
                            ? "Se dezactivează…"
                            : "Dezactivează"}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className={
                            styles.activateButton
                          }
                          disabled={
                            isBusy
                          }
                          onClick={() =>
                            handleActivate(
                              store.id
                            )
                          }
                        >
                          <Power
                            size={
                              16
                            }
                          />

                          {busy[
                            store.id
                          ] ===
                          "activate"
                            ? "Se activează…"
                            : "Activează"}
                        </button>
                      )}

                      <button
                        type="button"
                        className={
                          styles.deleteButton
                        }
                        disabled={
                          isBusy
                        }
                        onClick={() =>
                          handleDelete(
                            store
                          )
                        }
                      >
                        <Trash2
                          size={16}
                        />

                        {busy[
                          store.id
                        ] ===
                        "delete"
                          ? "Se șterge…"
                          : "Șterge magazin"}
                      </button>
                    </div>
                  </article>
                );
              }
            )}
          </div>
        )}
      </section>
    </main>
  );
}