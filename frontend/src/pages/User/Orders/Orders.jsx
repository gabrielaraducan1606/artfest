import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../../lib/api";
import styles from "./Orders.module.css";

const STATUS_LABEL = {
  PENDING: "În așteptare",
  PROCESSING: "În procesare",
  SHIPPED: "Expediată",
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
  const [busyId, setBusyId] = useState(null); // pentru anulare/recomandare

  // Auth
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { user } = await api("/api/auth/me");
        if (!alive) return;
        setMe(user || null);
      } catch {
        setMe(null);
      }
    })();
    return () => { alive = false; };
  }, []);

  const statusParam = useMemo(() => {
    if (tab === "all") return "";
    if (tab === "active") return "PENDING,PROCESSING,SHIPPED";
    return tab; // DELIVERED / CANCELED / RETURNED
  }, [tab]);

  const load = useCallback(async (opts = { reset: false }) => {
    setLoading(true);
    try {
      const limit = 10;
      const nextPage = opts.reset ? 1 : page;
      const params = new URLSearchParams();
      params.set("page", String(nextPage));
      params.set("limit", String(limit));
      if (q.trim()) params.set("q", q.trim());
      if (statusParam) params.set("status", statusParam);

      const res = await api(`/api/orders/my?${params.toString()}`);
      const newItems = Array.isArray(res?.items) ? res.items : [];
      setItems(prev => (opts.reset ? newItems : [...prev, ...newItems]));
      const total = res?.total || 0;
      const totalPages = Math.ceil(total / limit) || 1;
      setHasMore(nextPage < totalPages);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [page, q, statusParam]);

  // Load la schimbarea tab-ului / căutării (reset paginare)
  useEffect(() => {
    setPage(1);
    load({ reset: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]); // q va fi încărcat la submit

  function onSearch(e) {
    e.preventDefault();
    setPage(1);
    load({ reset: true });
  }

  async function cancelOrder(id) {
    if (!confirm("Sigur vrei să anulezi această comandă?")) return;
    setBusyId(id);
    try {
      await api(`/api/orders/${id}/cancel`, { method: "POST" });
      // reîncarcă lista curentă (cu reset pt. a reflecta statusul)
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
      await api(`/api/orders/${id}/reorder`, { method: "POST" });
      if (confirm("Produsele au fost adăugate în coș. Deschizi coșul?")) {
        window.location.href = "/cos";
      }
    } catch (e) {
      alert(e?.message || "Nu am putut re-comanda. Unele produse ar putea să nu mai fie disponibile.");
    } finally {
      setBusyId(null);
    }
  }

  if (me === null && !loading) {
    return <div className={styles.page}>Trebuie să te autentifici pentru a vedea comenzile.</div>;
  }

  return (
    <section className={styles.page}>
      <header className={styles.head}>
        <div>
          <h1 className={styles.h1}>Comenzile mele</h1>
          <p className={styles.subtle}>Vizualizează, urmărește și gestionează comenzile tale.</p>
        </div>

        <form className={styles.search} onSubmit={onSearch}>
          <input
            className={styles.input}
            placeholder="Caută după produs sau număr comandă…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button className={styles.btnPrimary} type="submit">Caută</button>
        </form>
      </header>

      {/* Tabs status */}
      <div className={styles.tabs}>
        {STATUS_TABS.map(t => (
          <button
            key={t.key}
            className={`${styles.tab} ${tab === t.key ? styles.tabActive : ""}`}
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
            onClick={() => { setPage(p => p + 1); }}
          >
            {loading ? "Se încarcă…" : "Încarcă mai multe"}
          </button>
        </div>
      )}
    </section>
  );
}

/* ====== sub-componente ====== */

function OrderCard({ order, onCancel, onReorder, busy }) {
  const canCancel = ["PENDING", "PROCESSING"].includes(order.status);
  const canReorder = order.status !== "CANCELED";

  const created = new Date(order.createdAt);
  const createdLabel = created.toLocaleString("ro-RO", { dateStyle: "medium", timeStyle: "short" });

  return (
    <article className={styles.card}>
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

      {/* Items */}
      <ul className={styles.itemList}>
        {order.items?.map((it) => (
          <li className={styles.item} key={it.id}>
            <img
              src={it.image || "/placeholder.png"}
              alt={it.title}
              className={styles.thumb}
              loading="lazy"
            />
            <div className={styles.itemInfo}>
              <div className={styles.itemTitle}>{it.title}</div>
              <div className={styles.itemMeta}>
                Cantitate: <b>{it.qty}</b> · Preț: <b>{money(it.priceCents, order.currency)}</b>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <footer className={styles.actionsRow}>
        <a className={styles.btnGhost} href={`/comanda/${order.id}`}>Detalii comandă</a>
        {canReorder && (
          <button className={styles.btnPrimary} disabled={busy} onClick={() => onReorder(order.id)}>
            {busy ? "Se adaugă…" : "Comandă din nou"}
          </button>
        )}
        {canCancel && (
          <button className={styles.btnWarn} disabled={busy} onClick={() => onCancel(order.id)}>
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
      <a className={styles.btnPrimary} href={href}>{ctaText}</a>
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
  return new Intl.NumberFormat("ro-RO", { style: "currency", currency }).format(val);
}
