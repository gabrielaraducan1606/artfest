// src/pages/Admin/AdminDesktop/tabs/AdminReturnsTab.jsx
//
// Urmărirea retururilor (ReturnRequest) pentru Admin - reutilizează STRICT
// endpointurile existente din adminPickupsRoutes.js:
//   GET   /api/admin/returns?status=&q=&page=   (listă + counts pe status)
//   PATCH /api/admin/returns/:id/status          (schimbare status)
//   POST  /api/admin/returns/:id/create-shipment (colet de retur prin curier)
// Nu e un al doilea sistem de retur: vânzătorul gestionează cererea din
// pagina comenzii; aici Admin vede tot și poate interveni.

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../../../lib/api";
import { ReturnBadge, ReturnItems, ReturnPhotos } from "../../../../components/Returns/ReturnParts.jsx";
import {
  REASON_KIND_LABELS,
  RETURN_STATUS_SHORT,
  formatReturnDate,
  returnStyles as styles,
} from "../../../../components/Returns/returnUtils.js";
import tabStyles from "./AdminReturnsTab.module.css";

const FILTERS = [
  { key: "", label: "Total", count: "ALL" },
  { key: "NEW", label: "Noi", count: "NEW" },
  { key: "IN_REVIEW", label: "În analiză", count: "IN_REVIEW" },
  { key: "APPROVED", label: "Aprobate", count: "APPROVED" },
  { key: "REJECTED", label: "Respinse", count: "REJECTED" },
  { key: "PICKUP_REQUESTED", label: "În transport", count: "PICKUP_REQUESTED" },
  { key: "CLOSED", label: "Închise", count: "CLOSED" },
];

const PAGE_SIZE = 20;

function daysSince(value) {
  const t = new Date(value).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / (1000 * 60 * 60 * 24));
}

function AdminReturnCard({ item, onChanged }) {
  const [status, setStatus] = useState(item.status);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // cerere fără răspuns de la vânzător: vechimea e afișată, fără prag arbitrar
  const waitingDays = ["NEW", "IN_REVIEW"].includes(item.status) ? daysSince(item.updatedAt || item.createdAt) : null;

  async function run(fn) {
    setBusy(true);
    setError("");

    try {
      await fn();
      await onChanged();
    } catch (e) {
      setError(e?.data?.message || e?.data?.error || e?.message || "Acțiunea nu a putut fi salvată.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className={styles.card}>
      <div className={styles.cardHead}>
        <div>
          <div className={styles.cardTitle}>
            Retur #{String(item.id).slice(-6).toUpperCase()} · comanda #{item.orderNumber || item.orderId}
          </div>
          <div className={styles.meta}>
            Solicitată {formatReturnDate(item.createdAt)}
            {waitingDays !== null && waitingDays > 0 ? ` · fără răspuns de ${waitingDays} ${waitingDays === 1 ? "zi" : "zile"}` : ""}
          </div>
        </div>
        <ReturnBadge status={item.status} />
      </div>

      <div className={styles.facts}>
        <div className={styles.fact}>
          <span className={styles.factLabel}>Client</span>
          {item.customerName || "—"}
          {item.customerEmail ? ` · ${item.customerEmail}` : ""}
          {item.guest ? " · fără cont" : ""}
        </div>
        <div className={styles.fact}>
          <span className={styles.factLabel}>Vânzător</span>
          {item.vendorName || "—"}
          {item.vendorEmail ? ` · ${item.vendorEmail}` : ""}
        </div>
        <div className={styles.fact}>
          <span className={styles.factLabel}>Motiv</span>
          {item.reasonKind ? `${REASON_KIND_LABELS[item.reasonKind]} · ` : ""}
          {item.reasonLabel || item.reasonCode}
          {item.reasonText ? ` - ${item.reasonText}` : ""}
        </div>
      </div>

      <ReturnItems items={item.items || []} />

      {item.notesUser && (
        <div className={`${styles.message} ${styles.messageClient}`}>
          <span className={styles.messageLabel}>Mesajul clientului</span>
          {item.notesUser}
        </div>
      )}

      <ReturnPhotos photos={item.photos || []} />

      {item.lastMessage ? (
        <div className={`${styles.message} ${item.lastMessage.from === "CLIENT" ? styles.messageClient : ""}`}>
          <span className={styles.messageLabel}>
            Ultimul mesaj în conversație ({item.lastMessage.from === "CLIENT" ? "client" : "vânzător"}) ·{" "}
            {formatReturnDate(item.lastMessage.createdAt)}
          </span>
          {item.lastMessage.body}
        </div>
      ) : (
        <div className={styles.hint}>Vânzătorul nu a trimis încă niciun mesaj despre această cerere.</div>
      )}

      <div className={styles.actions}>
        <Link
          className={styles.btn}
          to={`/admin?tab=orders&q=${encodeURIComponent(item.orderNumber || item.orderId)}`}
        >
          Vezi comanda
        </Link>

        <select
          className={tabStyles.select}
          value={status}
          disabled={busy}
          onChange={(e) => setStatus(e.target.value)}
          aria-label="Status nou"
        >
          {Object.entries(RETURN_STATUS_SHORT).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>

        <button
          type="button"
          className={`${styles.btn} ${styles.btnPrimary}`}
          disabled={busy || status === item.status}
          onClick={() =>
            run(() =>
              api(`/api/admin/returns/${encodeURIComponent(item.id)}/status`, {
                method: "PATCH",
                body: { status, message: message.trim() || null },
              })
            )
          }
        >
          Salvează statusul
        </button>

        {["APPROVED", "PICKUP_REQUESTED"].includes(item.status) && !item.hasReturnShipment && (
          <button
            type="button"
            className={styles.btn}
            disabled={busy}
            onClick={() =>
              run(() =>
                api(`/api/admin/returns/${encodeURIComponent(item.id)}/create-shipment`, { method: "POST", body: {} })
              )
            }
          >
            Creează colet de retur (curier)
          </button>
        )}
      </div>

      {status !== item.status && (
        <div className={styles.composer}>
          <div className={styles.hint}>
            Clientul primește notificare și email cu același text ca la acțiunile vânzătorului
            {status === "APPROVED" ? " (inclusiv instrucțiunile și adresa de retur)" : ""}.
          </div>
          <textarea
            className={styles.textarea}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={
              status === "REJECTED"
                ? "Motivul respingerii (recomandat - îl vede clientul)"
                : status === "IN_REVIEW"
                  ? "Ce informații sunt necesare de la client?"
                  : "Mesaj pentru client (opțional)"
            }
            maxLength={2000}
          />
        </div>
      )}

      {item.hasReturnShipment && (
        <div className={styles.hint}>
          Colet de retur creat
          {item.returnShipments?.[0]?.awb ? ` · AWB ${item.returnShipments[0].awb}` : ""} - urmărire în Ridicări.
        </div>
      )}

      <div className={styles.hint}>
        La schimbarea statusului (și la crearea coletului de retur), clientul este anunțat automat în cont, pe
        email și în conversația comenzii.
      </div>

      {error && <div className={styles.error}>{error}</div>}
    </article>
  );
}

export default function AdminReturnsTab() {
  const [filter, setFilter] = useState("");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  const [data, setData] = useState({ total: 0, counts: {}, items: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
      if (filter) params.set("status", filter);
      if (query) params.set("q", query);

      const res = await api(`/api/admin/returns?${params.toString()}`);
      setData({
        total: res?.total || 0,
        counts: res?.counts || {},
        items: Array.isArray(res?.items) ? res.items : [],
      });
    } catch (e) {
      setError(e?.message || "Nu am putut încărca retururile.");
    } finally {
      setLoading(false);
    }
  }, [filter, query, page]);

  useEffect(() => {
    load();
  }, [load]);

  const pages = Math.max(1, Math.ceil((data.total || 0) / PAGE_SIZE));

  return (
    <div className={tabStyles.wrap}>
      <div className={tabStyles.stats}>
        {FILTERS.map((f) => (
          <button
            key={f.key || "all"}
            type="button"
            className={`${tabStyles.stat} ${filter === f.key ? tabStyles.statActive : ""}`}
            onClick={() => {
              setFilter(f.key);
              setPage(1);
            }}
          >
            <span className={tabStyles.statValue}>{data.counts?.[f.count] || 0}</span>
            <span className={tabStyles.statLabel}>{f.label}</span>
          </button>
        ))}
      </div>

      <form
        className={tabStyles.search}
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(q.trim());
          setPage(1);
        }}
      >
        <input
          className={tabStyles.input}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Caută după nr. comandă, vânzător, motiv…"
        />
        <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`}>
          Caută
        </button>
      </form>

      {filter === "NEW" && (
        <div className={styles.hint}>Cererile noi sunt ordonate de la cea mai veche - cele fără răspuns apar primele.</div>
      )}

      {error && <div className={styles.error}>{error}</div>}

      {loading && !data.items.length ? (
        <p className={styles.hint}>Se încarcă…</p>
      ) : !data.items.length ? (
        <p className={styles.hint}>Nu există cereri de retur pentru acest filtru.</p>
      ) : (
        <div className={styles.section}>
          {data.items.map((item) => (
            <AdminReturnCard key={`${item.id}-${item.status}`} item={item} onChanged={load} />
          ))}
        </div>
      )}

      {pages > 1 && (
        <div className={tabStyles.pager}>
          <button type="button" className={styles.btn} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            ← Anterior
          </button>
          <span className={styles.hint}>
            Pagina {page} / {pages}
          </span>
          <button type="button" className={styles.btn} disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            Următor →
          </button>
        </div>
      )}
    </div>
  );
}
