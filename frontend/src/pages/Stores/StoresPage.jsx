// src/pages/Stores/StoresPage.jsx
import { useEffect, useMemo, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import styles from "./StoresPage.module.css";

const SORTS = [
  { v: "new", label: "Cele mai noi" },
  { v: "popular", label: "Populare" },
  { v: "name_asc", label: "Nume A–Z" },
  { v: "name_desc", label: "Nume Z–A" },
];

export default function StoresPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const [items, setItems]   = useState([]);
  const [total, setTotal]   = useState(0);
  const [loading, setLoading] = useState(true);

  const page  = Number(params.get("page") || 1);
  const limit = 24;

  const q    = params.get("q") || "";
  const city = params.get("city") || "";
  const sort = params.get("sort") || "new";

  const onParamChange = (key, value) => {
    const p = new URLSearchParams(params);
    if (value === "" || value == null) p.delete(key);
    else p.set(key, value);
    p.set("page", "1");
    setParams(p);
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const p = new URLSearchParams();
        p.set("page", String(page));
        p.set("limit", String(limit));
        if (q)    p.set("q", q);
        if (city) p.set("city", city);
        if (sort) p.set("sort", sort);

        const res = await api(`/api/public/stores?${p.toString()}`);
        setItems(res?.items || []);
        setTotal(res?.total || 0);
      } finally {
        setLoading(false);
      }
    })();
  }, [q, city, sort, page]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / limit)), [total]);

  return (
    <section className={styles.page}>
      <header className={styles.head}>
        <h1 className={styles.h1}>Magazine</h1>
        <div className={styles.filters}>
          <input
            className={styles.input}
            placeholder="Caută magazine…"
            value={q}
            onChange={(e) => onParamChange("q", e.target.value)}
          />
          <input
            className={styles.input}
            placeholder="Oraș"
            value={city}
            onChange={(e) => onParamChange("city", e.target.value)}
          />
          <select
            className={styles.select}
            value={sort}
            onChange={(e) => onParamChange("sort", e.target.value)}
          >
            {SORTS.map((s) => (
              <option key={s.v} value={s.v}>{s.label}</option>
            ))}
          </select>
        </div>
      </header>

      {loading ? (
        <div className={styles.loading}>Se încarcă…</div>
      ) : items.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <ul className={styles.grid}>
            {items.map((s) => (
              <StoreCard
                key={s.id}
                s={s}
                onClick={() => {
                  const to = s.profileSlug
                    ? `/magazin/${encodeURIComponent(s.profileSlug)}`
                    : `/magazin/${s.id}`;
                  navigate(to);
                }}
              />
            ))}
          </ul>
          <Pagination
            page={page}
            totalPages={totalPages}
            onChange={(newPage) => onParamChange("page", String(newPage))}
          />
        </>
      )}
    </section>
  );
}

function StoreCard({ s, onClick }) {
  const title = s.storeName || s.displayName || "Magazin";
  const subtitle = [s.city, s.category].filter(Boolean).join(" • ");
  return (
    <li className={styles.card}>
      <button className={styles.cardLink} onClick={onClick} aria-label={title}>
        <div className={styles.thumbWrap}>
          <img
            src={s.logoUrl || "/placeholder-store.png"}
            alt={title}
            className={styles.thumb}
            loading="lazy"
          />
        </div>
        <div className={styles.cardBody}>
          <div className={styles.title} title={title}>{title}</div>
          {subtitle && <div className={styles.meta}>{subtitle}</div>}
          <div className={styles.badges}>
            <span className={styles.badge}>
              {s.productsCount} {s.productsCount === 1 ? "produs" : "produse"}
            </span>
          </div>
          {s.about && <p className={styles.about} title={s.about}>{s.about}</p>}
        </div>
      </button>
    </li>
  );
}

function Pagination({ page, totalPages, onChange }) {
  if (totalPages <= 1) return null;
  const prev = Math.max(1, page - 1);
  const next = Math.min(totalPages, page + 1);
  return (
    <div className={styles.pagination}>
      <button disabled={page <= 1} onClick={() => onChange(prev)}>Înapoi</button>
      <span>Pagina {page} din {totalPages}</span>
      <button disabled={page >= totalPages} onClick={() => onChange(next)}>Înainte</button>
    </div>
  );
}

function EmptyState() {
  return (
    <div className={styles.empty}>
      <div className={styles.emptyTitle}>Nu am găsit magazine pentru filtrele alese.</div>
      <a className={styles.btnPrimary} href="/magazine">Resetează filtrele</a>
    </div>
  );
}
