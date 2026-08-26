import {
  useEffect,
  useMemo,
  useState,
} from "react";

import { useNavigate } from "react-router-dom";

import { api } from "../../../lib/api.js";
import styles from "./InfluencerDashboardPage.module.css";

export default function InfluencerDashboardPage() {
  const navigate = useNavigate();

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  const [data, setData] =
    useState(null);

  const [copyState, setCopyState] =
    useState("");

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

        if (response?.ok === false) {
          throw Object.assign(
            new Error(
              response?.message ||
                "Nu am putut încărca dashboardul."
            ),
            {
              data: response,
            }
          );
        }

        setData(response);
      } catch (loadError) {
        if (!active) {
          return;
        }

        const code =
          loadError?.data?.error ||
          loadError?.error ||
          "";

        if (
          code === "unauthorized"
        ) {
          navigate(
            "/autentificare",
            {
              replace: true,
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
              replace: true,
            }
          );

          return;
        }

        setError(
          loadError?.data?.message ||
            loadError?.message ||
            "Nu am putut încărca dashboardul."
        );
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadDashboard();

    return () => {
      active = false;
    };
  }, [navigate]);

  const referralUrl =
    useMemo(() => {
      const code =
        data?.profile?.referralCode;

      if (!code) {
        return "";
      }

      const origin =
        window.location.origin;

      return `${origin}/?ref=${encodeURIComponent(
        code
      )}`;
    }, [data]);

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

      setCopyState(type);

      window.setTimeout(
        () => {
          setCopyState("");
        },
        1600
      );
    } catch {
      setError(
        "Nu am putut copia automat."
      );
    }
  }

  async function logout() {
    try {
      await api(
        "/api/auth/logout",
        {
          method: "POST",
        }
      );
    } catch {
      // continuăm logoutul local
    }

    window.location.assign(
      "/autentificare"
    );
  }

  if (loading) {
    return (
      <main
        className={styles.page}
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

  if (
    error ||
    !data?.profile
  ) {
    return (
      <main
        className={styles.page}
      >
        <div
          className={styles.errorCard}
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

  return (
    <main
      className={styles.page}
    >
      <div
        className={
          styles.shell
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
              Urmărește performanța codului tău și activitatea generată prin Artfest.
            </p>
          </div>

          <button
            type="button"
            className={
              styles.logoutButton
            }
            onClick={logout}
          >
            Ieșire
          </button>
        </header>

        <section
          className={
            styles.statsGrid
          }
        >
          <StatCard
            label="Clickuri"
            value={
              profile.clicks || 0
            }
          />

          <StatCard
            label="Comenzi"
            value={
              profile.ordersCount ||
              0
            }
          />

          <StatCard
            label="Vânzări generate"
            value={formatMoney(
              profile.salesAmount ||
                0
            )}
          />

          <StatCard
            label="Comision estimat"
            value={formatMoney(
              profile.commissionAmount ||
                0
            )}
          />
        </section>

        <section
          className={
            styles.grid
          }
        >
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
                  Codul tău
                </h2>

                <p
                  className={
                    styles.cardSubtitle
                  }
                >
                  Folosește acest cod în campaniile tale.
                </p>
              </div>
            </div>

            <div
              className={
                styles.codeBox
              }
            >
              <code
                className={
                  styles.code
                }
              >
                {profile.referralCode}
              </code>

              <button
                type="button"
                className={
                  styles.smallButton
                }
                onClick={() =>
                  copyText(
                    profile.referralCode,
                    "code"
                  )
                }
              >
                {copyState === "code"
                  ? "Copiat ✓"
                  : "Copiază"}
              </button>
            </div>

            <div
              className={
                styles.commissionRow
              }
            >
              <span>
                Comisionul tău
              </span>

              <strong>
                {Number(
                  profile.commissionPercent ||
                    0
                ).toLocaleString(
                  "ro-RO"
                )}
                %
              </strong>
            </div>
          </div>

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
                  Link referral
                </h2>

                <p
                  className={
                    styles.cardSubtitle
                  }
                >
                  Distribuie acest link în bio, stories sau postări.
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
                {copyState === "url"
                  ? "Link copiat ✓"
                  : "Copiază linkul"}
              </button>
            </div>
          </div>
        </section>

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
                Pe măsură ce linkul tău este folosit, aici vei vedea rezultatele.
              </p>
            </div>
          </div>

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
              Dashboardul este pregătit
            </div>

            <div
              className={
                styles.activityText
              }
            >
              Clickurile vor apărea aici imediat ce începi să distribui linkul. Comenzile și comisioanele le conectăm în următorul pas.
            </div>
          </div>
        </section>

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
                profile.status ||
                "—"
              }
            />
          </div>
        </section>
      </div>
    </main>
  );
}

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

function formatMoney(
  value
) {
  return new Intl.NumberFormat(
    "ro-RO",
    {
      style: "currency",
      currency: "RON",
      minimumFractionDigits: 2,
    }
  ).format(
    Number(value || 0)
  );
}