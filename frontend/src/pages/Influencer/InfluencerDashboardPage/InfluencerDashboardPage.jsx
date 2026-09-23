import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  useNavigate,
  useSearchParams,
} from "react-router-dom";

import { toast } from "react-toastify";

import { api, buildApiUrl } from "../../../lib/api.js";
import { POLICY_REQUIRED_EVENT } from "../../../lib/policyRequired.js";
import PolicyGate from "../../Admin/AdminDesktop/PolicyGate/PolicyGate.jsx";
import usePolicyGateController from "../../Admin/AdminDesktop/PolicyGate/usePolicyGateController.js";

import styles from "./InfluencerDashboardPage.module.css";

/*
 * Audit performanță 2026-09-23 - lazy pentru cele 4 modale + cele 2
 * secțiuni de tab grele. Condițiile de randare EXISTENTE
 * ({xOpen && <Modal/>}, {activeTab === "x" && <Secțiune/>}) rămân
 * neschimbate mai jos - doar sursa importului devine un chunk
 * separat, ca greutatea lor să nu mai intre în chunk-ul paginii.
 */
const InfluencerCollectionsModal = lazy(() =>
  import("../components/InfluencerCollectionsModal.jsx")
);

const InfluencerDiscountCodesModal = lazy(() =>
  import("../components/InfluencerDiscountCodesModal.jsx")
);

const InfluencerTermsGateModal = lazy(() =>
  import("../components/InfluencerTermsGateModal.jsx")
);

const InfluencerFilesModal = lazy(() =>
  import("../components/InfluencerFilesModal.jsx")
);

const InfluencerResourcesSection = lazy(() =>
  import("./InfluencerResourcesSection.jsx")
);

const CommunityFeaturesSection = lazy(() =>
  import("./CommunityFeaturesSection.jsx")
);

/* =========================================================
   WHATSAPP

   Nu stocăm numărul influencerului și nu logăm conversația -
   doar un link mailto-like către wa.me, deschis într-un tab nou.
========================================================= */

const WHATSAPP_PHONE = "40760565147";

const WHATSAPP_MESSAGE =
  "Bună! Sunt influencer Artfest și am nevoie de ajutor.";

const WHATSAPP_URL = `https://wa.me/${WHATSAPP_PHONE}?text=${encodeURIComponent(
  WHATSAPP_MESSAGE
)}`;

/* =========================================================
   TABS

   „Fiscalizare & plăți” NU mai e tab intern aici - a fost mutat
   complet în Setări cont (/cont/setari?tab=fiscalizare, vezi
   UserSettingsPage.jsx). Reminder-ul de mai jos duce direct acolo.
========================================================= */

const DASHBOARD_TABS = [
  {
    id: "home",
    label: "Acasă",
  },
  {
    id: "community",
    label: "Ce poți promova",
  },
  {
    id: "promotion",
    label: "Promovare",
  },
  {
    id: "orders",
    label: "Comenzi",
  },
  {
    id: "resources",
    label: "Resurse",
  },
];

/* =========================================================
   SKELETON (audit performanță 2026-09-23)

   Înlocuiește vechiul ecran "Se încarcă dashboardul…" (card de text,
   fără layout, ecran practic gol) cu un layout STABIL - header, bară
   de tab-uri și grid de KPI, toate cu dimensiunile reale (aceleași
   clase CSS: .page/.shell/.header/.tabs/.statsGrid/.statCard), doar
   cu conținut placeholder animat. Afișat cât timp `loading === true`
   (înainte ca /api/influencer/me să răspundă).
========================================================= */

function SkeletonBlock({ width = "100%", height = 14, radius = 6, style }) {
  return (
    <div
      className={styles.skeletonBlock}
      style={{ width, height, borderRadius: radius, ...style }}
      aria-hidden="true"
    />
  );
}

function DashboardOverviewSkeleton() {
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <div className={styles.header}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <SkeletonBlock
              width={150}
              height={22}
              radius={999}
              style={{ marginBottom: 11 }}
            />
            <SkeletonBlock
              width="55%"
              height={34}
              style={{ marginBottom: 10 }}
            />
            <SkeletonBlock width="80%" height={16} />
          </div>
        </div>

        <div className={styles.tabs}>
          {DASHBOARD_TABS.map((tab) => (
            <SkeletonBlock
              key={tab.id}
              height={43}
              radius={10}
              style={{ flex: "1 0 auto" }}
            />
          ))}
        </div>

        <div className={styles.statsGrid}>
          {/* 5 placeholder-e, câte coloane are .statsGrid azi (vezi
              InfluencerDashboardPage.module.css) - independent de
              numărul de tab-uri, doar coincide numeric. */}
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className={styles.statCard}>
              <SkeletonBlock
                width="65%"
                height={12}
                style={{ marginBottom: 10 }}
              />
              <SkeletonBlock width="45%" height={24} />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}

/* =========================================================
   COMPONENT
========================================================= */

export default function InfluencerDashboardPage() {
  const navigate =
    useNavigate();

  /* =========================================================
     DASHBOARD STATE
  ========================================================= */

  /*
   * FAZA 3 (INFLUENCER) - dashboardul citea tab-ul activ DOAR din
   * useState intern, fără nicio legătură cu URL-ul - asistentul AI
   * (INFLUENCER_RESOURCES/ORDERS/PROMOTION din assistantActionRegistry.js)
   * nu putea deci deschide direct un tab anume. Recalculat din
   * `searchParams` (nu doar la montare) - dacă influencerul are deja
   * dashboardul deschis într-un tab și cere asistentului "arată-mi
   * X", navigate() schimbă doar query string-ul pe ACEEAȘI pagină
   * (fără remount), deci starea tot trebuie actualizată reactiv, nu
   * doar citită o singură dată la mount. Schimbarea tab-urilor din
   * click-urile locale de UI rămâne neschimbată (setActiveTab direct).
   */
  const [searchParams] =
    useSearchParams();

  const initialResourceFilters =
    useMemo(
      () => ({
        category:
          searchParams.get(
            "category"
          ) || undefined,

        activity:
          searchParams.get(
            "activity"
          ) || undefined,
      }),
      [searchParams]
    );

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    error,
    setError,
  ] = useState("");

  const [
    data,
    setData,
  ] = useState(null);

  const [
    copyState,
    setCopyState,
  ] = useState("");

  const [
    activeTab,
    setActiveTab,
  ] = useState("home");

  useEffect(() => {
    const tab =
      searchParams.get("tab");

    if (
      DASHBOARD_TABS.some(
        (item) => item.id === tab
      )
    ) {
      setActiveTab(tab);
    }
  }, [searchParams]);

  /* =========================================================
     COMMISSION AGREEMENT
  ========================================================= */

  const [
    agreement,
    setAgreement,
  ] = useState(null);

  const [
    agreementLoading,
    setAgreementLoading,
  ] = useState(true);

  const [
    agreementSaving,
    setAgreementSaving,
  ] = useState(false);

  const [
    agreementError,
    setAgreementError,
  ] = useState("");

  /* =========================================================
     ORDERS
  ========================================================= */

  const [
    orders,
    setOrders,
  ] = useState([]);

  const [
    ordersLoading,
    setOrdersLoading,
  ] = useState(false);

  const [
    ordersLoaded,
    setOrdersLoaded,
  ] = useState(false);

  const [
    ordersError,
    setOrdersError,
  ] = useState("");

  /* =========================================================
     RESOURCES
  ========================================================= */

  const [
    resources,
    setResources,
  ] = useState([]);

  const [
    resourcesLoading,
    setResourcesLoading,
  ] = useState(false);

  const [
    resourcesLoaded,
    setResourcesLoaded,
  ] = useState(false);

  const [
    resourcesError,
    setResourcesError,
  ] = useState("");

  const [
    markingPostedId,
    setMarkingPostedId,
  ] = useState("");

  const [
    generatedContent,
    setGeneratedContent,
  ] = useState({
    newProductsToday: [],
    newVendorsToday: [],
  });

  /* =========================================================
     MODALS
  ========================================================= */

  const [
    collectionsOpen,
    setCollectionsOpen,
  ] = useState(false);

  const [
    discountCodesOpen,
    setDiscountCodesOpen,
  ] = useState(false);

  const [
    filesOpen,
    setFilesOpen,
  ] = useState(false);

  /* =========================================================
     LOAD DASHBOARD
  ========================================================= */

  const loadDashboard =
    useCallback(
      async () => {
        setError("");

        try {
          const response =
            await api(
              "/api/influencer/me"
            );

          if (
            response?.ok === false
          ) {
            throw Object.assign(
              new Error(
                response?.message ||
                  "Nu am putut încărca dashboardul."
              ),
              {
                data:
                  response,
              }
            );
          }

          setData(
            response
          );

          return response;
        } catch (
          loadError
        ) {
          const code =
            loadError?.data
              ?.error ||
            loadError?.error ||
            "";

          if (
            code ===
            "unauthorized"
          ) {
            navigate(
              "/autentificare",
              {
                replace:
                  true,
              }
            );

            return null;
          }

          if (
            code ===
            "influencer_required"
          ) {
            navigate(
              "/",
              {
                replace:
                  true,
              }
            );

            return null;
          }

          setError(
            loadError?.data
              ?.message ||
              loadError?.message ||
              "Nu am putut încărca dashboardul."
          );

          return null;
        }
      },
      [
        navigate,
      ]
    );

  /* =========================================================
     ACORD PROGRAM (reacceptare)
  ========================================================= */

  /*
   * Actualizează DOAR `terms` în state, local - nu mai facem un
   * reload complet al dashboardului. Backend-ul rămâne oricum
   * sursa de adevăr (enforceInfluencerTermsGate revalidează la
   * fiecare acțiune comercială, indiferent de ce arată acest state).
   */
  const handleTermsAccepted =
    useCallback(
      (nextTerms) => {
        setData(
          (current) =>
            current
              ? {
                  ...current,
                  terms:
                    nextTerms ||
                    {
                      ...current.terms,
                      outdated: false,
                      acceptedVersion:
                        current.terms
                          ?.currentVersion,
                    },
                }
              : current
        );
      },
      [
        setData,
      ]
    );

  /*
   * O cerere de reacceptare cu termen-limită încă neatins NU blochează
   * (data.terms.blocking === false): modalul poate fi amânat. Când
   * termenul trece sau nu există termen, modalul rămâne blocant.
   */
  const [termsDismissed, setTermsDismissed] = useState(false);

  const handleTermsDismiss = useCallback(() => {
    setTermsDismissed(true);
  }, []);

  /*
   * TOS / Privacy pe audiența INFLUENCER: același gate multi-document ca
   * la clienți și vendori (Acordul influencerilor rămâne pe modalul lui).
   */
  const {
    open: policyGateOpen,
    scope: policyGateScope,
    setBlocked: setPolicyGateBlocked,
    onClose: closePolicyGate,
  } = usePolicyGateController({
    me: data ? { role: "INFLUENCER" } : null,
  });

  // 428 influencer_terms_acceptance_required din orice cerere: deschidem modalul
  useEffect(() => {
    const onRequired = (event) => {
      const detail = event?.detail;

      if (detail?.kind !== "influencer_terms" || !detail.terms) return;

      setTermsDismissed(false);
      setData((current) =>
        current ? { ...current, terms: detail.terms } : current
      );
    };

    window.addEventListener(POLICY_REQUIRED_EVENT, onRequired);

    return () =>
      window.removeEventListener(POLICY_REQUIRED_EVENT, onRequired);
  }, []);

  /* =========================================================
     LOAD AGREEMENT
  ========================================================= */

  const loadAgreement =
    useCallback(
      async () => {
        setAgreementLoading(
          true
        );

        setAgreementError(
          ""
        );

        try {
          const response =
            await api(
              "/api/influencer/commission-agreement"
            );

          if (
            response?.ok ===
            false
          ) {
            throw new Error(
              response?.message ||
                "Nu am putut încărca propunerea de remunerație."
            );
          }

          setAgreement(
            response
              ?.pendingAgreement ||
              response
                ?.agreement ||
              null
          );
        } catch (
          loadError
        ) {
          setAgreement(
            null
          );

          setAgreementError(
            loadError?.message ||
              "Nu am putut încărca propunerea de remunerație."
          );
        } finally {
          setAgreementLoading(
            false
          );
        }
      },
      []
    );

  /* =========================================================
     INITIAL LOAD
  ========================================================= */

  useEffect(() => {
    let active =
      true;

    async function initialize() {
      setLoading(
        true
      );

      try {
        await Promise.all([
          loadDashboard(),
          loadAgreement(),
        ]);
      } finally {
        if (active) {
          setLoading(
            false
          );
        }
      }
    }

    initialize();

    return () => {
      active =
        false;
    };
  }, [
    loadDashboard,
    loadAgreement,
  ]);

  /* =========================================================
     LOAD ORDERS
  ========================================================= */

  const loadOrders =
    useCallback(
      async ({
        force =
          false,
      } = {}) => {
        if (
          ordersLoaded &&
          !force
        ) {
          return;
        }

        setOrdersLoading(
          true
        );

        setOrdersError(
          ""
        );

        try {
          const response =
            await api(
              "/api/influencer/orders"
            );

          if (
            response?.ok ===
            false
          ) {
            throw new Error(
              response?.message ||
                "Nu am putut încărca comenzile."
            );
          }

          const result =
            response?.items ||
            response?.orders ||
            [];

          setOrders(
            Array.isArray(
              result
            )
              ? result
              : []
          );

          setOrdersLoaded(
            true
          );
        } catch (
          loadError
        ) {
          setOrdersError(
            loadError?.message ||
              "Nu am putut încărca comenzile."
          );
        } finally {
          setOrdersLoading(
            false
          );
        }
      },
      [
        ordersLoaded,
      ]
    );

  /* =========================================================
     LOAD ORDERS WHEN TAB OPENS
  ========================================================= */

  useEffect(() => {
    if (
      activeTab !==
      "orders"
    ) {
      return;
    }

    loadOrders();
  }, [
    activeTab,
    loadOrders,
  ]);

  /* =========================================================
     LOAD RESOURCES
  ========================================================= */

  const loadResources =
    useCallback(
      async ({
        force =
          false,
      } = {}) => {
        if (
          resourcesLoaded &&
          !force
        ) {
          return;
        }

        setResourcesLoading(
          true
        );

        setResourcesError(
          ""
        );

        try {
          const response =
            await api(
              "/api/influencer/resources"
            );

          if (
            response?.ok ===
            false
          ) {
            throw new Error(
              response?.message ||
                "Nu am putut încărca resursele."
            );
          }

          const result =
            response?.items ||
            [];

          setResources(
            Array.isArray(
              result
            )
              ? result
              : []
          );

          setGeneratedContent({
            newProductsToday:
              Array.isArray(
                response
                  ?.generatedContent
                  ?.newProductsToday
              )
                ? response
                    .generatedContent
                    .newProductsToday
                : [],

            newVendorsToday:
              Array.isArray(
                response
                  ?.generatedContent
                  ?.newVendorsToday
              )
                ? response
                    .generatedContent
                    .newVendorsToday
                : [],
          });

          setResourcesLoaded(
            true
          );
        } catch (
          loadError
        ) {
          setResourcesError(
            loadError?.message ||
              "Nu am putut încărca resursele."
          );
        } finally {
          setResourcesLoading(
            false
          );
        }
      },
      [
        resourcesLoaded,
      ]
    );

  /* =========================================================
     LOAD RESOURCES WHEN TAB OPENS
  ========================================================= */

  useEffect(() => {
    if (
      activeTab !==
      "resources"
    ) {
      return;
    }

    loadResources();
  }, [
    activeTab,
    loadResources,
  ]);

  /* =========================================================
     DOWNLOAD RESOURCE MEDIA
  ========================================================= */

  async function downloadResourceMedia(
    resource
  ) {
    if (!resource?.id || !resource?.mediaUrl) {
      return;
    }

    try {
      /*
       * NU descărcăm direct de pe mediaUrl (R2/media.artfest.ro
       * nu are CORS configurat, deci fetch() cross-origin e
       * blocat de browser - vezi investigația anterioară).
       * Trecem printr-un proxy same-origin din backend, care
       * citește resource.mediaUrl direct din DB, nu de la noi.
       */
      const response =
        await fetch(
          buildApiUrl(
            `/influencer/resources/${encodeURIComponent(
              resource.id
            )}/download`
          ),
          {
            credentials:
              "include",
          }
        );

      if (!response.ok) {
        throw new Error(
          "download_failed"
        );
      }

      const blob =
        await response.blob();

      const blobUrl =
        URL.createObjectURL(
          blob
        );

      const disposition =
        response.headers.get(
          "content-disposition"
        ) || "";

      const filenameMatch =
        disposition.match(
          /filename="([^"]+)"/
        );

      const extension =
        resource.mediaType ===
        "VIDEO"
          ? "mp4"
          : "jpg";

      const fallbackFilename = `${(
        resource.title ||
        "resursa-artfest"
      )
        .toLowerCase()
        .replace(
          /[^a-z0-9]+/g,
          "-"
        )
        .replace(
          /^-+|-+$/g,
          ""
        )}.${extension}`;

      const link =
        document.createElement(
          "a"
        );

      link.href =
        blobUrl;

      link.download =
        filenameMatch?.[1] ||
        fallbackFilename;

      link.click();

      URL.revokeObjectURL(
        blobUrl
      );
    } catch {
      toast.error(
        "Nu am putut descărca fișierul."
      );
    }
  }

  /* =========================================================
     AM POSTAT
  ========================================================= */

  async function markResourcePosted(
    resource
  ) {
    if (
      !resource?.id ||
      markingPostedId
    ) {
      return;
    }

    setMarkingPostedId(
      resource.id
    );

    try {
      const response =
        await api(
          `/api/influencer/resources/${encodeURIComponent(
            resource.id
          )}/posted`,
          {
            method:
              "POST",
          }
        );

      if (
        response?.ok ===
        false
      ) {
        throw new Error(
          response?.message ||
            "Nu am putut marca resursa ca postată."
        );
      }

      const activity =
        response?.activity;

      setResources(
        (current) =>
          current.map(
            (item) =>
              item.id ===
              resource.id
                ? {
                    ...item,

                    activity: {
                      lastPostedAt:
                        activity?.lastPostedAt ||
                        new Date().toISOString(),

                      postedCount:
                        activity?.postedCount ??
                        (
                          Number(
                            item.activity
                              ?.postedCount ||
                              0
                          ) + 1
                        ),
                    },
                  }
                : item
          )
      );

      toast.success(
        "Marcat ca postat."
      );
    } catch (err) {
      toast.error(
        err?.data
          ?.message ||
          err?.message ||
          "Nu am putut marca resursa ca postată."
      );
    } finally {
      setMarkingPostedId(
        ""
      );
    }
  }

  /* =========================================================
     LINK PERSONAL
  ========================================================= */

  const referralUrl =
    useMemo(() => {
      const code =
        data?.profile
          ?.referralCode;

      if (!code) {
        return "";
      }

      const origin =
        window.location.origin;

      return `${origin}/?ref=${encodeURIComponent(
        code
      )}`;
    }, [
      data,
    ]);

  /* =========================================================
     COPY
  ========================================================= */

  async function copyText(
    value,
    type
  ) {
    if (!value) {
      return;
    }

    try {
      await navigator.clipboard.writeText(
        value
      );

      setCopyState(
        type
      );

      window.setTimeout(
        () => {
          setCopyState(
            ""
          );
        },
        1600
      );
    } catch {
      setError(
        "Nu am putut copia automat."
      );
    }
  }

  /* =========================================================
     AGREEMENT ACTION
  ========================================================= */

  async function handleAgreementAction(
    action
  ) {
    if (
      !agreement?.id ||
      agreementSaving
    ) {
      return;
    }

    const endpoint =
      action === "accept"
        ? `/api/influencer/commission-agreement/${encodeURIComponent(
            agreement.id
          )}/accept`
        : `/api/influencer/commission-agreement/${encodeURIComponent(
            agreement.id
          )}/decline`;

    setAgreementSaving(
      true
    );

    setAgreementError(
      ""
    );

    try {
      const response =
        await api(
          endpoint,
          {
            method:
              "POST",
          }
        );

      if (
        response?.ok ===
        false
      ) {
        throw new Error(
          response?.message ||
            (
              action ===
              "accept"
                ? "Nu am putut accepta remunerația."
                : "Nu am putut refuza propunerea."
            )
        );
      }

      await Promise.all([
        loadDashboard(),
        loadAgreement(),
      ]);
    } catch (
      actionError
    ) {
      setAgreementError(
        actionError?.message ||
          "Nu am putut procesa propunerea."
      );
    } finally {
      setAgreementSaving(
        false
      );
    }
  }

  /* =========================================================
     LOGOUT
  ========================================================= */

  async function logout() {
    try {
      await api(
        "/api/auth/logout",
        {
          method:
            "POST",
        }
      );
    } catch {
      // continuăm logoutul local
    }

    window.location.assign(
      "/autentificare"
    );
  }

  /* =========================================================
     LOADING
  ========================================================= */

  if (loading) {
    return <DashboardOverviewSkeleton />;
  }

  /* =========================================================
     ERROR
  ========================================================= */

  if (
    error ||
    !data?.profile
  ) {
    return (
      <main
        className={
          styles.page
        }
      >
        <div
          className={
            styles.errorCard
          }
        >
          <h1>
            Nu am putut încărca contul
          </h1>

          <p>
            {error ||
              "Profilul de influencer nu este disponibil."}
          </p>

          <button
            type="button"
            className={
              styles.secondaryButton
            }
            onClick={() =>
              window.location.reload()
            }
          >
            Încearcă din nou
          </button>
        </div>
      </main>
    );
  }

  const {
    user,
    profile,
    payoutProfile,
    collaboration,
  } = data;

  /* =========================================================
     REMUNERAȚIE
  ========================================================= */

  const commissionConfigured =
    Boolean(
      profile
        ?.commissionConfigured
    ) ||
    (
      profile
        ?.platformCommissionSharePercent !==
        undefined &&
      profile
        ?.platformCommissionSharePercent !==
        null &&
      Number(
        profile
          ?.platformCommissionSharePercent
      ) > 0
    ) ||
    (
      profile
        ?.commissionSharePercent !==
        undefined &&
      profile
        ?.commissionSharePercent !==
        null &&
      Number(
        profile
          ?.commissionSharePercent
      ) > 0
    );

  const commissionSharePercent =
    profile
      ?.platformCommissionSharePercent ??
    profile
      ?.commissionSharePercent ??
    null;

  const commissionLabel =
    commissionConfigured &&
    commissionSharePercent !==
      null
      ? `${Number(
          commissionSharePercent
        ).toLocaleString(
          "ro-RO"
        )}% din comisionul Artfest`
      : "În curs de stabilire";

  const pendingCommissionPercent =
    agreement
      ? Number(
          agreement
            .commissionBps ||
            0
        ) /
        100
      : null;

  /* =========================================================
     STATS
  ========================================================= */

  const clicks =
    Number(
      profile.clicks ||
        0
    );

  const ordersCount =
    Number(
      profile.ordersCount ||
        0
    );

  const salesAmount =
    Number(
      profile.salesAmount ||
        0
    );

  const earningsAmount =
    Number(
      profile
        .earningsAmount ??
        profile
          .confirmedEarningsAmount ??
        profile
          .commissionAmount ??
        0
    );

  const estimatedEarningsAmount =
    Number(
      profile
        .estimatedEarningsAmount ||
        0
    );

  /*
   * Folosit STRICT pentru reminder-ul de date de plată (varianta
   * urgentă) - explicit `confirmedEarningsAmount`, NU aliasul
   * `earningsAmount` (care, deși azi e egal cu confirmedEarningsAmount
   * - vezi comentariul din backend/src/routes/influencerRoutes.js,
   * "păstrat pentru compatibilitate" - nu trebuie tratat ca sursă de
   * adevăr aici; un câștig ESTIMAT, neconfirmat, nu justifică
   * varianta urgentă a reminder-ului).
   */
  const confirmedEarningsAmount =
    Number(
      profile
        .confirmedEarningsAmount ||
        0
    );

  const hasActivity =
    clicks > 0 ||
    ordersCount > 0 ||
    salesAmount > 0 ||
    earningsAmount > 0;

  /* =========================================================
     TAB BADGES
  ========================================================= */

  const orderBadge =
    ordersCount > 0
      ? String(
          ordersCount
        )
      : "";

  /* =========================================================
     PAGE
  ========================================================= */

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
        {/* =====================================================
            HEADER
        ===================================================== */}

        <header
          className={
            styles.header
          }
        >
          <div>
            <div
              className={
                styles.badge
              }
            >
              Influencer Artfest
            </div>

            <h1
              className={
                styles.title
              }
            >
              Bun venit,{" "}
              {profile.displayName ||
                user?.name ||
                "Influencer"}
            </h1>

            <p
              className={
                styles.subtitle
              }
            >
              Gestionează promovarea, urmărește comenzile și găsește materiale pe care le poți folosi în conținutul tău.
            </p>
          </div>

          <button
            type="button"
            className={
              styles.logoutButton
            }
            onClick={
              logout
            }
          >
            Ieșire
          </button>
        </header>

        {/* =====================================================
            TABS
        ===================================================== */}

        <nav
          className={
            styles.tabs
          }
          aria-label="Dashboard influencer"
        >
          {DASHBOARD_TABS.map(
            (
              tab
            ) => {
              const active =
                activeTab ===
                tab.id;

              const badge =
                tab.id ===
                "orders"
                  ? orderBadge
                  : (
                      tab.id ===
                        "home" &&
                      agreement
                        ? "!"
                        : ""
                    );

              return (
                <button
                  key={
                    tab.id
                  }
                  type="button"
                  className={`${styles.tabButton} ${
                    active
                      ? styles.tabButtonActive
                      : ""
                  }`}
                  onClick={() =>
                    setActiveTab(
                      tab.id
                    )
                  }
                >
                  <span>
                    {tab.label}
                  </span>

                  {badge && (
                    <span
                      className={
                        styles.tabBadge
                      }
                    >
                      {badge}
                    </span>
                  )}
                </button>
              );
            }
          )}
        </nav>

        {/* =====================================================
            HOME
        ===================================================== */}

        {activeTab ===
          "home" && (
          <>
            {/* =================================================
                REMINDER DATE DE PLATĂ

                Niciodată blocant - dispare singur quando profilul
                devine complet (payoutProfile vine din GET /me,
                aditiv, vezi backend/src/routes/influencerRoutes.js).
            ================================================= */}

            {(!payoutProfile?.exists || !payoutProfile?.isComplete) && (
              <div
                className={`${styles.payoutReminder} ${
                  confirmedEarningsAmount > 0
                    ? styles.payoutReminderUrgent
                    : ""
                }`}
              >
                <div className={styles.payoutReminderBody}>
                  <p className={styles.payoutReminderTitle}>
                    Completează datele de plată
                  </p>

                  <p className={styles.payoutReminderText}>
                    {confirmedEarningsAmount > 0
                      ? "Ai câștiguri confirmate. Completează datele de plată pentru a putea fi procesate."
                      : "Pentru a putea încasa câștigurile confirmate, completează datele fiscale și IBAN-ul."}
                  </p>
                </div>

                <div className={styles.payoutReminderActions}>
                  <button
                    type="button"
                    className={styles.primaryButton}
                    onClick={() =>
                      navigate("/cont/setari?tab=fiscalizare")
                    }
                  >
                    Completează datele
                  </button>
                </div>
              </div>
            )}

            {/* =================================================
                COLABORARE ARTFEST
            ================================================= */}

            <CollaborationCard
              collaboration={
                collaboration
              }
            />

            {/* =================================================
                STATS
            ================================================= */}

            <section
              className={
                styles.statsGrid
              }
            >
              <StatCard
                label="Clickuri"
                value={
                  clicks.toLocaleString(
                    "ro-RO"
                  )
                }
              />

              <StatCard
  label="Comenzi generate"
  value={
    ordersCount.toLocaleString(
      "ro-RO"
    )
  }
/>

              <StatCard
                label="Vânzări generate"
                value={
                  formatMoney(
                    salesAmount
                  )
                }
              />

              <StatCard
                label="Câștig confirmat"
                value={
                  formatMoney(
                    earningsAmount
                  )
                }
              />

              <StatCard
                label="Câștig estimat"
                value={
                  formatMoney(
                    estimatedEarningsAmount
                  )
                }
                secondary
              />
            </section>

            {/* =================================================
                PENDING AGREEMENT
            ================================================= */}

            {!agreementLoading &&
              agreement && (
                <section
                  className={`${styles.card} ${styles.agreementCard}`}
                >
                  <div
                    className={
                      styles.agreementHeader
                    }
                  >
                    <div>
                      <div
                        className={
                          styles.agreementEyebrow
                        }
                      >
                        Propunere nouă
                      </div>

                      <h2
                        className={
                          styles.cardTitle
                        }
                      >
                        Remunerația colaborării
                      </h2>

                      <p
                        className={
                          styles.cardSubtitle
                        }
                      >
                        Artfest ți-a trimis o propunere de remunerație pentru comenzile eligibile generate prin colaborarea ta.
                      </p>
                    </div>

                    <div
                      className={
                        styles.agreementPercent
                      }
                    >
                      {Number(
                        pendingCommissionPercent ||
                          0
                      ).toLocaleString(
                        "ro-RO"
                      )}
                      %
                      <span>
                        din comisionul Artfest
                      </span>
                    </div>
                  </div>

                  {agreement
                    .agreementText && (
                    <div
                      className={
                        styles.agreementText
                      }
                    >
                      {
                        agreement
                          .agreementText
                      }
                    </div>
                  )}

                  {agreementError && (
                    <div
                      className={
                        styles.inlineError
                      }
                    >
                      {agreementError}
                    </div>
                  )}

                  <div
                    className={
                      styles.agreementActions
                    }
                  >
                    <button
                      type="button"
                      className={
                        styles.secondaryButton
                      }
                      disabled={
                        agreementSaving
                      }
                      onClick={() =>
                        handleAgreementAction(
                          "decline"
                        )
                      }
                    >
                      {agreementSaving
                        ? "Se procesează..."
                        : "Refuză"}
                    </button>

                    <button
                      type="button"
                      className={
                        styles.primaryButton
                      }
                      disabled={
                        agreementSaving
                      }
                      onClick={() =>
                        handleAgreementAction(
                          "accept"
                        )
                      }
                    >
                      {agreementSaving
                        ? "Se procesează..."
                        : "Acceptă remunerația"}
                    </button>
                  </div>
                </section>
              )}

            {agreementError &&
              !agreement && (
                <div
                  className={
                    styles.inlineError
                  }
                >
                  {agreementError}
                </div>
              )}

            {/* =================================================
                QUICK ACTIONS
            ================================================= */}

            <section
              className={
                styles.card
              }
            >
              <div
                className={
                  styles.cardHeader
                }
              >
                <div>
                  <h2
                    className={
                      styles.cardTitle
                    }
                  >
                    Acțiuni rapide
                  </h2>

                  <p
                    className={
                      styles.cardSubtitle
                    }
                  >
                    Cele mai importante instrumente ale colaborării tale, într-un singur loc.
                  </p>
                </div>
              </div>

              <div
                className={
                  styles.quickActionsGrid
                }
              >
                <QuickAction
                  icon="↗"
                  title="Copiază linkul"
                  text="Trimite oamenii direct către Artfest prin linkul tău personal."
                  actionLabel={
                    copyState ===
                    "quick-url"
                      ? "Copiat ✓"
                      : "Copiază"
                  }
                  onClick={() =>
                    copyText(
                      referralUrl,
                      "quick-url"
                    )
                  }
                  disabled={
                    !referralUrl
                  }
                />

                <QuickAction
                  icon="▦"
                  title="Colecțiile mele"
                  text="Pregătește selecții de produse pe care să le promovezi."
                  actionLabel="Gestionează"
                  onClick={() =>
                    setCollectionsOpen(
                      true
                    )
                  }
                />

                <QuickAction
                  icon="%"
                  title="Coduri de reducere"
                  text="Creează și gestionează codurile promo pentru comunitatea ta."
                  actionLabel="Gestionează"
                  onClick={() =>
                    setDiscountCodesOpen(
                      true
                    )
                  }
                />

                <QuickAction
                  icon="□"
                  title="Comenzile mele"
                  text="Vezi comenzile atribuite colaborării și câștigurile generate."
                  actionLabel="Vezi comenzile"
                  badge={
                    ordersCount >
                    0
                      ? ordersCount
                      : null
                  }
                  onClick={() =>
                    setActiveTab(
                      "orders"
                    )
                  }
                />

                <QuickAction
                  icon="▤"
                  title="Fișierele mele"
                  text="Încarcă și păstrează documentele pentru colaborarea cu Artfest."
                  actionLabel="Gestionează"
                  onClick={() =>
                    setFilesOpen(
                      true
                    )
                  }
                />
              </div>
            </section>

            {/* =================================================
                AI NEVOIE DE AJUTOR? (WHATSAPP)
            ================================================= */}

            <section
              className={
                styles.card
              }
            >
              <div
                className={
                  styles.cardHeader
                }
              >
                <div>
                  <h2
                    className={
                      styles.cardTitle
                    }
                  >
                    Ai nevoie de ajutor?
                  </h2>

                  <p
                    className={
                      styles.cardSubtitle
                    }
                  >
                    Scrie-ne direct pe WhatsApp și te ajutăm cât mai
                    repede.
                  </p>
                </div>

                <a
                  href={
                    WHATSAPP_URL
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className={
                    styles.primaryButton
                  }
                >
                  Scrie-ne pe WhatsApp
                </a>
              </div>
            </section>

            {/* =================================================
                ACTIVITY
            ================================================= */}

            <section
              className={
                styles.card
              }
            >
              <div
                className={
                  styles.cardHeader
                }
              >
                <div>
                  <h2
                    className={
                      styles.cardTitle
                    }
                  >
                    Activitate
                  </h2>

                  <p
                    className={
                      styles.cardSubtitle
                    }
                  >
                    Rezultatele generate prin colaborarea ta cu Artfest.
                  </p>
                </div>
              </div>

              {hasActivity ? (
                <div
                  className={
                    styles.activityList
                  }
                >
                  <ActivityRow
                    label="Clickuri generate"
                    value={
                      clicks.toLocaleString(
                        "ro-RO"
                      )
                    }
                  />

                  <ActivityRow
                    label="Comenzi atribuite"
                    value={
                      ordersCount.toLocaleString(
                        "ro-RO"
                      )
                    }
                  />

                  <ActivityRow
                    label="Valoare vânzări"
                    value={
                      formatMoney(
                        salesAmount
                      )
                    }
                  />

                  <ActivityRow
                    label="Câștig confirmat"
                    value={
                      formatMoney(
                        earningsAmount
                      )
                    }
                  />

                  <ActivityRow
                    label="Câștig estimat"
                    value={
                      formatMoney(
                        estimatedEarningsAmount
                      )
                    }
                  />
                </div>
              ) : (
                <div
                  className={
                    styles.activityEmpty
                  }
                >
                  <div
                    className={
                      styles.activityIcon
                    }
                  >
                    ↗
                  </div>

                  <div
                    className={
                      styles.activityTitle
                    }
                  >
                    Totul este pregătit
                  </div>

                  <div
                    className={
                      styles.activityText
                    }
                  >
                    Aici vei vedea clickurile, comenzile atribuite și câștigurile generate prin linkul tău.
                  </div>
                </div>
              )}
            </section>
          </>
        )}

        {/* =====================================================
            PROMOTION
        ===================================================== */}

        {activeTab ===
          "promotion" && (
          <>
            {/* =================================================
                LINK
            ================================================= */}

            <section
              className={
                styles.card
              }
            >
              <div
                className={
                  styles.cardHeader
                }
              >
                <div>
                  <h2
                    className={
                      styles.cardTitle
                    }
                  >
                    Linkul tău de promovare
                  </h2>

                  <p
                    className={
                      styles.cardSubtitle
                    }
                  >
                    Distribuie acest link în bio, stories, postări sau videoclipuri. Vizitele și comenzile eligibile venite prin el sunt asociate profilului tău.
                  </p>
                </div>
              </div>

              <div
                className={
                  styles.referralBox
                }
              >
                <div
                  className={
                    styles.referralUrl
                  }
                >
                  {referralUrl ||
                    "—"}
                </div>

                <button
                  type="button"
                  className={
                    styles.primaryButton
                  }
                  disabled={
                    !referralUrl
                  }
                  onClick={() =>
                    copyText(
                      referralUrl,
                      "url"
                    )
                  }
                >
                  {copyState ===
                  "url"
                    ? "Link copiat ✓"
                    : "Copiază linkul"}
                </button>
              </div>

              <div
                className={
                  styles.commissionRow
                }
              >
                <span>
                  Remunerația ta
                </span>

                <strong>
                  {commissionLabel}
                </strong>
              </div>

              {!commissionConfigured && (
                <div
                  className={
                    styles.infoBox
                  }
                >
                  Condițiile de remunerare vor fi stabilite de Artfest și vor apărea aici după acceptare.
                </div>
              )}
            </section>

            {/* =================================================
                PROMOTION TOOLS
            ================================================= */}

            <section
              className={
                styles.promotionGrid
              }
            >
              <PromotionCard
                icon="▦"
                title="Colecțiile mele"
                text="Grupează produsele Artfest în selecții proprii și distribuie un singur link comunității tale."
                buttonLabel="Gestionează colecțiile"
                primary
                onClick={() =>
                  setCollectionsOpen(
                    true
                  )
                }
              />

              <PromotionCard
                icon="%"
                title="Coduri de reducere"
                text="Creează coduri promo pentru comunitatea ta și urmărește utilizarea lor."
                buttonLabel="Gestionează codurile"
                onClick={() =>
                  setDiscountCodesOpen(
                    true
                  )
                }
              />
            </section>

            {/* =================================================
                HOW IT WORKS
            ================================================= */}

            <section
              className={
                styles.card
              }
            >
              <div
                className={
                  styles.cardHeader
                }
              >
                <div>
                  <h2
                    className={
                      styles.cardTitle
                    }
                  >
                    Cum funcționează
                  </h2>

                  <p
                    className={
                      styles.cardSubtitle
                    }
                  >
                    Colaborarea ta este urmărită prin atribuirea Artfest.
                  </p>
                </div>
              </div>

              <div
                className={
                  styles.stepsGrid
                }
              >
                <StepCard
                  number="1"
                  title="Distribuie"
                  text="Folosește linkul tău Artfest în conținut, stories, bio sau postări."
                />

                <StepCard
                  number="2"
                  title="Urmărim rezultatele"
                  text="Vizitele și comenzile eligibile venite prin promovarea ta sunt asociate profilului tău."
                />

                <StepCard
                  number="3"
                  title="Primești remunerația"
                  text="Câștigul tău este calculat conform remunerației acceptate pentru colaborare."
                />
              </div>
            </section>
          </>
        )}

        {/* =====================================================
            ORDERS
        ===================================================== */}

        {activeTab ===
          "community" && (
          <Suspense fallback={null}>
            <CommunityFeaturesSection />
          </Suspense>
        )}

        {activeTab ===
          "orders" && (
          <section
            className={
              styles.card
            }
          >
            <div
              className={
                styles.ordersHeader
              }
            >
              <div>
                <h2
                  className={
                    styles.cardTitle
                  }
                >
                  Comenzi atribuite
                </h2>

                <p
                  className={
                    styles.cardSubtitle
                  }
                >
                  Aici apar comenzile eligibile atribuite colaborării tale. Datele personale ale clienților nu sunt afișate.
                </p>
              </div>

              <button
                type="button"
                className={
                  styles.secondaryButton
                }
                disabled={
                  ordersLoading
                }
                onClick={() =>
                  loadOrders({
                    force:
                      true,
                  })
                }
              >
                {ordersLoading
                  ? "Se încarcă..."
                  : "Reîncarcă"}
              </button>
            </div>

            <div
              className={
                styles.orderSummary
              }
            >
              <SummaryPill
                label="Comenzi atribuite"
                value={
                  ordersCount.toLocaleString(
                    "ro-RO"
                  )
                }
              />

              <SummaryPill
                label="Vânzări generate"
                value={
                  formatMoney(
                    salesAmount
                  )
                }
              />

              <SummaryPill
                label="Câștig confirmat"
                value={
                  formatMoney(
                    earningsAmount
                  )
                }
              />
            </div>

            {ordersError && (
              <div
                className={
                  styles.inlineError
                }
              >
                {ordersError}
              </div>
            )}

            {ordersLoading &&
            !ordersLoaded ? (
              <div
                className={
                  styles.ordersLoading
                }
              >
                Se încarcă comenzile…
              </div>
            ) : orders.length ===
              0 ? (
              <div
                className={
                  styles.ordersEmpty
                }
              >
                <div
                  className={
                    styles.ordersEmptyIcon
                  }
                >
                  □
                </div>

                <strong>
                  Nu ai încă nicio comandă atribuită
                </strong>

                <span>
                  După ce apar comenzi eligibile venite prin promovarea ta, le vei vedea aici.
                </span>
              </div>
            ) : (
              <div
                className={
                  styles.ordersList
                }
              >
                {orders.map(
                  (
                    order
                  ) => (
                    <InfluencerOrderCard
                      key={
                        order.shipmentId ||
                        order.id
                      }
                      order={
                        order
                      }
                    />
                  )
                )}
              </div>
            )}
          </section>
        )}

        {/* =====================================================
            RESOURCES
        ===================================================== */}

        {activeTab ===
          "resources" && (
          <>
            <Suspense fallback={null}>
            <InfluencerResourcesSection
              resources={
                resources
              }
              loading={
                resourcesLoading
              }
              loaded={
                resourcesLoaded
              }
              error={
                resourcesError
              }
              onReload={() =>
                loadResources({
                  force: true,
                })
              }
              onDownload={
                downloadResourceMedia
              }
              onCopy={(
                resource
              ) =>
                copyText(
                  resource.description ||
                    resource.title,
                  `resource-${resource.id}`
                )
              }
              copyState={
                copyState
              }
              onMarkPosted={
                markResourcePosted
              }
              markingPostedId={
                markingPostedId
              }
              generatedContent={
                generatedContent
              }
              initialFilters={
                initialResourceFilters
              }
            />
            </Suspense>

            <section
              className={
                styles.card
              }
            >
              <div
                className={
                  styles.resourceGrid
                }
              >
                <ResourceCard
                  icon="?"
                  title="Cum promovezi Artfest"
                  text="Folosește linkul tău personal și explică simplu comunității tale ce poate găsi pe platformă."
                  buttonLabel="Vezi promovarea"
                  onClick={() =>
                    setActiveTab(
                      "promotion"
                    )
                  }
                />
              </div>
            </section>

            {/* =================================================
                ACCOUNT
            ================================================= */}

            <section
              className={
                styles.card
              }
            >
              <div
                className={
                  styles.cardHeader
                }
              >
                <div>
                  <h2
                    className={
                      styles.cardTitle
                    }
                  >
                    Contul meu
                  </h2>

                  <p
                    className={
                      styles.cardSubtitle
                    }
                  >
                    Datele asociate profilului tău de influencer.
                  </p>
                </div>
              </div>

              <div
                className={
                  styles.accountList
                }
              >
                <AccountRow
                  label="Nume"
                  value={
                    profile.displayName ||
                    user?.name ||
                    "—"
                  }
                />

                <AccountRow
                  label="Email"
                  value={
                    user?.email ||
                    "—"
                  }
                />

                <AccountRow
                  label="Status"
                  value={
                    getStatusLabel(
                      profile.status
                    )
                  }
                />

                <AccountRow
                  label="Remunerație"
                  value={
                    commissionLabel
                  }
                />
              </div>

              <div
                className={
                  styles.accountFooter
                }
              >
                <button
                  type="button"
                  className={
                    styles.secondaryButton
                  }
                  onClick={
                    logout
                  }
                >
                  Deconectare
                </button>
              </div>
            </section>
          </>
        )}
      </div>

      {/* =====================================================
          MODAL COLECȚII
      ===================================================== */}

      {collectionsOpen && (
        <Suspense fallback={null}>
          <InfluencerCollectionsModal
            onClose={() =>
              setCollectionsOpen(
                false
              )
            }
          />
        </Suspense>
      )}

      {/* =====================================================
          MODAL CODURI REDUCERE
      ===================================================== */}

      {discountCodesOpen && (
        <Suspense fallback={null}>
          <InfluencerDiscountCodesModal
            onClose={() =>
              setDiscountCodesOpen(
                false
              )
            }
          />
        </Suspense>
      )}

      {/* =====================================================
          MODAL FIȘIERELE MELE
      ===================================================== */}

      {filesOpen && (
        <Suspense fallback={null}>
          <InfluencerFilesModal
            onClose={() =>
              setFilesOpen(
                false
              )
            }
          />
        </Suspense>
      )}

      {/* =====================================================
          GATE: ACORD PROGRAM ACTUALIZAT
          Blocant - fără buton de închidere. Nu ne bazăm doar pe
          acesta: enforceInfluencerTermsGate revalidează server-side
          pe fiecare acțiune comercială.
      ===================================================== */}

      <PolicyGate
        scope={policyGateScope}
        isOpen={policyGateOpen}
        onClose={closePolicyGate}
        onStatusChange={setPolicyGateBlocked}
        closeOnOverlay={false}
        closeOnEsc={false}
      />

      {data?.terms?.outdated &&
        !(termsDismissed && data.terms.blocking === false) && (
          <Suspense fallback={null}>
            <InfluencerTermsGateModal
              terms={data.terms}
              onAccepted={handleTermsAccepted}
              onDismiss={
                data.terms.blocking === false
                  ? handleTermsDismiss
                  : undefined
              }
            />
          </Suspense>
        )}
    </main>
  );
}

/* =========================================================
   COLABORARE ARTFEST

   Sursa datelor este STRICT backend-ul (GET /api/influencer/me ->
   collaboration, vezi services/influencerCollaboration.js).
   Frontendul doar afiseaza - nu recalculeaza perioada sau statusul.
========================================================= */

const COLLABORATION_STATUS_LABEL = {
  ACTIVE: "Activă",
  EXPIRED: "Expirată",
  DISABLED: "Dezactivată",
};

function formatCollaborationDate(value) {
  if (!value) {
    return "—";
  }

  try {
    return new Date(value).toLocaleDateString("ro-RO", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

function CollaborationCard({ collaboration }) {
  if (!collaboration) {
    return null;
  }

  const {
    collaborationStatus,
    collaborationStart,
    collaborationEnd,
    commissionPercent,
    notice,
    expiringSoon,
    expiringSoonNotice,
  } = collaboration;

  const statusLabel =
    COLLABORATION_STATUS_LABEL[collaborationStatus] ||
    collaborationStatus ||
    "—";

  const statusClassName =
    collaborationStatus === "ACTIVE"
      ? styles.orderStatusPositive
      : collaborationStatus === "EXPIRED"
        ? styles.orderStatusNegative
        : styles.orderStatusPending;

  const badgeClassName = [styles.orderStatus, statusClassName].join(" ");

  return (
    <section className={styles.card}>
      <div className={styles.cardHeader}>
        <div>
          <h2 className={styles.cardTitle}>Colaborare Artfest</h2>

          <p className={styles.cardSubtitle}>
            {formatCollaborationDate(collaborationStart)} –{" "}
            {formatCollaborationDate(collaborationEnd)}
          </p>
        </div>

        <span className={badgeClassName}>
          {statusLabel}
        </span>
      </div>

      <div className={styles.commissionRow}>
        <span>Remunerație actuală</span>

        <strong>
          {Number(commissionPercent || 0).toLocaleString("ro-RO")}%
        </strong>
      </div>

      {notice && <div className={styles.infoBox}>{notice}</div>}

      {expiringSoon && expiringSoonNotice && (
        <div className={styles.collaborationExpiringNotice}>
          {expiringSoonNotice}
        </div>
      )}
    </section>
  );
}

/* =========================================================
   STAT CARD
========================================================= */

function StatCard({
  label,
  value,
  secondary =
    false,
}) {
  return (
    <div
      className={`${styles.statCard} ${
        secondary
          ? styles.statCardSecondary
          : ""
      }`}
    >
      <div
        className={
          styles.statLabel
        }
      >
        {label}
      </div>

      <div
        className={
          styles.statValue
        }
      >
        {value}
      </div>
    </div>
  );
}

/* =========================================================
   QUICK ACTION
========================================================= */

function QuickAction({
  icon,
  title,
  text,
  actionLabel,
  onClick,
  disabled =
    false,
  badge =
    null,
}) {
  return (
    <div
      className={
        styles.quickAction
      }
    >
      <div
        className={
          styles.quickActionTop
        }
      >
        <div
          className={
            styles.quickActionIcon
          }
        >
          {icon}
        </div>

        {badge !==
          null && (
          <span
            className={
              styles.quickActionBadge
            }
          >
            {badge}
          </span>
        )}
      </div>

      <div
        className={
          styles.quickActionTitle
        }
      >
        {title}
      </div>

      <div
        className={
          styles.quickActionText
        }
      >
        {text}
      </div>

      <button
        type="button"
        className={
          styles.quickActionButton
        }
        onClick={
          onClick
        }
        disabled={
          disabled
        }
      >
        {actionLabel}
        <span>
          →
        </span>
      </button>
    </div>
  );
}

/* =========================================================
   PROMOTION CARD
========================================================= */

function PromotionCard({
  icon,
  title,
  text,
  buttonLabel,
  onClick,
  primary =
    false,
}) {
  return (
    <div
      className={
        styles.promotionCard
      }
    >
      <div
        className={
          styles.promotionCardIcon
        }
      >
        {icon}
      </div>

      <h3
        className={
          styles.promotionCardTitle
        }
      >
        {title}
      </h3>

      <p
        className={
          styles.promotionCardText
        }
      >
        {text}
      </p>

      <button
        type="button"
        className={
          primary
            ? styles.primaryButton
            : styles.secondaryButton
        }
        onClick={
          onClick
        }
      >
        {buttonLabel}
      </button>
    </div>
  );
}

/* =========================================================
   RESOURCE CARD
========================================================= */

function ResourceCard({
  icon,
  eyebrow,
  title,
  text,
  buttonLabel,
  onClick,
}) {
  return (
    <div
      className={
        styles.resourceCard
      }
    >
      <div
        className={
          styles.resourceHeader
        }
      >
        <div
          className={
            styles.resourceIcon
          }
        >
          {icon}
        </div>

        {eyebrow && (
          <span
            className={
              styles.resourceEyebrow
            }
          >
            {eyebrow}
          </span>
        )}
      </div>

      <h3
        className={
          styles.resourceTitle
        }
      >
        {title}
      </h3>

      <p
        className={
          styles.resourceText
        }
      >
        {text}
      </p>

      {buttonLabel &&
        onClick && (
          <button
            type="button"
            className={
              styles.resourceButton
            }
            onClick={
              onClick
            }
          >
            {buttonLabel}
            <span>
              →
            </span>
          </button>
        )}
    </div>
  );
}

/* =========================================================
   ORDER CARD
========================================================= */

function InfluencerOrderCard({
  order,
}) {
  const orderNumber =
    order.orderNumber ||
    order.order?.orderNumber ||
    "—";

  const createdAt =
    order.createdAt ||
    order.order?.createdAt;

  const attributedAt =
    order.influencerAttributedAt ||
    order.attributedAt;

  const status =
    order.status ||
    order.shipmentStatus ||
    "—";

  const eligibleItemsNet =
    Number(
      order
        .eligibleItemsNet ||
        0
    );

  const artfestCommissionNet =
    Number(
      order
        .artfestCommissionNet ||
        0
    );

  const earningNet =
    Number(
      order
        .earningNet ||
        0
    );

  const commissionBps =
    Number(
      order
        .commissionBpsSnapshot ||
        0
    );

  const commissionPercent =
    commissionBps /
    100;

  const sourceLabel =
    order.attributionSource === "DISCOUNT_CODE"
      ? "Cod de reducere"
      : "Referral (link)";

  const earningLabel =
    order.earningStatus === "CONFIRMED"
      ? "Câștig confirmat"
      : order.earningStatus === "REVERSED"
      ? "Câștig confirmat (reversat)"
      : order.earningStatus === "CANCELLED"
      ? "Câștig (anulat)"
      : "Câștig estimat";

  return (
    <article
      className={
        styles.orderCard
      }
    >
      <div
        className={
          styles.orderCardHeader
        }
      >
        <div>
          <div
            className={
              styles.orderNumber
            }
          >
            Comanda{" "}
            {orderNumber}
          </div>

          <div
            className={
              styles.orderDate
            }
          >
            {formatDate(
              createdAt
            )}
          </div>
        </div>

        <span
          className={`${styles.orderStatus} ${getOrderStatusClass(
            status
          )}`}
        >
          {getOrderStatusLabel(
            status
          )}
        </span>
      </div>

      <div
        className={
          styles.orderMeta
        }
      >
        <OrderMetaItem
          label="Valoare eligibilă"
          value={
            formatMoney(
              eligibleItemsNet
            )
          }
        />

        <OrderMetaItem
          label="Comision Artfest"
          value={
            formatMoney(
              artfestCommissionNet
            )
          }
        />

        <OrderMetaItem
          label="Procentul tău"
          value={
            commissionPercent >
            0
              ? `${commissionPercent.toLocaleString(
                  "ro-RO"
                )}%`
              : "—"
          }
        />

        <OrderMetaItem
          label={earningLabel}
          value={
            formatMoney(
              earningNet
            )
          }
          strong
        />
      </div>

      <div
        className={
          styles.orderAttribution
        }
      >
        Sursă: {sourceLabel}
        {order.discountCodeText && (
          <>
            {" "}
            · Cod: <strong>{order.discountCodeText}</strong>
          </>
        )}
      </div>

      {attributedAt && (
        <div
          className={
            styles.orderAttribution
          }
        >
          Atribuită colaborării tale la{" "}
          {formatDate(
            attributedAt
          )}
        </div>
      )}
    </article>
  );
}

/* =========================================================
   ORDER META
========================================================= */

function OrderMetaItem({
  label,
  value,
  strong =
    false,
}) {
  return (
    <div
      className={
        styles.orderMetaItem
      }
    >
      <span>
        {label}
      </span>

      <strong
        className={
          strong
            ? styles.orderMetaStrong
            : ""
        }
      >
        {value}
      </strong>
    </div>
  );
}

/* =========================================================
   SUMMARY PILL
========================================================= */

function SummaryPill({
  label,
  value,
}) {
  return (
    <div
      className={
        styles.summaryPill
      }
    >
      <span>
        {label}
      </span>

      <strong>
        {value}
      </strong>
    </div>
  );
}

/* =========================================================
   STEP CARD
========================================================= */

function StepCard({
  number,
  title,
  text,
}) {
  return (
    <div
      className={
        styles.stepCard
      }
    >
      <div
        className={
          styles.stepNumber
        }
      >
        {number}
      </div>

      <div>
        <div
          className={
            styles.stepTitle
          }
        >
          {title}
        </div>

        <div
          className={
            styles.stepText
          }
        >
          {text}
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   ACTIVITY ROW
========================================================= */

function ActivityRow({
  label,
  value,
}) {
  return (
    <div
      className={
        styles.activityRow
      }
    >
      <span
        className={
          styles.activityRowLabel
        }
      >
        {label}
      </span>

      <strong
        className={
          styles.activityRowValue
        }
      >
        {value}
      </strong>
    </div>
  );
}

/* =========================================================
   ACCOUNT ROW
========================================================= */

function AccountRow({
  label,
  value,
}) {
  return (
    <div
      className={
        styles.accountRow
      }
    >
      <span
        className={
          styles.accountLabel
        }
      >
        {label}
      </span>

      <span
        className={
          styles.accountValue
        }
      >
        {value}
      </span>
    </div>
  );
}

/* =========================================================
   STATUS
========================================================= */

function getStatusLabel(
  status
) {
  switch (
    String(
      status ||
        ""
    ).toUpperCase()
  ) {
    case "ACTIVE":
      return "Activ";

    case "DISABLED":
      return "Dezactivat";

    default:
      return (
        status ||
        "—"
      );
  }
}

/* =========================================================
   ORDER STATUS
========================================================= */

function getOrderStatusLabel(
  status
) {
  switch (
    String(
      status ||
        ""
    ).toUpperCase()
  ) {
    case "PENDING":
      return "În așteptare";

    case "PREPARING":
      return "În pregătire";

    case "READY_FOR_PICKUP":
      return "Pregătită";

    case "PICKUP_SCHEDULED":
      return "Curier programat";

    case "AWB":
      return "AWB creat";

    case "IN_TRANSIT":
      return "În tranzit";

    case "DELIVERED":
      return "Livrată";

    case "REFUSED":
      return "Refuzată";

    case "RETURNED":
      return "Returnată";

    case "CANCELLED":
    case "CANCELED":
      return "Anulată";

    default:
      return (
        status ||
        "—"
      );
  }
}

function getOrderStatusClass(
  status
) {
  const normalized =
    String(
      status ||
        ""
    ).toUpperCase();

  if (
    normalized ===
      "DELIVERED" ||
    normalized ===
      "IN_TRANSIT"
  ) {
    return styles.orderStatusPositive;
  }

  if (
    normalized ===
      "RETURNED" ||
    normalized ===
      "REFUSED" ||
    normalized ===
      "CANCELLED" ||
    normalized ===
      "CANCELED"
  ) {
    return styles.orderStatusNegative;
  }

  return styles.orderStatusPending;
}

/* =========================================================
   DATE
========================================================= */

function formatDate(
  value
) {
  if (!value) {
    return "—";
  }

  try {
    return new Date(
      value
    ).toLocaleString(
      "ro-RO",
      {
        day:
          "2-digit",

        month:
          "2-digit",

        year:
          "numeric",

        hour:
          "2-digit",

        minute:
          "2-digit",
      }
    );
  } catch {
    return "—";
  }
}

/* =========================================================
   MONEY
========================================================= */

function formatMoney(
  value
) {
  return new Intl.NumberFormat(
    "ro-RO",
    {
      style:
        "currency",

      currency:
        "RON",

      minimumFractionDigits:
        2,
    }
  ).format(
    Number(
      value ||
        0
    )
  );
}