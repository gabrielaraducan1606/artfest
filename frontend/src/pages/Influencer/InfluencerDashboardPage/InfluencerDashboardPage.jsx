import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  useNavigate,
} from "react-router-dom";

import { api } from "../../../lib/api.js";

import InfluencerCollectionsModal
  from "../components/InfluencerCollectionsModal.jsx";

import InfluencerDiscountCodesModal
  from "../components/InfluencerDiscountCodesModal.jsx";

import styles from "./InfluencerDashboardPage.module.css";

export default function InfluencerDashboardPage() {
  const navigate =
    useNavigate();

  /* =========================================================
     DASHBOARD STATE
  ========================================================= */

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

  /* =========================================================
     LOAD DASHBOARD
  ========================================================= */

  useEffect(() => {
    let active = true;

    async function loadDashboard() {
      setLoading(true);
      setError("");

      try {
        const response =
          await api(
            "/api/influencer/me"
          );

        if (!active) {
          return;
        }

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
      } catch (
        loadError
      ) {
        if (!active) {
          return;
        }

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

          return;
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

          return;
        }

        setError(
          loadError?.data
            ?.message ||
            loadError?.message ||
            "Nu am putut încărca dashboardul."
        );
      } finally {
        if (active) {
          setLoading(
            false
          );
        }
      }
    }

    loadDashboard();

    return () => {
      active =
        false;
    };
  }, [navigate]);

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
    }, [data]);

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
    return (
      <main
        className={
          styles.page
        }
      >
        <div
          className={
            styles.loadingCard
          }
        >
          Se încarcă dashboardul…
        </div>
      </main>
    );
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
      profile.earningsAmount ??
        profile.commissionAmount ??
        0
    );

  const hasActivity =
    clicks > 0 ||
    ordersCount > 0 ||
    salesAmount > 0;

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
              Distribuie linkul tău, urmărește rezultatele și vezi activitatea generată prin colaborarea cu Artfest.
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
            STATS
        ===================================================== */}

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
            label="Comenzi"
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
            label="Câștig estimat"
            value={
              formatMoney(
                earningsAmount
              )
            }
          />
        </section>

        {/* =====================================================
            LINK PROMOVARE + REMUNERAȚIE
        ===================================================== */}

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
                Distribuie acest link în bio, stories, postări sau videoclipuri. Vizitele și comenzile eligibile venite prin el vor fi asociate profilului tău.
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
              Condițiile de remunerare vor fi stabilite de Artfest pentru colaborarea ta și vor apărea aici după configurare.
            </div>
          )}
        </section>

        {/* =====================================================
            CUM FUNCȚIONEAZĂ
        ===================================================== */}

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
                Colaborarea ta cu Artfest este urmărită prin linkul tău personal.
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
              text="Vizitele și comenzile eligibile venite prin linkul tău sunt asociate profilului tău."
            />

            <StepCard
              number="3"
              title="Primești remunerația"
              text="Pentru comenzile eligibile, câștigul tău este calculat conform condițiilor stabilite pentru colaborare."
            />
          </div>
        </section>

        {/* =====================================================
            ACTIVITATE
        ===================================================== */}

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
                Aici vei urmări rezultatele generate prin linkul tău.
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
                label="Câștig estimat"
                value={
                  formatMoney(
                    earningsAmount
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

        {/* =====================================================
            PROMOVARE + CONT
        ===================================================== */}

        <section
          className={
            styles.grid
          }
        >
          {/* ===================================================
              PROMOVARE
          =================================================== */}

          <div
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
                  Promovare
                </h2>

                <p
                  className={
                    styles.cardSubtitle
                  }
                >
                  Creează colecții de produse și coduri de reducere pe care să le distribui comunității tale.
                </p>
              </div>
            </div>

            <div
              style={{
                display:
                  "grid",
                gap:
                  12,
              }}
            >
              {/* =================================================
                  COLECȚII
              ================================================= */}

              <div
                style={{
                  border:
                    "1px solid var(--color-border)",
                  borderRadius:
                    14,
                  padding:
                    16,
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
                    gap:
                      14,
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontWeight:
                          700,
                        marginBottom:
                          5,
                      }}
                    >
                      Colecțiile mele
                    </div>

                    <div
                      style={{
                        fontSize:
                          13,
                        lineHeight:
                          1.5,
                        color:
                          "var(--color-text-muted)",
                      }}
                    >
                      Grupează produse Artfest în selecții proprii și distribuie un singur link.
                    </div>
                  </div>

                  <button
                    type="button"
                    className={
                      styles.primaryButton
                    }
                    onClick={() =>
                      setCollectionsOpen(
                        true
                      )
                    }
                  >
                    Gestionează
                  </button>
                </div>
              </div>

              {/* =================================================
                  CODURI REDUCERE
              ================================================= */}

              <div
                style={{
                  border:
                    "1px solid var(--color-border)",
                  borderRadius:
                    14,
                  padding:
                    16,
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
                    gap:
                      14,
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontWeight:
                          700,
                        marginBottom:
                          5,
                      }}
                    >
                      Coduri de reducere
                    </div>

                    <div
                      style={{
                        fontSize:
                          13,
                        lineHeight:
                          1.5,
                        color:
                          "var(--color-text-muted)",
                      }}
                    >
                      Creează coduri promo pentru colecțiile tale și urmărește utilizarea lor.
                    </div>
                  </div>

                  <button
                    type="button"
                    className={
                      styles.secondaryButton
                    }
                    onClick={() =>
                      setDiscountCodesOpen(
                        true
                      )
                    }
                  >
                    Gestionează
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* ===================================================
              CONT
          =================================================== */}

          <div
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
                  Cont
                </h2>

                <p
                  className={
                    styles.cardSubtitle
                  }
                >
                  Datele asociate profilului tău.
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
              style={{
                marginTop:
                  18,
                paddingTop:
                  16,
                borderTop:
                  "1px solid var(--color-border)",
              }}
            >
              <button
                type="button"
                className={
                  styles.secondaryButton
                }
                onClick={
                  logout
                }
                style={{
                  width:
                    "100%",
                  justifyContent:
                    "center",
                }}
              >
                Deconectare
              </button>
            </div>
          </div>
        </section>
      </div>

      {/* =====================================================
          MODAL COLECȚII
      ===================================================== */}

      {collectionsOpen && (
        <InfluencerCollectionsModal
          onClose={() =>
            setCollectionsOpen(
              false
            )
          }
        />
      )}

      {/* =====================================================
          MODAL CODURI REDUCERE
      ===================================================== */}

      {discountCodesOpen && (
        <InfluencerDiscountCodesModal
          onClose={() =>
            setDiscountCodesOpen(
              false
            )
          }
        />
      )}
    </main>
  );
}

/* =========================================================
   STAT CARD
========================================================= */

function StatCard({
  label,
  value,
}) {
  return (
    <div
      className={
        styles.statCard
      }
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
      status || ""
    ).toUpperCase()
  ) {
    case "ACTIVE":
      return "Activ";

    case "DISABLED":
      return "Dezactivat";

    default:
      return status || "—";
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
      value || 0
    )
  );
}