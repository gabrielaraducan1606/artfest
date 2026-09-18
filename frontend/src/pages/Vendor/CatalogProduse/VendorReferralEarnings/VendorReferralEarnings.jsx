import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { api } from "../../../../lib/api.js";

import styles from "./VendorReferralEarnings.module.css";

/* =========================================================
   HELPERS
========================================================= */

function formatMoney(value) {
  const number = Number(value || 0);

  return new Intl.NumberFormat("ro-RO", {
    style: "currency",
    currency: "RON",
    minimumFractionDigits: 2,
  }).format(number);
}

function formatDate(value) {
  if (!value) {
    return "—";
  }

  try {
    return new Date(value).toLocaleString("ro-RO");
  } catch {
    return "—";
  }
}

function getStatusLabel(status) {
  switch (String(status || "").toUpperCase()) {
    case "PENDING":
      return "În așteptare";
    case "PREPARING":
      return "În pregătire";
    case "IN_TRANSIT":
      return "În tranzit";
    case "DELIVERED":
      return "Livrată";
    case "RETURNED":
      return "Returnată";
    case "REFUSED":
      return "Refuzată";
    default:
      return status || "—";
  }
}

function getEarningStatusLabel(status) {
  switch (String(status || "").toUpperCase()) {
    case "CONFIRMED":
      return "Confirmat";
    case "ESTIMATED":
    case "PENDING":
      return "Estimat";
    case "REVERSED":
      return "Reversat";
    case "CANCELLED":
      return "Anulat";
    case "UNAVAILABLE":
      return "Indisponibil";
    default:
      return status || "—";
  }
}

function buildReferralLink(referralCode) {
  if (!referralCode) return "";

  const origin =
    typeof window !== "undefined" && window.location
      ? window.location.origin
      : "https://www.artfest.ro";

  return `${origin}/?ref=${referralCode}`;
}

/* =========================================================
   COMPONENT
========================================================= */

export default function VendorReferralEarnings() {
  const [activeTab, setActiveTab] = useState("overview");

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [referralCode, setReferralCode] = useState(null);
  const [stats, setStats] = useState({
    clicks: 0,

    totalAttributedOrders: 0,
    totalAttributedSales: 0,

    referralOrders: 0,
    referralSales: 0,
    referralEstimatedEarnings: 0,
    referralConfirmedEarnings: 0,

    ownSaleOrders: 0,
    ownSaleSales: 0,
    ownSaleEstimatedBenefit: 0,
    ownSaleConfirmedBenefit: 0,
  });

  const [orders, setOrders] = useState([]);

  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState("");

  const [copied, setCopied] = useState(false);

  /* =========================================================
     LOAD
  ========================================================= */

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError("");

    try {
      const [meData, ordersData] = await Promise.all([
        api("/api/vendors/me"),
        api("/api/vendors/me/referral/orders"),
      ]);

      setReferralCode(meData?.referral?.referralCode || null);

      const s = meData?.referral?.stats || {};

      setStats({
        clicks: Number(s.clicks ?? meData?.referral?.clicks ?? 0),

        totalAttributedOrders: Number(s.totalAttributedOrders || 0),
        totalAttributedSales: Number(s.totalAttributedSales || 0),

        referralOrders: Number(s.referralOrders || 0),
        referralSales: Number(s.referralSales || 0),
        referralEstimatedEarnings: Number(s.referralEstimatedEarnings || 0),
        referralConfirmedEarnings: Number(s.referralConfirmedEarnings || 0),

        ownSaleOrders: Number(s.ownSaleOrders || 0),
        ownSaleSales: Number(s.ownSaleSales || 0),
        ownSaleEstimatedBenefit: Number(s.ownSaleEstimatedBenefit || 0),
        ownSaleConfirmedBenefit: Number(s.ownSaleConfirmedBenefit || 0),
      });

      setOrders(Array.isArray(ordersData?.orders) ? ordersData.orders : []);
    } catch (err) {
      setLoadError(
        err?.data?.message ||
          err?.message ||
          "Nu am putut încărca datele de recomandare."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  /* =========================================================
     GENERATE LINK
  ========================================================= */

  async function generateReferralCode() {
    setGenerating(true);
    setGenerateError("");

    try {
      const data = await api("/api/vendors/me/referral-code/generate", {
        method: "POST",
      });

      if (data?.referralCode) {
        setReferralCode(data.referralCode);
      }
    } catch (err) {
      setGenerateError(
        err?.data?.message ||
          err?.message ||
          "Nu am putut genera linkul de recomandare."
      );
    } finally {
      setGenerating(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(buildReferralLink(referralCode));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setGenerateError("Nu am putut copia linkul.");
    }
  }

  /* =========================================================
     DERIVED
  ========================================================= */

  /*
   * Separare explicită pe secțiuni - own-sale (fără câștig, doar
   * beneficiu/economie) NU trebuie amestecat vizual cu recomandările
   * cross-vendor (câștig real).
   */
  const ownSaleOrders = useMemo(
    () => orders.filter((order) => order.type === "OWN_SALE"),
    [orders]
  );

  const referralOnlyOrders = useMemo(
    () => orders.filter((order) => order.type !== "OWN_SALE"),
    [orders]
  );

  /*
   * Tab-ul "Câștiguri" e STRICT despre câștigul real din recomandări -
   * own-sale nu e un câștig (vezi mai sus), deci nu apare aici.
   */
  const confirmedOrders = useMemo(
    () =>
      referralOnlyOrders.filter((order) => order.earningStatus === "CONFIRMED"),
    [referralOnlyOrders]
  );

  const estimatedOrders = useMemo(
    () =>
      referralOnlyOrders.filter((order) =>
        ["PENDING", "ESTIMATED"].includes(
          String(order.earningStatus || "").toUpperCase()
        )
      ),
    [referralOnlyOrders]
  );

  if (loading) {
    return (
      <div className={styles.root}>
        <div className={styles.centerState}>Se încarcă…</div>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      {/* =====================================================
          HEADER
      ===================================================== */}

      <div className={styles.header}>
        <div>
          <div className={styles.eyebrow}>Program recomandări</div>

          <h1 className={styles.title}>Câștiguri din recomandări</h1>

          <p className={styles.subtitle}>
            Urmărește comenzile generate prin linkurile, colecțiile și
            codurile tale - atât pentru alți vendori (recomandări), cât și
            pentru propriul magazin (vânzări proprii).
          </p>
        </div>
      </div>

      {loadError && <div className={styles.errorBox}>{loadError}</div>}

      {/* =====================================================
          LINK DE RECOMANDARE
      ===================================================== */}

      <div className={styles.linkBox}>
        <div className={styles.linkBoxLabel}>
          <strong>Linkul tău de recomandare</strong>
          <span>
            {referralCode
              ? "Distribuie-l pentru a câștiga din recomandări."
              : "Generează-l o singură dată - rămâne stabil după aceea."}
          </span>
        </div>

        {referralCode ? (
          <>
            <input
              type="text"
              readOnly
              className={styles.linkInput}
              value={buildReferralLink(referralCode)}
              onFocus={(e) => e.target.select()}
            />

            <button
              type="button"
              className={styles.secondaryButton}
              onClick={copyLink}
            >
              {copied ? "Copiat ✓" : "Copiază"}
            </button>
          </>
        ) : (
          <button
            type="button"
            className={styles.primaryButton}
            disabled={generating}
            onClick={generateReferralCode}
          >
            {generating ? "Se generează…" : "Generează linkul meu"}
          </button>
        )}
      </div>

      {generateError && <div className={styles.errorBox}>{generateError}</div>}

      {/* =====================================================
          INFO
      ===================================================== */}

      <div className={styles.infoBox}>
        <strong>Cum funcționează</strong>

        <p>
          Pentru produsele tale nu primești bonus de recomandare separat.
          Dacă o comandă vine prin propriul tău link sau cod, avantajul tău
          este comisionul Artfest redus la 5% - le vezi mai jos marcate
          „Vânzare proprie", pentru informare, fără să fie incluse în
          totalurile de câștig din recomandări.
        </p>

        <p>
          Pentru produsele altor vendori, poți primi câștig din recomandări,
          calculat din marja eligibilă rămasă Artfest pentru acea parte a
          comenzii.
        </p>
      </div>

      {/* =====================================================
          TABS
      ===================================================== */}

      <div className={styles.tabs}>
        <button
          type="button"
          className={activeTab === "overview" ? styles.tabActive : styles.tab}
          onClick={() => setActiveTab("overview")}
        >
          Overview
        </button>

        <button
          type="button"
          className={activeTab === "orders" ? styles.tabActive : styles.tab}
          onClick={() => setActiveTab("orders")}
        >
          Comenzi generate
        </button>

        <button
          type="button"
          className={activeTab === "earnings" ? styles.tabActive : styles.tab}
          onClick={() => setActiveTab("earnings")}
        >
          Câștiguri
        </button>
      </div>

      {/* =====================================================
          OVERVIEW
      ===================================================== */}

      {activeTab === "overview" && (
        <>
          <div className={styles.statsGrid}>
            <StatCard
              label="Clickuri"
              value={stats.clicks.toLocaleString("ro-RO")}
            />

            <StatCard
              label="Comenzi atribuite"
              value={stats.totalAttributedOrders.toLocaleString("ro-RO")}
              breakdown={`recomandări: ${stats.referralOrders.toLocaleString("ro-RO")} · vânzări proprii: ${stats.ownSaleOrders.toLocaleString("ro-RO")}`}
            />

            <StatCard
              label="Vânzări atribuite"
              value={formatMoney(stats.totalAttributedSales)}
              breakdown={`recomandări: ${formatMoney(stats.referralSales)} · vânzări proprii: ${formatMoney(stats.ownSaleSales)}`}
            />

            {/*
              IMPORTANT: cele două carduri de mai jos NU se însumează
              niciodată între ele - own-sale nu e un câștig, ci o
              economie de comision, iar recomandările sunt un câștig
              real, plătit separat. Ținute STRICT distincte, ca să nu
              sugereze un payout pentru vânzarea proprie.
            */}
            <StatCard
              label="Beneficiu din vânzări proprii"
              value={formatMoney(
                stats.ownSaleEstimatedBenefit + stats.ownSaleConfirmedBenefit
              )}
              secondary
              breakdown={`estimat: ${formatMoney(stats.ownSaleEstimatedBenefit)} · confirmat: ${formatMoney(stats.ownSaleConfirmedBenefit)}`}
            />

            <StatCard
              label="Câștig din recomandări"
              value={formatMoney(
                stats.referralEstimatedEarnings + stats.referralConfirmedEarnings
              )}
              breakdown={`estimat: ${formatMoney(stats.referralEstimatedEarnings)} · confirmat: ${formatMoney(stats.referralConfirmedEarnings)}`}
            />
          </div>

          <section className={styles.card}>
            <div className={styles.cardHeader}>
              <div>
                <h2 className={styles.cardTitle}>Activitate recentă</h2>

                <p className={styles.cardSubtitle}>
                  Ultimele comenzi atribuite recomandărilor tale.
                </p>
              </div>
            </div>

            <div className={styles.ordersList}>
              {orders.length ? (
                orders
                  .slice(0, 3)
                  .map((order) => (
                    <ReferralOrderCard key={order.id} order={order} />
                  ))
              ) : (
                <EmptyState text="Nu ai încă nicio comandă generată prin recomandare." />
              )}
            </div>
          </section>
        </>
      )}

      {/* =====================================================
          ORDERS
      ===================================================== */}

      {activeTab === "orders" && (
        <>
          <section className={styles.card}>
            <div className={styles.cardHeader}>
              <div>
                <h2 className={styles.cardTitle}>
                  Recomandări către alți vendori
                </h2>

                <p className={styles.cardSubtitle}>
                  Comenzi cu produse ale altor vendori, generate prin
                  linkurile, colecțiile sau codurile tale - pot genera
                  câștig real.
                </p>
              </div>
            </div>

            <div className={styles.ordersList}>
              {referralOnlyOrders.length ? (
                referralOnlyOrders.map((order) => (
                  <ReferralOrderCard key={order.id} order={order} />
                ))
              ) : (
                <EmptyState text="Nu ai încă nicio comandă generată prin recomandare." />
              )}
            </div>
          </section>

          <section className={styles.card}>
            <div className={styles.cardHeader}>
              <div>
                <h2 className={styles.cardTitle}>Vânzări proprii atribuite</h2>

                <p className={styles.cardSubtitle}>
                  Comenzi cu produsele tale, cumpărate prin propriul link/cod -
                  nu generează câștig, doar economie de comision.
                </p>
              </div>
            </div>

            <div className={styles.ordersList}>
              {ownSaleOrders.length ? (
                ownSaleOrders.map((order) => (
                  <ReferralOrderCard key={order.id} order={order} />
                ))
              ) : (
                <EmptyState text="Nu ai încă nicio vânzare proprie atribuită." />
              )}
            </div>
          </section>
        </>
      )}

      {/* =====================================================
          EARNINGS
      ===================================================== */}

      {activeTab === "earnings" && (
        <div className={styles.earningsGrid}>
          <p className={styles.subtitle}>
            Doar recomandările către alți vendori generează câștig real -
            vânzările proprii (economie de comision) nu apar aici, le vezi în
            tab-ul „Comenzi generate", secțiunea „Vânzări proprii atribuite".
          </p>

          <section className={styles.card}>
            <h2 className={styles.cardTitle}>Câștiguri confirmate</h2>

            <p className={styles.cardSubtitle}>
              Comenzi pentru care remunerația a fost confirmată.
            </p>

            <div className={styles.ordersList}>
              {confirmedOrders.length > 0 ? (
                confirmedOrders.map((order) => (
                  <ReferralOrderCard key={order.id} order={order} />
                ))
              ) : (
                <EmptyState text="Nu există încă câștiguri confirmate." />
              )}
            </div>
          </section>

          <section className={styles.card}>
            <h2 className={styles.cardTitle}>Câștiguri estimate</h2>

            <p className={styles.cardSubtitle}>
              Valori orientative pentru comenzi încă neconfirmate.
            </p>

            <div className={styles.ordersList}>
              {estimatedOrders.length > 0 ? (
                estimatedOrders.map((order) => (
                  <ReferralOrderCard key={order.id} order={order} />
                ))
              ) : (
                <EmptyState text="Nu există câștiguri estimate în acest moment." />
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

/* =========================================================
   STAT CARD
========================================================= */

function StatCard({ label, value, secondary = false, breakdown = "" }) {
  return (
    <div
      className={`${styles.statCard} ${
        secondary ? styles.statCardSecondary : ""
      }`}
    >
      <div className={styles.statLabel}>{label}</div>
      <div className={styles.statValue}>{value}</div>
      {breakdown && <div className={styles.statBreakdown}>{breakdown}</div>}
    </div>
  );
}

/* =========================================================
   ORDER CARD
========================================================= */

function ReferralOrderCard({ order }) {
  const isOwnSale = order.type === "OWN_SALE";

  /*
   * audit 2026-09-15 - persistent attribution VendorCollection: sursa
   * "COLLECTION" (marcaj intern "COLLECTION:<slug>") NU trebuie
   * afișată literal - traducem în "Colecția <slug>".
   */
  const sourceLabel =
    order.source === "CODE"
      ? `Cod ${order.discountCode || ""}`
      : order.source === "COLLECTION"
      ? `Colecția ${order.collectionSlug || ""}`
      : "Link de recomandare";

  return (
    <article className={styles.orderCard}>
      <div className={styles.orderTop}>
        <div>
          <div className={styles.orderNumber}>
            Comanda {order.orderNumber || "—"}
            {isOwnSale && (
              <span className={styles.ownSaleBadge}> Vânzare proprie</span>
            )}
          </div>

          <div className={styles.orderDate}>{formatDate(order.createdAt)}</div>
        </div>

        <span className={styles.status}>{getStatusLabel(order.status)}</span>
      </div>

      <div className={styles.orderVendor}>
        {isOwnSale ? (
          <>
            Produsele tale, cumpărate prin{" "}
            {order.source === "CODE"
              ? "propriul cod de reducere"
              : order.source === "COLLECTION"
              ? `colecția ${order.collectionSlug || "ta"}`
              : "propriul link de reducere"}
          </>
        ) : (
          <>
            Produse vândute de <strong>{order.vendorName || "—"}</strong>
          </>
        )}
      </div>

      <div className={styles.orderMeta}>
        <OrderMeta label="Valoare eligibilă" value={formatMoney(order.salesAmount)} />

        {isOwnSale ? (
          <>
            <OrderMeta
              label="Comision Artfest aplicat"
              value={`${Number(order.ownCommissionPercent || 0).toLocaleString("ro-RO")}%`}
            />

            <OrderMeta
              label={`Beneficiu ${getEarningStatusLabel(
                order.earningStatus
              ).toLowerCase()}`}
              value={formatMoney(order.benefitAmount)}
              strong
            />
          </>
        ) : (
          <>
            {order.platformDiscountGross != null && (
              <OrderMeta
                label="Reducere Artfest"
                value={formatMoney(order.platformDiscountGross)}
              />
            )}

            <OrderMeta
              label="Comision Artfest brut"
              value={formatMoney(order.platformNet)}
            />

            <OrderMeta
              label="Remunerație promoter"
              value={`${Number(order.referralPercent || 0).toLocaleString("ro-RO")}% din comisionul Artfest`}
            />

            <OrderMeta
              label={getEarningStatusLabel(order.earningStatus)}
              value={formatMoney(order.earningAmount)}
              strong
            />
          </>
        )}
      </div>

      <div className={styles.orderSource}>
        Sursă: <strong>{isOwnSale ? "Vânzare proprie" : sourceLabel}</strong>
        {isOwnSale &&
          order.source === "CODE" &&
          order.discountCode &&
          ` (cod ${order.discountCode})`}
        {isOwnSale &&
          order.source === "COLLECTION" &&
          ` (colecția ${order.collectionSlug || ""})`}
      </div>
    </article>
  );
}

/* =========================================================
   ORDER META
========================================================= */

function OrderMeta({ label, value, strong = false }) {
  return (
    <div className={styles.orderMetaItem}>
      <span>{label}</span>
      <strong className={strong ? styles.orderMetaStrong : ""}>{value}</strong>
    </div>
  );
}

/* =========================================================
   EMPTY
========================================================= */

function EmptyState({ text }) {
  return <div className={styles.emptyState}>{text}</div>;
}
