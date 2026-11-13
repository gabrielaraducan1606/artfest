// src/pages/Admin/AdminDesktop/tabs/AdminFairDeliveryNotesPanel.jsx
//
// Admin -> Târg Artfest -> Avize: avizele de însoțire emise de participanți
// (DOAR consultare). Avizul arată ce a expediat artizanul; NU înseamnă că
// produsele au ajuns: recepția, stocurile și vânzările nu se ating de aici.
// PDF-ul e cel generat din datele înghețate la emitere (același generator ca la vânzător).

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, buildApiUrl } from "../../../../lib/api";
import fair from "./AdminArtfestFairTab.module.css";
import styles from "./AdminFairDeliveryNotes.module.css";
import { downloadLabelsPdf } from "../../../Vendor/Fair/fairInventory.js";
import { canEmbedPdf, formatDate, formatLei } from "../../../Vendor/Fair/fairDeliveryNotes.js";

const API = "/api/admin/artfest-fair/delivery-notes";
const STATUS_LABEL = { ISSUED: "Emis", CANCELLED: "Anulat" };

function errorMessage(err, fallback) {
  return err?.data?.message || err?.message || fallback;
}

function pdfName(note) {
  return `aviz-${note.series}-${note.number}${note.status === "CANCELLED" ? "-ANULAT" : ""}.pdf`;
}

function downloadNotePdf(note) {
  return downloadLabelsPdf(`${API}/${encodeURIComponent(note.id)}/pdf?download=1`, pdfName(note), "Nu am putut descărca avizul.");
}

function StatusBadge({ status }) {
  return (
    <span className={`${fair.badge} ${status === "CANCELLED" ? fair.toneDanger : fair.toneSuccess}`}>
      {STATUS_LABEL[status] || status}
    </span>
  );
}

function partyText(p) {
  if (!p) return "—";
  const name = p.name || "—";
  return p.legalType && !String(name).toUpperCase().includes(String(p.legalType).toUpperCase()) ? `${name} ${p.legalType}` : name;
}

function Party({ party }) {
  if (!party) return <span>—</span>;
  return (
    <span className={styles.party}>
      <strong>{partyText(party)}</strong>
      <span>
        CUI {party.cui || "—"} · Reg. Com. {party.regCom || "—"}
      </span>
      {party.address && <span>{party.address}</span>}
    </span>
  );
}

/* ===================== Detaliu + PDF ===================== */

function NoteModal({ id, onClose, onNavigate }) {
  const [note, setNote] = useState(null);
  const [error, setError] = useState("");
  const [pdfUrl, setPdfUrl] = useState(null);
  const [pdfError, setPdfError] = useState("");
  const [downloading, setDownloading] = useState(false);
  const embed = useMemo(() => canEmbedPdf(), []);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // detaliul și PDF-ul emis (din datele înghețate; nu se generează un aviz nou)
  useEffect(() => {
    let alive = true;
    let objectUrl = null;
    setNote(null);
    setError("");
    setPdfUrl(null);
    setPdfError("");
    api(`${API}/${encodeURIComponent(id)}`)
      .then((res) => alive && setNote(res.note))
      .catch((err) => alive && setError(errorMessage(err, "Nu am putut încărca avizul.")));
    fetch(buildApiUrl(`${API}/${encodeURIComponent(id)}/pdf`), { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) throw new Error("Nu am putut genera previzualizarea PDF.");
        const blob = await res.blob();
        if (!alive) return;
        objectUrl = URL.createObjectURL(blob);
        setPdfUrl(objectUrl);
      })
      .catch((err) => alive && setPdfError(err.message));
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id]);

  async function download() {
    if (!note || downloading) return;
    setDownloading(true);
    try {
      await downloadNotePdf(note);
    } catch (err) {
      setPdfError(errorMessage(err, "Nu am putut descărca avizul."));
    } finally {
      setDownloading(false);
    }
  }

  const delegate = note?.delegate || {};
  const shipping = note
    ? [
        delegate.name && `Delegat: ${delegate.name}`,
        (delegate.idSeries || delegate.idNumber) && `C.I. ${delegate.idSeries || ""} ${delegate.idNumber || ""}`.trim(),
        delegate.idIssuedBy && `eliberat(ă) de ${delegate.idIssuedBy}`,
        note.vehicle && `Transport: ${note.vehicle}`,
        note.shippedAt && `Expediat: ${formatDate(note.shippedAt)}`,
      ].filter(Boolean)
    : [];

  return (
    <div className={styles.backdrop} onClick={onClose} role="presentation">
      <div className={styles.modal} role="dialog" aria-modal="true" aria-label="Aviz de însoțire a mărfii" onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHead}>
          <h3>
            {note ? `Aviz ${note.series} nr. ${note.number}` : "Aviz de însoțire"} {note && <StatusBadge status={note.status} />}
          </h3>
          <button type="button" className={fair.ghostBtn} onClick={onClose} aria-label="Închide">
            ✕
          </button>
        </div>

        <div className={styles.modalBody}>
          {!note && !error && <p className={styles.muted}>Se încarcă avizul…</p>}
          {error && <p className={fair.errorText}>{error}</p>}

          {note && (
            <>
              {note.status === "CANCELLED" && (
                <div className={styles.cancelBox} role="status">
                  <strong>Aviz anulat</strong> la {formatDate(note.cancelledAt)}.
                  {note.cancelReason && <span> Motiv: {note.cancelReason}</span>}
                </div>
              )}
              {(note.replacedBy || note.replaces) && (
                <div className={styles.links}>
                  {note.replacedBy && (
                    <button type="button" className={fair.ghostBtn} onClick={() => onNavigate(note.replacedBy.id)}>
                      Vezi avizul înlocuitor {note.replacedBy.series} nr. {note.replacedBy.number} →
                    </button>
                  )}
                  {note.replaces && (
                    <button type="button" className={fair.ghostBtn} onClick={() => onNavigate(note.replaces.id)}>
                      ← Înlocuiește avizul anulat {note.replaces.series} nr. {note.replaces.number}
                    </button>
                  )}
                </div>
              )}

              <dl className={styles.facts}>
                <dt>Data</dt>
                <dd>{formatDate(note.issuedAt)}</dd>
                <dt>Emitent</dt>
                <dd>
                  <Party party={note.issuer} />
                </dd>
                <dt>Destinatar</dt>
                <dd>
                  <Party party={note.recipient} />
                </dd>
                <dt>Livrare la</dt>
                <dd>{note.destination}</dd>
                <dt>Motiv</dt>
                <dd>{note.reason}</dd>
                {note.withoutInvoice && (
                  <>
                    <dt>Mențiune</dt>
                    <dd>Fără factură</dd>
                  </>
                )}
                {note.notes && (
                  <>
                    <dt>Mențiuni</dt>
                    <dd>{note.notes}</dd>
                  </>
                )}
                {shipping.length > 0 && (
                  <>
                    <dt>Expediție</dt>
                    <dd>{shipping.join(" · ")}</dd>
                  </>
                )}
              </dl>

              <div className={styles.lines} role="table" aria-label="Produse expediate">
                <div className={`${styles.line} ${styles.lineHead}`} role="row">
                  <span role="columnheader">Produs</span>
                  <span role="columnheader">Cantitate</span>
                  {!note.withoutValues && <span role="columnheader">Preț artizan</span>}
                  {!note.withoutValues && <span role="columnheader">Valoare</span>}
                </div>
                {note.lines.map((l) => (
                  <div key={l.position} className={`${styles.line} ${note.withoutValues ? styles.lineNoValues : ""}`} role="row">
                    <span role="cell" className={styles.lineProduct}>
                      <strong>{l.title}</strong>
                      <small>
                        {l.variantLabel ? `${l.variantLabel} · ` : ""}
                        {l.internalCode}
                        {l.isManual ? " · adăugat manual" : ""}
                      </small>
                    </span>
                    <span role="cell" data-label="Cantitate">
                      {l.quantity} {l.unit}
                    </span>
                    {!note.withoutValues && (
                      <span role="cell" data-label="Preț artizan">
                        {formatLei(l.unitPriceCents)}
                      </span>
                    )}
                    {!note.withoutValues && (
                      <span role="cell" data-label="Valoare" className={styles.num}>
                        {formatLei(l.valueCents)}
                      </span>
                    )}
                  </div>
                ))}
                <div className={`${styles.line} ${styles.lineTotal} ${note.withoutValues ? styles.lineNoValues : ""}`} role="row">
                  <span role="cell">Total</span>
                  <span role="cell" data-label="Cantitate">
                    {note.totalQuantity} buc.
                  </span>
                  {!note.withoutValues && <span role="cell" className={styles.hideMobile} />}
                  {!note.withoutValues && (
                    <span role="cell" data-label="Valoare" className={styles.num}>
                      {formatLei(note.totalValueCents)}
                    </span>
                  )}
                </div>
              </div>
              {note.withoutValues && <p className={styles.muted}>Aviz emis fără prețuri și valori.</p>}
            </>
          )}

          <section className={styles.pdf} aria-label="Documentul PDF">
            {pdfError && <p className={fair.errorText}>{pdfError}</p>}
            {!pdfUrl && !pdfError && <p className={styles.muted}>Se pregătește PDF-ul…</p>}
            {pdfUrl && embed && <iframe className={styles.pdfFrame} src={pdfUrl} title="Avizul emis (PDF)" />}
            {pdfUrl && !embed && <p className={styles.muted}>Pe acest dispozitiv, PDF-ul se deschide separat.</p>}
          </section>
        </div>

        <div className={styles.modalFoot}>
          {pdfUrl && (
            <a className={fair.ghostBtn} href={pdfUrl} target="_blank" rel="noopener noreferrer">
              Deschide PDF
            </a>
          )}
          <button type="button" className={fair.primaryBtn} onClick={download} disabled={!note || downloading}>
            {downloading ? "Se descarcă…" : "Descarcă PDF"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ===================== Listă ===================== */

export default function AdminFairDeliveryNotesPanel() {
  const [query, setQuery] = useState("");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState(null);
  const [busyId, setBusyId] = useState(null);

  // căutarea pornește după o scurtă pauză de tastare
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(query.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [query]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (q) params.set("q", q);
      if (status) params.set("status", status);
      setData(await api(`${API}?${params}`));
    } catch (err) {
      setError(errorMessage(err, "Nu am putut încărca avizele."));
    } finally {
      setLoading(false);
    }
  }, [q, status, page]);

  useEffect(() => {
    load();
  }, [load]);

  async function download(note) {
    setBusyId(note.id);
    setError("");
    try {
      await downloadNotePdf(note);
    } catch (err) {
      setError(errorMessage(err, "Nu am putut descărca avizul."));
    } finally {
      setBusyId(null);
    }
  }

  const notes = data?.notes || [];
  const closeModal = useCallback(() => setOpenId(null), []);

  return (
    <section className={fair.panel} aria-labelledby="admin-fair-notes-title">
      <div className={fair.panelHead}>
        <div>
          <h2 id="admin-fair-notes-title" className={fair.panelTitle}>
            Avize de însoțire
          </h2>
          <p className={styles.muted}>
            Avizele emise de participanți{data?.fair?.title ? ` pentru ${data.fair.title}` : ""}. Avizul arată ce a expediat
            artizanul; nu înseamnă că produsele au fost recepționate.
          </p>
        </div>
      </div>

      <div className={styles.toolbar}>
        <input
          type="search"
          className={styles.search}
          placeholder="Caută artizan, serie sau număr"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Caută după artizan, serie sau număr"
        />
        <select
          className={styles.select}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          aria-label="Status"
        >
          <option value="">Toate</option>
          <option value="ISSUED">Emise</option>
          <option value="CANCELLED">Anulate</option>
        </select>
        {data && (
          <span className={styles.count}>
            {data.total} {data.total === 1 ? "aviz" : "avize"}
          </span>
        )}
      </div>

      {error && <p className={fair.errorText}>{error}</p>}
      {loading && !data && <p className={styles.muted}>Se încarcă avizele…</p>}
      {data && !notes.length && <p className={styles.empty}>{q || status ? "Niciun aviz pentru filtrele alese." : "Niciun aviz emis încă."}</p>}

      {notes.length > 0 && (
        <ul className={styles.list} aria-busy={loading}>
          <li className={`${styles.row} ${styles.rowHead}`} aria-hidden="true">
            <span>Aviz</span>
            <span>Artizan</span>
            <span>Produse</span>
            <span>Valoare</span>
            <span>Destinație</span>
            <span>Status</span>
            <span />
          </li>
          {notes.map((n) => (
            <li key={n.id} className={styles.row}>
              <span className={styles.cellMain}>
                <strong>{n.displayNumber}</strong>
                <small>{formatDate(n.issuedAt)}</small>
              </span>
              <span className={styles.cellVendor}>
                <strong>{n.issuerName || n.vendor?.displayName || "—"}</strong>
                {n.vendor?.displayName && n.vendor.displayName !== n.issuerName && <small>{n.vendor.displayName}</small>}
              </span>
              <span data-label="Produse">
                {n.linesCount} {n.linesCount === 1 ? "produs" : "produse"} · {n.totalQuantity} buc.
              </span>
              <span data-label="Valoare">{n.withoutValues ? "fără valori" : formatLei(n.totalValueCents)}</span>
              <span data-label="Destinație" className={styles.cellDest} title={n.destination}>
                {n.destination}
              </span>
              <span className={styles.cellStatus}>
                <StatusBadge status={n.status} />
              </span>
              <span className={styles.cellActions}>
                <button type="button" className={fair.ghostBtn} onClick={() => setOpenId(n.id)}>
                  Vizualizează avizul
                </button>
                <button type="button" className={fair.ghostBtn} onClick={() => download(n)} disabled={busyId === n.id}>
                  {busyId === n.id ? "Se descarcă…" : "Descarcă PDF"}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {data && data.pages > 1 && (
        <nav className={styles.pager} aria-label="Pagini">
          <button type="button" className={fair.ghostBtn} onClick={() => setPage((p) => p - 1)} disabled={page <= 1 || loading}>
            ← Înapoi
          </button>
          <span>
            Pagina {data.page} din {data.pages}
          </span>
          <button type="button" className={fair.ghostBtn} onClick={() => setPage((p) => p + 1)} disabled={page >= data.pages || loading}>
            Înainte →
          </button>
        </nav>
      )}

      {openId && <NoteModal id={openId} onClose={closeModal} onNavigate={setOpenId} />}
    </section>
  );
}
