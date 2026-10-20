// src/pages/Admin/AdminDesktop/tabs/AdminFairActivationInvite.jsx
//
// Admin -> Târg Artfest -> Înscrieri: invitație prin email pentru vânzătorii cu cont,
// dar cu magazinul încă neactivat. Lista și eligibilitatea vin de pe server (care le
// recalculează și la trimitere); fiecare vendor primește cel mult un email (evidență
// în ArtfestBroadcastDelivery). Trimiterea pornește doar după confirmare explicită.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../../../lib/api";
import shared from "../AdminDesktop.module.css";
import tab from "./AdminArtfestFairTab.module.css";
import styles from "./AdminFairActivationInvite.module.css";
import { Modal } from "./AdminFairCancellation.jsx";

const API = "/api/admin/artfest-fair/activation-invite";
const CAMPAIGN = "CHRISTMAS_FAIR_BUZAU_2026_ACTIVATION_INVITE";

const STATE_LABEL = {
  toSend: "De trimis",
  alreadySent: "Trimis",
  failedRetry: "Eșuat – se poate reîncerca",
  unknown: "Stare incertă – nu se retrimite",
};

const OUTCOME_LABEL = {
  sent: "Trimis",
  already: "Primise deja",
  failed: "Eroare",
  unknown: "Stare incertă",
  noEmail: "Fără email",
};

function errorMessage(err, fallback) {
  return err?.data?.message || err?.message || fallback;
}

function formatDate(value) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("ro-RO", { timeZone: "Europe/Bucharest" });
}

const selectable = (r) => r.state === "toSend" || r.state === "failedRetry";

function ActivationInviteModal({ onClose }) {
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(() => new Set());
  const [search, setSearch] = useState("");
  const [variant, setVariant] = useState("/onboarding");
  const [email, setEmail] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);
  const pollRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const res = await api(`${API}/preview`);
      setPreview(res);
      setStatus(res.status || null);
      setSelected(new Set(res.recipients.filter(selectable).map((r) => r.vendorId)));
      setError("");
    } catch (err) {
      setError(errorMessage(err, "Nu am putut încărca destinatarii."));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    api(`${API}/email-preview?ctaPath=${encodeURIComponent(variant)}`)
      .then((res) => !cancelled && setEmail(res))
      .catch((err) => !cancelled && setError(errorMessage(err, "Nu am putut genera previzualizarea emailului.")));
    return () => {
      cancelled = true;
    };
  }, [variant]);

  // progresul trimiterii (rulează în fundal pe server)
  const poll = useCallback(() => {
    clearTimeout(pollRef.current);
    pollRef.current = setTimeout(async () => {
      try {
        const st = await api(`${API}/status`);
        setStatus(st);
        if (st.running) poll();
        else load();
      } catch {
        poll();
      }
    }, 1200);
  }, [load]);

  useEffect(() => () => clearTimeout(pollRef.current), []);
  useEffect(() => {
    if (status?.running) poll();
  }, [status?.running, poll]);

  const recipients = useMemo(() => preview?.recipients || [], [preview]);
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? recipients.filter((r) => `${r.vendorName} ${r.email} ${r.firstName || ""}`.toLowerCase().includes(q)) : recipients;
  }, [recipients, search]);
  const visibleSelectable = visible.filter(selectable);
  const allVisibleSelected = visibleSelectable.length > 0 && visibleSelectable.every((r) => selected.has(r.vendorId));
  const count = recipients.filter((r) => selected.has(r.vendorId) && selectable(r)).length;
  const running = Boolean(status?.running);
  const canSend = count > 0 && confirmed && !busy && !running && preview?.unsubscribeAvailable !== false;

  function toggle(id) {
    setConfirmed(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setConfirmed(false);
    setSelected((prev) => {
      const next = new Set(prev);
      for (const r of visibleSelectable) {
        if (allVisibleSelected) next.delete(r.vendorId);
        else next.add(r.vendorId);
      }
      return next;
    });
  }

  async function send() {
    if (!canSend) return;
    setBusy(true);
    setError("");
    try {
      const ids = recipients.filter((r) => selected.has(r.vendorId) && selectable(r)).map((r) => r.vendorId);
      const res = await api(`${API}/send`, { method: "POST", body: { confirm: CAMPAIGN, vendorIds: ids } });
      setStatus(res.status);
      setConfirmed(false);
      poll();
    } catch (err) {
      if (err?.data?.status) setStatus(err.data.status);
      setError(errorMessage(err, "Nu am putut porni trimiterea."));
    } finally {
      setBusy(false);
    }
  }

  const progress = status?.current?.progress || null;
  const last = !running ? status?.last || null : null;
  const result = last?.result || null;

  const footer = (
    <div className={styles.footer}>
      <label className={styles.confirm}>
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} disabled={!count || running} />
        <span>
          Confirm trimiterea a <strong>{count}</strong> {count === 1 ? "email" : "emailuri"} către magazinele selectate.
        </span>
      </label>
      <div className={styles.footerActions}>
        <button type="button" className={tab.ghostBtn} onClick={onClose}>
          Închide
        </button>
        <button type="button" className={tab.primaryBtn} onClick={send} disabled={!canSend}>
          {running ? "Se trimite…" : busy ? "Se pornește…" : `Trimite ${count} ${count === 1 ? "invitație" : "invitații"}`}
        </button>
      </div>
    </div>
  );

  return (
    <Modal title="Invită magazine neactivate" onClose={onClose} footer={footer} wide>
      <div className={styles.body}>
        {error && <div className={shared.error}>{error}</div>}
        {!preview ? (
          <p className={shared.subtle}>Se încarcă…</p>
        ) : (
          <>
            <section className={styles.summary} aria-label="Rezumat">
              <p className={styles.big}>
                <strong>{preview.eligible}</strong> {preview.eligible === 1 ? "magazin neactivat eligibil" : "magazine neactivate eligibile"}
              </p>
              <ul className={styles.counts}>
                <li>De trimis: <strong>{preview.counts.toSend}</strong></li>
                <li>Trimise deja: <strong>{preview.counts.alreadySent}</strong></li>
                {preview.counts.failedRetry > 0 && <li>Eșuate: <strong>{preview.counts.failedRetry}</strong></li>}
                {preview.counts.unknown > 0 && <li>Stare incertă: <strong>{preview.counts.unknown}</strong></li>}
              </ul>
              <p className={shared.subtle}>
                Neactivat = cont de vânzător creat, dar magazinul nu a fost activat niciodată. Emailul este o comunicare comercială:
                se trimite doar celor care au acceptat să primească noutăți și oferte, cu link de dezabonare. Fiecare magazin primește
                cel mult un email; cei care au primit deja nu pot fi selectați.
              </p>
              {preview.excluded.length > 0 && (
                <details className={styles.excluded}>
                  <summary>Excluși automat ({preview.excluded.reduce((s, e) => s + e.count, 0)})</summary>
                  <ul>
                    {preview.excluded.map((e) => (
                      <li key={e.reason}>
                        {e.label}: <strong>{e.count}</strong>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {preview.unsubscribeAvailable === false && (
                <p className={tab.errorText} role="alert">
                  Linkul de dezabonare nu poate fi generat pe acest server (lipsește configurarea). Trimiterea este oprită.
                </p>
              )}
            </section>

            <section className={styles.recipients} aria-label="Destinatari">
              <div className={styles.listHead}>
                <label className={styles.checkAll}>
                  <input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} disabled={!visibleSelectable.length || running} />
                  <span>Selectează tot ({visibleSelectable.length})</span>
                </label>
                <input
                  type="search"
                  className={styles.search}
                  placeholder="Caută după magazin sau email"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label="Caută destinatari"
                />
              </div>
              {visible.length === 0 ? (
                <p className={shared.subtle}>{recipients.length ? "Niciun rezultat." : "Nu există magazine neactivate eligibile."}</p>
              ) : (
                <ul className={styles.list}>
                  {visible.map((r) => {
                    const can = selectable(r);
                    return (
                      <li key={r.vendorId} className={`${styles.row} ${!can ? styles.rowMuted : ""}`}>
                        <input
                          type="checkbox"
                          checked={can && selected.has(r.vendorId)}
                          onChange={() => toggle(r.vendorId)}
                          disabled={!can || running}
                          aria-label={`Selectează ${r.vendorName || r.email}`}
                        />
                        <div className={styles.rowText}>
                          <strong>{r.vendorName || "Fără nume"}</strong>
                          <span className={styles.muted}>{r.email}</span>
                          <span className={styles.muted}>
                            Cont creat {formatDate(r.createdAt)} · {r.ctaPath === "/onboarding/details" ? "magazin început" : "fără magazin"}
                          </span>
                          {r.lastError && <span className={tab.errorText}>Ultima eroare: {r.lastError}</span>}
                        </div>
                        <span className={`${styles.badge} ${styles[`state_${r.state}`] || ""}`}>
                          {STATE_LABEL[r.state] || r.state}
                          {r.state === "alreadySent" && r.sentAt ? ` · ${formatDate(r.sentAt)}` : ""}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className={styles.preview} aria-label="Previzualizare email">
              <div className={styles.previewHead}>
                <h4>Previzualizare email</h4>
                <select value={variant} onChange={(e) => setVariant(e.target.value)} aria-label="Varianta destinatarului">
                  <option value="/onboarding">Destinatar fără magazin început</option>
                  <option value="/onboarding/details">Destinatar cu magazin început</option>
                </select>
              </div>
              {email && (
                <>
                  <p className={styles.subject}>
                    <span>Subiect:</span> {email.subject}
                  </p>
                  {/* sandbox gol: fără scripturi și fără navigare din previzualizare */}
                  <iframe title="Previzualizare email" className={styles.frame} sandbox="" srcDoc={email.html} />
                </>
              )}
            </section>

            {(running || result) && (
              <section className={styles.results} aria-label="Rezultatul trimiterii" role="status">
                {running ? (
                  <p>
                    Se trimite… {progress ? `${progress.processed} din ${status.current?.selected ?? "?"}` : ""}
                  </p>
                ) : (
                  <>
                    <p className={styles.big}>
                      Trimise: <strong>{result.emailsSent}</strong> · Primiseră deja: <strong>{result.emailsAlreadySent}</strong> · Erori:{" "}
                      <strong>{result.emailsFailed}</strong>
                      {result.emailsUnknown ? ` · Stare incertă: ${result.emailsUnknown}` : ""}
                      {result.notEligible ? ` · Nu mai erau eligibili: ${result.notEligible}` : ""}
                    </p>
                    {last.error && <p className={tab.errorText}>Oprită cu eroare: {last.error}</p>}
                    {result.items?.some((i) => i.outcome !== "sent") && (
                      <ul className={styles.outcomes}>
                        {result.items
                          .filter((i) => i.outcome !== "sent")
                          .map((i) => (
                            <li key={i.vendorId}>
                              {i.vendorName || i.email}: {OUTCOME_LABEL[i.outcome] || i.outcome}
                              {i.error ? ` – ${i.error}` : ""}
                            </li>
                          ))}
                      </ul>
                    )}
                  </>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

export default function ActivationInvitePanel() {
  const [open, setOpen] = useState(false);
  return (
    <section className={tab.panel} aria-label="Invitație pentru magazinele neactivate">
      <div className={tab.panelHead}>
        <div>
          <h3 className={tab.panelTitle}>Magazine neactivate</h3>
          <p className={shared.subtle}>
            Email către vânzătorii care au cont, dar nu și-au activat încă magazinul: îi invităm să finalizeze activarea ca să se
            poată înscrie la târg.
          </p>
        </div>
        <button type="button" className={tab.primaryBtn} onClick={() => setOpen(true)}>
          Invită magazine neactivate
        </button>
      </div>
      {open && <ActivationInviteModal onClose={() => setOpen(false)} />}
    </section>
  );
}
