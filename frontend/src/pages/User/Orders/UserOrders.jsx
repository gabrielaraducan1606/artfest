import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Filter,
  RotateCcw,
  Search as SearchIcon,
  MessageSquare, // pentru butonul "Contactează artizanul"
} from "lucide-react";
import { api } from "../../../lib/api";
import styles from "./Orders.module.css";

/**
 * Status UI trimis de backend (computeUiStatus):
 *  PENDING | PROCESSING | SHIPPED | DELIVERED | CANCELED | RETURNED
 */
const STATUS_LABEL = {
  PENDING: "În așteptare",
  PROCESSING: "În procesare la artizani",
  SHIPPED: "Predată curierului",
  DELIVERED: "Livrată",
  CANCELED: "Anulată",
  RETURNED: "Returnată",
};

const STATUS_TABS = [
  { key: "all", label: "Toate" },
  { key: "active", label: "Active" }, // PENDING, PROCESSING, SHIPPED
  { key: "DELIVERED", label: "Livrate" },
  { key: "CANCELED", label: "Anulate" },
  { key: "RETURNED", label: "Returnate" },
];

export default function OrdersPage() {
  const [me, setMe] = useState(null);
  const [tab, setTab] = useState("all");
  const [q, setQ] = useState("");
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null); // pentru anulare / re-comandă

  // pentru UI filtre (mobile)
  const [isMobile, setIsMobile] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // detectăm viewport pentru butonul de filtre pe mobil
  useEffect(() => {
    if (typeof window === "undefined") return;
    const check = () => {
      setIsMobile(window.innerWidth <= 640);
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Auth
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { user } = await api("/api/auth/me");
        if (!alive) return;
        setMe(user || null);
      } catch {
        if (!alive) return;
        setMe(null);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // ce statusuri UI trimitem la backend în query
  const statusParam = useMemo(() => {
    if (tab === "all") return "";
    if (tab === "active") return "PENDING,PROCESSING,SHIPPED";
    return tab; // DELIVERED / CANCELED / RETURNED
  }, [tab]);

  const load = useCallback(
    async (opts = { reset: false }) => {
      if (!me) return;
      setLoading(true);
      try {
        const limit = 10;
        const nextPage = opts.reset ? 1 : page;
        const params = new URLSearchParams();
        params.set("page", String(nextPage));
        params.set("limit", String(limit));
        if (q.trim()) params.set("q", q.trim());
        if (statusParam) params.set("status", statusParam);

        // backend: GET /api/user/orders/my
        const res = await api(`/api/user/orders/my?${params.toString()}`);

        const newItems = Array.isArray(res?.items) ? res.items : [];
        setItems((prev) =>
          opts.reset ? newItems : [...prev, ...newItems]
        );

        const total = res?.total || 0;
        const totalPages = Math.ceil(total / limit) || 1;
        setHasMore(nextPage < totalPages);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    },
    [page, q, statusParam, me]
  );

  // Load la schimbarea tab-ului (reset paginare)
  useEffect(() => {
    if (!me) return;
    setPage(1);
    load({ reset: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, me]); // q este aplicat la submit

  // Load extra la schimbarea paginii
  useEffect(() => {
    if (!me) return;
    if (page === 1) return;
    load({ reset: false });
  }, [page, load, me]);

  function onSearch(e) {
    e.preventDefault();
    setPage(1);
    load({ reset: true });
  }

  // Reset filtre (desktop + mobil)
  function resetFilters() {
    setQ("");
    setTab("all");
    setPage(1);
    // re-load va fi declanșat de useEffect-ul pe tab
  }

  function openFiltersModal() {
    setFiltersOpen(true);
  }

  function closeFiltersModal() {
    setFiltersOpen(false);
  }

  function applyFiltersFromModal() {
    setPage(1);
    load({ reset: true });
    setFiltersOpen(false);
  }

  async function cancelOrder(id) {
    if (
      !confirm(
        "Sigur vrei să anulezi această comandă?  La confirmare, artizanii vor primi automat o notificare cu anularea comenzii."
      )
    )
      return;
    setBusyId(id);
    try {
      await api(`/api/user/orders/${id}/cancel`, { method: "POST" });
      setPage(1);
      await load({ reset: true });
    } catch (e) {
      alert(e?.message || "Nu am putut anula comanda.");
    } finally {
      setBusyId(null);
    }
  }

  async function reorder(id) {
    setBusyId(id);
    try {
      await api(`/api/user/orders/${id}/reorder`, { method: "POST" });
      if (confirm("Produsele au fost adăugate în coș. Deschizi coșul?")) {
        window.location.href = "/cos";
      }
    } catch (e) {
      alert(
        e?.message ||
          "Nu am putut re-comanda. Unele produse ar putea să nu mai fie disponibile."
      );
    } finally {
      setBusyId(null);
    }
  }

  /**
   * Contactează artizanul pentru această comandă.
   * - dacă avem shipments cu vendorId pe obiectul din listă, le folosim direct
   * - altfel facem fetch la detaliile comenzii și extragem vendorId de acolo
   */
  async function contactVendorForOrder(order) {
    try {
      let vendorId = null;

      // 1. încercăm din datele deja primite în listă
      if (Array.isArray(order.shipments) && order.shipments.length > 0) {
        const first = order.shipments.find((s) => s.vendorId);
        if (first && first.vendorId) {
          vendorId = first.vendorId;
        }
      }

      // 2. dacă nu avem, încărcăm detaliile comenzii
      if (!vendorId) {
        const details = await api(
          `/api/user/orders/${encodeURIComponent(order.id)}`
        );
        const shipments = Array.isArray(details?.shipments)
          ? details.shipments
          : [];
        const first = shipments.find((s) => s.vendorId);
        if (first && first.vendorId) {
          vendorId = first.vendorId;
        }
      }

      if (!vendorId) {
        alert(
          "Nu am putut identifica artizanul pentru această comandă. Te rugăm deschide detaliile comenzii sau contactează suportul."
        );
        return;
      }

      const res = await api("/api/user-inbox/ensure-thread", {
        method: "POST",
        body: { vendorId },
      });

      const threadId = res?.threadId;
      if (!threadId) {
        throw new Error("Nu am primit ID-ul conversației.");
      }

      window.location.href = `/cont/mesaje?thread=${encodeURIComponent(
        threadId
      )}`;
    } catch (e) {
      console.error(e);
      alert(
        e?.message ||
          "Nu am putut deschide conversația cu artizanul. Încearcă din nou sau contactează suportul."
      );
    }
  }

  if (!me && !loading) {
    return (
      <div className={styles.page}>
        Trebuie să te autentifici pentru a vedea comenzile.
      </div>
    );
  }

  return (
    <>
      <section className={styles.page}>
        <header className={styles.head}>
          <div>
            <h1 className={styles.h1}>Comenzile mele</h1>
            <p className={styles.subtle}>
              Vizualizezi statusul comenzii tale așa cum este actualizat
              de artizani și curier.
            </p>
          </div>

          <div className={styles.headRight}>
            {/* 🔍 SearchBar */}
            <form className={styles.searchBar} onSubmit={onSearch}>
              <button
                type="submit"
                className={styles.searchBarIconBtn}
                aria-label="Caută"
              >
                <SearchIcon size={18} />
              </button>
              <input
                className={styles.searchBarInput}
                placeholder="Caută după produs sau număr comandă…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </form>

            <div className={styles.filterButtons}>
              <button
                type="button"
                className={styles.iconBtn}
                onClick={resetFilters}
                title="Resetează filtrele"
              >
                <RotateCcw size={18} />
              </button>

              {isMobile && (
                <button
                  type="button"
                  className={styles.iconBtn}
                  onClick={openFiltersModal}
                  title="Filtre"
                >
                  <Filter size={16} />
                  <span className={styles.iconBtnLabel}>Filtre</span>
                </button>
              )}
            </div>
          </div>
        </header>

        {/* Tabs status UI (PENDING / PROCESSING / SHIPPED / ...) */}
        <div className={styles.tabs}>
          {STATUS_TABS.map((t) => (
            <button
              key={t.key}
              className={`${styles.tab} ${
                tab === t.key ? styles.tabActive : ""
              }`}
              onClick={() => setTab(t.key)}
              type="button"
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Listă comenzi */}
        <div className={styles.list}>
          {items.length === 0 && !loading && (
            <EmptyState
              title="Nu ai comenzi în această listă."
              subtitle="Explorează catalogul și adaugă produse în coș."
              ctaText="Vezi Produse"
              href="/produse"
            />
          )}

          {items.map((o) => (
            <OrderCard
              key={o.id}
              order={o}
              onCancel={cancelOrder}
              onReorder={reorder}
              onContact={contactVendorForOrder} // 👈 handler Contactează artizanul
              busy={busyId === o.id}
            />
          ))}
        </div>

        {/* Paginare */}
        {hasMore && (
          <div className={styles.loadMoreWrap}>
            <button
              className={styles.btnGhost}
              disabled={loading}
              onClick={() => setPage((p) => p + 1)}
            >
              {loading ? "Se încarcă…" : "Încarcă mai multe"}
            </button>
          </div>
        )}
      </section>

      {/* Modal filtre – mobil */}
      {filtersOpen && (
        <div
          className={styles.modalBackdrop}
          role="dialog"
          aria-modal="true"
          aria-label="Filtre comenzi"
        >
          <div className={styles.modal}>
            <div className={styles.modalHead}>
              <div className={styles.modalTitle}>Filtre comenzi</div>
              <button
                type="button"
                className={styles.iconBtn}
                onClick={closeFiltersModal}
                aria-label="Închide"
              >
                ×
              </button>
            </div>

            <div className={styles.modalBody}>
              <label className={styles.modalField}>
                <span>Căutare</span>
                <input
                  type="text"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Produs sau număr comandă…"
                />
              </label>

              <div>
                <div className={styles.modalSectionLabel}>
                  Status comandă
                </div>
                <div className={styles.statusPills}>
                  {STATUS_TABS.map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      className={`${styles.statusPill} ${
                        tab === t.key ? styles.statusPillActive : ""
                      }`}
                      onClick={() => setTab(t.key)}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.btnGhost}
                onClick={closeFiltersModal}
              >
                Anulează
              </button>
              <button
                type="button"
                className={styles.btnPrimary}
                onClick={applyFiltersFromModal}
              >
                Aplică filtre
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ====== sub-componente ====== */
function OrderCard({ order, onCancel, onReorder, onContact, busy }) {
  const navigate = useNavigate();

  const canCancel = !!order.cancellable;
  const canReorder = order.status !== "CANCELED";

  const created = new Date(order.createdAt);
  const createdLabel = created.toLocaleString("ro-RO", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  const goToDetails = () => {
    navigate(`/comanda/${order.id}`);
  };

  // dacă backend trimite customerType + shippingAddress, marcăm clar PJ
  const isCompany = order.customerType === "PJ";
  const addr = order.shippingAddress || {};
  const companyName = addr.companyName;

  return (
    <article
      className={styles.card}
      role="button"
      tabIndex={0}
      onClick={goToDetails}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          goToDetails();
        }
      }}
    >
      <header className={styles.cardHead}>
        <div className={styles.orderMeta}>
          <div className={styles.orderId}># {shortId(order.id)}</div>
          <div className={styles.dot} />
          <div className={`${styles.badge} ${styles[`st_${order.status}`]}`}>
            {STATUS_LABEL[order.status] || order.status}
          </div>
          <div className={styles.dot} />
          <div className={styles.date}>{createdLabel}</div>
        </div>
        <div className={styles.total}>
          Total: <b>{money(order.totalCents, order.currency)}</b>
        </div>
      </header>

      {isCompany && (
        <div style={{ marginTop: 4, marginBottom: 4 }}>
          <span className={styles.subtle}>
            Facturare pe firmă
            {companyName ? `: ${companyName}` : ""}
          </span>
        </div>
      )}

      {/* corp card: produse (stânga) + buton contactează (dreapta) */}
      <div className={styles.cardBody}>
        {/* Produse din comandă */}
        <ul className={styles.itemList}>
          {order.items?.map((it) => (
            <li className={styles.item} key={it.id}>
              <Link
                to={it.productId ? `/produs/${it.productId}` : "#"}
                className={styles.itemThumbLink}
                onClick={(e) => e.stopPropagation()} // rămâne: vrem să mergem la produs, nu la detalii comandă
              >
                <img
                  src={it.image || "/placeholder.png"}
                  alt={it.title}
                  className={styles.thumb}
                  loading="lazy"
                />
              </Link>

              <div className={styles.itemInfo}>
                <Link
                  to={it.productId ? `/produs/${it.productId}` : "#"}
                  className={styles.itemTitle}
                  onClick={(e) => e.stopPropagation()}
                >
                  {it.title}
                </Link>
                <div className={styles.itemMeta}>
                  Cantitate: <b>{it.qty}</b> · Preț:{" "}
                  <b>{money(it.priceCents, order.currency)}</b>
                </div>
              </div>
            </li>
          ))}
        </ul>

        {/* partea din dreapta – Contactează artizanul */}
        <div
          className={styles.cardBodyRight}
          onClick={(e) => e.stopPropagation()} // aici vrem să NU deschidem detaliile, ci să facem contact
        >
          <button
            type="button"
            className={styles.btnGhost}
            onClick={() => onContact(order)}
            title="Scrie artizanului pentru această comandă"
          >
            <MessageSquare size={16} style={{ marginRight: 4 }} />
            Contactează artizanul
          </button>
        </div>
      </div>

      {/* Footer – doar acțiuni pe comandă, nu deschide detalii la click înăuntru */}
      <footer
        className={styles.actionsRow}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className={styles.btnGhost}
          onClick={goToDetails}
        >
          Detalii comandă
        </button>

        {canReorder && (
          <button
            className={styles.btnPrimary}
            disabled={busy}
            onClick={() => onReorder(order.id)}
          >
            {busy ? "Se adaugă…" : "Comandă din nou"}
          </button>
        )}
        {canCancel && (
          <button
            className={styles.btnWarn}
            disabled={busy}
            onClick={() => onCancel(order.id)}
          >
            {busy ? "Se anulează…" : "Anulează comanda"}
          </button>
        )}
      </footer>
    </article>
  );
}

function EmptyState({ title, subtitle, ctaText, href }) {
  return (
    <div className={styles.empty}>
      <div className={styles.emptyTitle}>{title}</div>
      <div className={styles.subtle}>{subtitle}</div>
      <a className={styles.btnPrimary} href={href}>
        {ctaText}
      </a>
    </div>
  );
}

/* ===== utils ===== */

function shortId(id = "") {
  if (id.length <= 8) return id;
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
}

function money(cents = 0, currency = "RON") {
  const val = (Number(cents) || 0) / 100;
  return new Intl.NumberFormat("ro-RO", {
    style: "currency",
    currency,
  }).format(val);
}
