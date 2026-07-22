import {
  useEffect,
  useMemo,
  useState,
} from "react";

import { api } from "../../../../../lib/api";

import styles from "./css/PaymentTab.module.css";

import {
  useCurrentSubscription,
} from "../hooks/useCurrentSubscriptionBanner.js";

/* =========================================================
   Link-uri legale
========================================================= */

const LEGAL_LINKS = {
  vendorTerms: "/acord-vanzatori",
  billingTerms: "/abonamente-si-facturare",
  privacy: "/confidentialitate",
};

/* =========================================================
   Comisioane
========================================================= */

const FEES = {
  basic: {
    productsBps: 1200,
    minFeeCentsPerOrder: 0,
  },

  pro: {
    productsBps: 800,
    minFeeCentsPerOrder: 0,
  },

  premium: {
    productsBps: 500,
    minFeeCentsPerOrder: 0,
  },
};

/* =========================================================
   Fallback planuri

   Este important ca fallback-ul să respecte aceeași
   configurație ca backend-ul.

   Basic:
   - gratuit;
   - activ;
   - nelimitat;
   - toate funcționalitățile.

   Pro/Premium:
   - indisponibile momentan.
========================================================= */

const DEFAULT_PLANS = [
  {
    id: "local-basic",

    code: "basic",

    name: "Basic",

    priceCents: 0,

    currency: "RON",

    interval: "month",

    isActive: true,

    popular: true,

    trialDays: 0,

    features: [
      "Magazine nelimitate",
      "Produse nelimitate",
      "Chat cu clienții nelimitat",
      "Atașamente nelimitate",
      "CRM complet (note interne, follow-up, atașamente)",
      "Recenzii",
      "Profil public",
      "Badge verificat",
      "Prioritate în listări",
      "Statistici complete",
      "Lead-uri nelimitate",
      "Suport prioritar",
    ],

    meta: {
      commissions: FEES.basic,

      limits: {
        stores: -1,
        products: -1,
        leadsPerMonth: -1,
        chatMessagesPerMonth: -1,
        attachmentsPerMonth: -1,
      },

      capabilities: {
        shareLink: true,
        chat: true,
        attachments: true,
        advancedChat: true,
        serviceSalesEnabled: false,
      },
    },
  },

  {
    id: "local-pro",

    code: "pro",

    name: "Pro",

    priceCents: 5900,

    currency: "RON",

    interval: "month",

    isActive: false,

    popular: false,

    trialDays: 0,

    features: [
      "2 magazine incluse",
      "Produse nelimitate",
      "Chat cu clienții nelimitat",
      "Atașamente nelimitate",
      "10 lead-uri / lună",
      "Suport prioritar",
    ],

    meta: {
      commissions: FEES.pro,

      limits: {
        products: -1,
        stores: 2,
      },

      capabilities: {
        shareLink: true,
        chat: true,
        attachments: true,
        advancedChat: false,
        serviceSalesEnabled: false,
      },
    },
  },

  {
    id: "local-premium",

    code: "premium",

    name: "Premium",

    priceCents: 14900,

    currency: "RON",

    interval: "month",

    isActive: false,

    popular: false,

    trialDays: 0,

    features: [
      "3 magazine incluse",
      "Produse nelimitate",
      "CRM complet (note + follow-up + atașamente)",
      "Badge verificat",
      "Prioritate în listări",
      "Statistici complete",
      "Lead-uri nelimitate",
      "Suport dedicat",
    ],

    meta: {
      commissions: FEES.premium,

      limits: {
        products: -1,
        stores: 3,
      },

      capabilities: {
        shareLink: true,
        chat: true,
        attachments: true,
        advancedChat: true,
        serviceSalesEnabled: false,
      },
    },
  },
];

/* =========================================================
   Helpers
========================================================= */

function formatPrice(
  cents,
  currency = "RON"
) {
  if (cents === 0) {
    return "Gratuit";
  }

  try {
    return new Intl.NumberFormat(
      "ro-RO",
      {
        style: "currency",
        currency,
      }
    ).format(
      cents / 100
    );
  } catch {
    return `${
      (cents / 100).toFixed(2)
    } ${currency}`;
  }
}

function bpsToPct(bps) {
  return (
    (bps / 100).toFixed(
      bps % 100 ? 2 : 0
    ) + "%"
  );
}

function absolutizeUrl(url) {
  if (
    /^https?:\/\//i.test(url)
  ) {
    return url;
  }

  const API_BASE = (
    import.meta.env?.VITE_API_URL ||
    "http://localhost:5000"
  ).replace(
    /\/+$/,
    ""
  );

  const APP_BASE = (
    import.meta.env?.VITE_APP_URL ||
    window.location.origin
  ).replace(
    /\/+$/,
    ""
  );

  const base =
    url.startsWith("/api/")
      ? API_BASE
      : APP_BASE;

  return `${base}${
    url.startsWith("/")
      ? ""
      : "/"
  }${url}`;
}

function getLegalUrl(path) {
  return absolutizeUrl(path);
}

/* =========================================================
   Erori
========================================================= */

function billingErrorMessage(e) {
  const code =
    e?.data?.error ||
    e?.data?.message ||
    e?.message;

  if (
    code ===
    "plan_inactive"
  ) {
    return "Planul selectat nu este disponibil momentan.";
  }

  if (
    code ===
    "plan_not_found"
  ) {
    return "Planul selectat nu a fost găsit.";
  }

  if (
    code ===
    "vendor_profile_missing"
  ) {
    return "Nu am găsit profilul de vânzător pentru acest cont.";
  }

  if (
    code ===
    "basic_activation_failed"
  ) {
    return "Planul Basic gratuit nu a putut fi activat.";
  }

  if (
    code ===
    "free_plan_cannot_be_canceled"
  ) {
    return "Planul Basic este gratuit și rămâne activ automat.";
  }

  return (
    e?.data?.message ||
    e?.message ||
    "Nu s-a putut actualiza abonamentul."
  );
}

/* =========================================================
   Hook planuri
========================================================= */

function usePlans() {
  const [
    plans,
    setPlans,
  ] = useState([]);

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    err,
    setErr,
  ] = useState("");

  useEffect(
    () => {
      let alive = true;

      (async () => {
        try {
          setLoading(true);

          setErr("");

          const d =
            await api(
              "/api/billing/plans",
              {
                method: "GET",
              }
            );

          const items =
            Array.isArray(
              d?.items
            ) &&
            d.items.length
              ? d.items
              : DEFAULT_PLANS;

          if (!alive) {
            return;
          }

          setPlans(
            items
          );
        } catch (e) {
          if (!alive) {
            return;
          }

          setPlans(
            DEFAULT_PLANS
          );

          setErr(
            e?.message ||
              "Nu am putut încărca planurile; folosesc lista implicită."
          );
        } finally {
          if (alive) {
            setLoading(
              false
            );
          }
        }
      })();

      return () => {
        alive = false;
      };
    },
    []
  );

  const enriched =
    useMemo(
      () => {
        return (
          plans || []
        ).map(
          (p) => {
            const fromMeta =
              p?.meta
                ?.commissions ||
              p?.commissions;

            const fallback =
              FEES[p.code] ||
              FEES.basic;

            return {
              ...p,

              popular:
                p.popular ??
                false,

              fees: {
                productsBps:
                  fromMeta
                    ?.productsBps ??
                  fallback
                    .productsBps,

                minFeeCentsPerOrder:
                  fromMeta
                    ?.minFeeCentsPerOrder ??
                  fallback
                    .minFeeCentsPerOrder,
              },

              serviceSalesEnabled:
                !!p?.meta
                  ?.capabilities
                  ?.serviceSalesEnabled,

              shareLinkEnabled:
                p?.meta
                  ?.capabilities
                  ?.shareLink !==
                false,

              isActive:
                p.isActive !==
                false,

              storeLimit:
                p?.meta
                  ?.limits
                  ?.stores ??
                null,
            };
          }
        );
      },
      [plans]
    );

  return {
    plans: enriched,
    loading,
    err,
  };
}

/* =========================================================
   Componentă abonament
========================================================= */

function SubscriptionPayment({
  obSessionId,
}) {
  const {
    plans,
    loading: plansLoading,
    err: plansErr,
  } = usePlans();

  const {
    sub,
    loading: subLoading,
    setSub,
  } =
    useCurrentSubscription();

  const KEY_PLAN =
    `onboarding.plan:${
      obSessionId ||
      "default"
    }`;

  const ss =
    useMemo(
      () => {
        return {
          get(k) {
            try {
              if (
                typeof window ===
                "undefined"
              ) {
                return null;
              }

              return window.sessionStorage.getItem(
                k
              );
            } catch {
              return null;
            }
          },

          set(k, v) {
            try {
              if (
                typeof window ===
                "undefined"
              ) {
                return;
              }

              window.sessionStorage.setItem(
                k,
                v
              );
            } catch {
              // ignore
            }
          },
        };
      },
      []
    );

  /*
   * Basic este planul implicit.
   */
  const [
    plan,
    setPlan,
  ] = useState(
    () =>
      ss.get(
        KEY_PLAN
      ) ||
      "basic"
  );

  const [
    expanded,
    setExpanded,
  ] = useState({});

  const [
    status,
    setStatus,
  ] = useState(
    "idle"
  );

  const [
    err,
    setErr,
  ] = useState("");

  /*
   * Sincronizăm planul curent primit din backend.
   */
  useEffect(
    () => {
      if (
        sub?.plan?.code
      ) {
        setPlan(
          sub.plan.code
        );

        ss.set(
          KEY_PLAN,
          sub.plan.code
        );
      }
    },
    [
      sub?.plan?.code,
      KEY_PLAN,
      ss,
    ]
  );

  /*
   * Dacă planul memorat nu mai este disponibil,
   * selectăm automat Basic / primul plan activ.
   */
  useEffect(
    () => {
      if (
        !plans.length
      ) {
        return;
      }

      const current =
        plans.find(
          (p) =>
            p.code ===
            plan
        );

      if (
        !current ||
        current.isActive ===
          false
      ) {
        const basic =
          plans.find(
            (p) =>
              p.code ===
                "basic" &&
              p.isActive !==
                false
          );

        const firstActive =
          basic ||
          plans.find(
            (p) =>
              p.isActive !==
              false
          ) ||
          plans[0];

        if (
          firstActive
        ) {
          setPlan(
            firstActive.code
          );

          ss.set(
            KEY_PLAN,
            firstActive.code
          );
        }
      }
    },
    [
      plans,
      plan,
      KEY_PLAN,
      ss,
    ]
  );

  const selectedPlan =
    useMemo(
      () =>
        plans.find(
          (p) =>
            p.code ===
            plan
        ) ||
        null,
      [
        plans,
        plan,
      ]
    );

  /*
   * =========================================================
   * Activare Basic
   * =========================================================
   */

  async function activateBasic() {
    try {
      if (
        !selectedPlan ||
        selectedPlan.code !==
          "basic" ||
        selectedPlan.isActive ===
          false
      ) {
        return;
      }

      setStatus(
        "processing"
      );

      setErr("");

      const resp =
        await api(
          "/api/billing/checkout?plan=basic&period=month",
          {
            method:
              "POST",
          }
        );

      if (
        resp?.subscription
      ) {
        setSub(
          resp.subscription
        );
      }

      /*
       * Dacă backend-ul trimite URL-ul de succes,
       * îl folosim.
       */
      if (
        resp?.url
      ) {
        window.location.assign(
          absolutizeUrl(
            resp.url
          )
        );

        return;
      }

      setStatus(
        "idle"
      );
    } catch (e) {
      console.error(
        "basic activation failed:",
        e
      );

      setErr(
        billingErrorMessage(
          e
        )
      );

      setStatus(
        "idle"
      );
    }
  }

  const sameActivePlan =
    !!sub?.plan?.code &&
    sub.plan.code ===
      plan &&
    sub?.status ===
      "active";

  const isBasic =
    selectedPlan?.code ===
    "basic";

  const disableActivation =
    status ===
      "processing" ||
    !selectedPlan ||
    selectedPlan.isActive ===
      false ||
    sameActivePlan;

  const FEATURE_COLLAPSE_AT =
    8;

  /* =========================================================
     Render
  ========================================================= */

  return (
    <div
      className={
        styles.form
      }
    >
      <header
        className={
          styles.header
        }
      >
        <h2
          className={
            styles.cardTitle
          }
        >
          Abonament
        </h2>

        {subLoading ? (
          <span
            className={
              styles.badgeWait
            }
          >
            Se încarcă
            abonamentul
            curent…
          </span>
        ) : sub?.status ===
          "active" ? (
          <span
            className={
              styles.badgeOk
            }
          >
            Plan curent:{" "}
            {sub.plan?.name ||
              sub.plan?.code}

            {sub?.plan
              ?.code ===
              "basic"
              ? " • plan gratuit activ"
              : ""}
          </span>
        ) : (
          <span
            className={
              styles.help
            }
          >
            Planul Basic
            gratuit va fi
            activat automat.
          </span>
        )}
      </header>

      {/* =====================================================
          Mesaj informativ
      ====================================================== */}

      <div
        className={
          styles.shareHint
        }
        style={{
          marginBottom: 16,
        }}
      >
        <strong>
          În această perioadă,
          planul Basic este
          gratuit și include
          toate funcționalitățile
          platformei.
        </strong>

        {" "}

        Planurile Pro și
        Premium sunt
        indisponibile
        momentan.
      </div>

      {/* =====================================================
          Erori încărcare planuri
      ====================================================== */}

      {plansErr && (
        <div
          className={
            styles.error
          }
          role="alert"
        >
          {plansErr}
        </div>
      )}

      {/* =====================================================
          Planuri
      ====================================================== */}

      {plansLoading ? (
        <div
          className={
            styles.card
          }
        >
          Se încarcă
          planurile…
        </div>
      ) : (
        <div
          className={
            styles.grid
          }
        >
          {plans.map(
            (p) => {
              const selected =
                plan ===
                p.code;

              const disabled =
                p.isActive ===
                false;

              const {
                productsBps,
                minFeeCentsPerOrder,
              } =
                p.fees ||
                {};

              const feats =
                Array.isArray(
                  p.features
                )
                  ? p.features
                  : [];

              const isExpanded =
                !!expanded[
                  p.code
                ];

              const showToggle =
                feats.length >
                FEATURE_COLLAPSE_AT;

              const visibleFeats =
                showToggle &&
                !isExpanded
                  ? feats.slice(
                      0,
                      FEATURE_COLLAPSE_AT
                    )
                  : feats;

              const radioId =
                `plan-${p.code}`;

              const onSelectPlan =
                () => {
                  if (
                    disabled
                  ) {
                    return;
                  }

                  setPlan(
                    p.code
                  );

                  ss.set(
                    KEY_PLAN,
                    p.code
                  );
                };

              return (
                <div
                  key={
                    p.id ||
                    p.code
                  }
                  className={[
                    styles.card,

                    selected
                      ? styles.cardSelected
                      : "",

                    disabled
                      ? styles.cardDisabled
                      : "",
                  ].join(
                    " "
                  )}
                  title={
                    disabled
                      ? "Plan indisponibil momentan"
                      : undefined
                  }
                  role="radio"
                  aria-checked={
                    selected
                  }
                  aria-disabled={
                    disabled
                  }
                  tabIndex={
                    disabled
                      ? -1
                      : 0
                  }
                  onClick={
                    onSelectPlan
                  }
                  onKeyDown={(
                    e
                  ) => {
                    if (
                      disabled
                    ) {
                      return;
                    }

                    if (
                      e.key ===
                        "Enter" ||
                      e.key ===
                        " "
                    ) {
                      e.preventDefault();

                      onSelectPlan();
                    }
                  }}
                >
                  {p.popular &&
                    !disabled && (
                      <span
                        className={
                          styles.badgeWait +
                          " " +
                          styles.cardBadge
                        }
                      >
                        Recomandat
                      </span>
                    )}

                  {disabled && (
                    <span
                      className={
                        styles.badgeMuted +
                        " " +
                        styles.cardBadge
                      }
                    >
                      Indisponibil
                      momentan
                    </span>
                  )}

                  <div
                    className={
                      styles.cardTop
                    }
                  >
                    <div
                      className={
                        styles.planName
                      }
                    >
                      {p.name}
                    </div>

                    <div
                      className={
                        styles.planPrice
                      }
                    >
                      {p.priceCents ===
                      0
                        ? "Gratuit"
                        : `${formatPrice(
                            p.priceCents,
                            p.currency
                          )} / lună`}
                    </div>
                  </div>

                  {/* =========================================
                      Comision
                  ========================================== */}

                  <div
                    className={
                      styles.feesRow
                    }
                    title="Comisioane platformă"
                  >
                    <span
                      className={
                        styles.help
                      }
                    >
                      Produse:{" "}
                      {bpsToPct(
                        productsBps ||
                          0
                      )}

                      {typeof minFeeCentsPerOrder ===
                        "number" &&
                      minFeeCentsPerOrder >
                        0
                        ? ` (min. ${formatPrice(
                            minFeeCentsPerOrder,
                            p.currency ||
                              "RON"
                          )} / comandă)`
                        : ""}
                    </span>

                    <span
                      className={`${styles.help} ${styles.muted}`}
                    >
                      Servicii:
                      indisponibil
                      momentan
                    </span>
                  </div>

                  {/* =========================================
                      Link distribuire
                  ========================================== */}

                  {p.shareLinkEnabled && (
                    <div
                      className={
                        styles.shareHint
                      }
                    >
                      Include{" "}
                      <strong>
                        link de
                        distribuire
                      </strong>{" "}
                      pentru
                      promovare
                      rapidă.
                    </div>
                  )}

                  {/* =========================================
                      Beneficii
                  ========================================== */}

                  {feats.length >
                    0 && (
                    <>
                      <ul
                        className={
                          styles.featuresList
                        }
                      >
                        {visibleFeats.map(
                          (
                            f,
                            i
                          ) => (
                            <li
                              key={
                                i
                              }
                            >
                              {f}
                            </li>
                          )
                        )}
                      </ul>

                      {showToggle && (
                        <button
                          type="button"
                          className={
                            styles.moreBtn
                          }
                          onClick={(
                            e
                          ) => {
                            e.preventDefault();

                            e.stopPropagation();

                            setExpanded(
                              (
                                prev
                              ) => ({
                                ...prev,

                                [p.code]:
                                  !prev[
                                    p
                                      .code
                                  ],
                              })
                            );
                          }}
                          onMouseDown={(
                            e
                          ) =>
                            e.stopPropagation()
                          }
                          onPointerDown={(
                            e
                          ) =>
                            e.stopPropagation()
                          }
                          aria-expanded={
                            isExpanded
                          }
                        >
                          {isExpanded
                            ? "Arată mai puțin"
                            : `Vezi toate (${feats.length})`}

                          <span
                            aria-hidden="true"
                            className={[
                              styles.moreChevron,

                              isExpanded
                                ? styles.moreChevronUp
                                : "",
                            ].join(
                              " "
                            )}
                          >
                            ▾
                          </span>
                        </button>
                      )}
                    </>
                  )}

                  {/* =========================================
                      Selectare
                  ========================================== */}

                  <div
                    className={
                      styles.pickRow
                    }
                  >
                    <input
                      id={
                        radioId
                      }
                      type="radio"
                      name="plan"
                      value={
                        p.code
                      }
                      checked={
                        selected
                      }
                      disabled={
                        disabled
                      }
                      onChange={
                        onSelectPlan
                      }
                      onClick={(
                        e
                      ) =>
                        e.stopPropagation()
                      }
                    />

                    <label
                      htmlFor={
                        radioId
                      }
                      onClick={(
                        e
                      ) =>
                        e.stopPropagation()
                      }
                    >
                      {disabled
                        ? "În curând"
                        : p.code ===
                            "basic"
                          ? "Plan gratuit"
                          : `Alege ${p.name}`}
                    </label>
                  </div>

                  {sub?.status ===
                    "active" &&
                    sub.plan
                      ?.code ===
                      p.code && (
                      <small
                        className={
                          styles.help
                        }
                      >
                        Planul tău
                        actual
                      </small>
                    )}
                </div>
              );
            }
          )}
        </div>
      )}

      {/* =====================================================
          Erori
      ====================================================== */}

      {err && (
        <div
          className={
            styles.error
          }
          role="alert"
          style={{
            marginTop: 8,
          }}
        >
          {err}
        </div>
      )}

      {/* =====================================================
          Acțiuni
      ====================================================== */}

      <div
        className={
          styles.actionsRow
        }
      >
        {isBasic &&
          !sameActivePlan && (
            <button
              className={
                styles.primaryBtn
              }
              onClick={
                activateBasic
              }
              disabled={
                disableActivation
              }
              type="button"
            >
              {status ===
              "processing"
                ? "Se activează…"
                : "Activează planul gratuit"}
            </button>
          )}

        {isBasic &&
          sameActivePlan && (
            <button
              className={
                styles.primaryBtn
              }
              type="button"
              disabled
            >
              Plan Basic activ
            </button>
          )}

        {/* ===================================================
            Mesaj Basic
        ==================================================== */}

        {isBasic && (
          <div
            className={
              styles.shareHint
            }
            style={{
              width: "100%",
            }}
          >
            Planul Basic este
            gratuit și rămâne
            activ automat.

            {" "}

            Nu este necesară
            introducerea unui
            card și nu există
            reînnoire automată
            cu plată.
          </div>
        )}

        {/* ===================================================
            Legal
        ==================================================== */}

        <div
          className={
            styles.legalBox ??
            ""
          }
          style={{
            width: "100%",
          }}
        >
          <small
            className={
              styles.help
            }
            style={{
              display:
                "block",

              marginTop:
                8,
            }}
          >
            <a
              href={getLegalUrl(
                LEGAL_LINKS.vendorTerms
              )}
              target="_blank"
              rel="noreferrer"
            >
              Acord
              vânzători
            </a>

            {" · "}

            <a
              href={getLegalUrl(
                LEGAL_LINKS.billingTerms
              )}
              target="_blank"
              rel="noreferrer"
            >
              Abonamente și
              facturare
            </a>

            {" · "}

            <a
              href={getLegalUrl(
                LEGAL_LINKS.privacy
              )}
              target="_blank"
              rel="noreferrer"
            >
              Politica de
              confidențialitate
            </a>
          </small>
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   Export
========================================================= */

export default function PaymentTab({
  obSessionId,
}) {
  return (
    <div
      role="tabpanel"
      className={
        styles.tabPanel
      }
      aria-labelledby="tab-plata"
    >
      <SubscriptionPayment
        obSessionId={
          obSessionId
        }
      />
    </div>
  );
}