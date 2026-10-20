// src/pages/Admin/AdminDesktop/tabs/AdminArtfestFairTab.jsx
//
// Admin -> Târg Artfest: înscrierile vendorilor (aprobare / respingere /
// anularea participării aprobate + retur) și trimiterea MANUALĂ a invitației
// către toți vendorii activi. Invitația e idempotentă pe server
// (ArtfestBroadcastDelivery), deci butonul poate fi apăsat din nou fără să
// retrimită celor care au primit-o deja.

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../../../../lib/api";
import shared from "../AdminDesktop.module.css";
import styles from "./AdminArtfestFairTab.module.css";
import AdminFairReceptionPanel from "./AdminFairReceptionPanel.jsx";
import AdminFairLabelsPanel from "./AdminFairLabelsPanel.jsx";
import AdminFairPosPanel from "./AdminFairPosPanel.jsx";
import AdminFairSettlementsPanel from "./AdminFairSettlementsPanel.jsx";
import { CancelParticipationModal, Modal, RegistrationHistory, RegistrationReturns } from "./AdminFairCancellation.jsx";
import { CAUSE_LABEL } from "./adminFairCancellation.js";
import { TERMS_NOT_ACCEPTED_TEXT, termsAcceptanceView } from "./adminFairTerms.js";

const API = "/api/admin/artfest-fair";

const STATUS_LABEL = {
  SUBMITTED: "Trimisă",
  APPROVED: "Aprobată",
  REJECTED: "Respinsă",
  WITHDRAWN: "Retrasă",
  CANCELLED: "Anulată",
};

const STATUS_TONE = {
  SUBMITTED: styles.toneInfo,
  APPROVED: styles.toneSuccess,
  REJECTED: styles.toneDanger,
  WITHDRAWN: styles.toneMuted,
  CANCELLED: styles.toneDanger,
};

const TYPE_LABEL = {
  PARTICIPARE_FIZICA: "Fizic",
  PARTICIPARE_LA_DISTANTA: "La distanță",
};

const CONFIRM_TEXT = "Sigur vrei să trimiți invitația pentru Târgul Artfest tuturor vendorilor activi?";

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("ro-RO", { timeZone: "Europe/Bucharest" });
}

function storeNames(item) {
  return item.stores?.map((s) => s.name).join(", ") || "—";
}

/* ===================== Invitație ===================== */

function InvitePanel() {
  const [preview, setPreview] = useState(null);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pollRef = useRef(null);

  const loadPreview = useCallback(async () => {
    try {
      const res = await api(`${API}/invite/preview`);
      setPreview(res);
      setStatus(res?.status || null);
      return res;
    } catch (e) {
      setError(e?.message || "Nu am putut calcula destinatarii.");
      return null;
    }
  }, []);

  const stopPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  };

  const startPolling = useCallback(() => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const res = await api(`${API}/invite/status`);
        setStatus(res);
        if (!res?.running) {
          stopPolling();
          loadPreview();
        }
      } catch {
        stopPolling();
      }
    }, 1500);
  }, [loadPreview]);

  useEffect(() => {
    loadPreview().then((res) => {
      if (res?.status?.running) startPolling();
    });
    return stopPolling;
  }, [loadPreview, startPolling]);

  async function onSend() {
    if (busy || status?.running) return;
    setError("");
    setBusy(true);
    try {
      // numărul estimat e recalculat chiar înainte de confirmare
      const fresh = await loadPreview();
      if (!fresh) return;

      const toNotify = fresh.notifications?.toSend ?? 0;
      const toEmail = fresh.emails?.toSend ?? 0;

      if (!toNotify && !toEmail) {
        window.alert(
          `Toți cei ${fresh.eligibleVendors} vendori activi au primit deja invitația (sau nu au adresă de email). Nu este nimic de trimis.`
        );
        return;
      }

      const ok = window.confirm(
        `${CONFIRM_TEXT}\n\n` +
          `Vendori activi: ${fresh.eligibleVendors}\n` +
          `Notificări de trimis: ${toNotify}\n` +
          `Emailuri de trimis: ${toEmail}\n` +
          `Deja trimise (nu se retrimit): ${fresh.emails?.alreadySent ?? 0} emailuri, ${fresh.notifications?.alreadySent ?? 0} notificări`
      );
      if (!ok) return;

      const res = await api(`${API}/invite/send`, {
        method: "POST",
        body: { confirm: fresh.campaignKey },
      });
      setStatus(res?.status || null);
      startPolling();
    } catch (e) {
      if (e?.status === 409 && e?.data?.status) {
        setStatus(e.data.status);
        startPolling();
      }
      setError(e?.data?.message || e?.message || "Nu am putut porni trimiterea.");
    } finally {
      setBusy(false);
    }
  }

  const running = Boolean(status?.running);
  const progress = status?.current?.progress || null;
  const last = status?.last || null;
  const result = last?.result || null;

  return (
    <section className={styles.panel} aria-label="Invitația către vendori">
      <div className={styles.panelHead}>
        <div>
          <h3 className={styles.panelTitle}>Invitația către vendori</h3>
          <p className={shared.subtle}>
            Notificare în Artfest + email pentru fiecare vendor activ. Fiecare vendor primește cel mult o
            notificare și un email; la o nouă apăsare se trimite doar celor care nu au primit-o încă.
          </p>
        </div>
        <button type="button" className={styles.primaryBtn} onClick={onSend} disabled={busy || running}>
          {running ? "Se trimite…" : "Trimite invitația tuturor vendorilor"}
        </button>
      </div>

      {preview && (
        <ul className={styles.stats}>
          <li>
            <strong>{preview.eligibleVendors}</strong> vendori activi
          </li>
          <li>
            <strong>{preview.notifications?.toSend ?? 0}</strong> notificări de trimis
          </li>
          <li>
            <strong>{preview.emails?.toSend ?? 0}</strong> emailuri de trimis
            {preview.emails?.failedRetry ? ` (${preview.emails.failedRetry} reîncercări)` : ""}
          </li>
          <li>
            <strong>{preview.emails?.alreadySent ?? 0}</strong> emailuri deja trimise
          </li>
          {preview.emails?.unknown ? (
            <li title="Trimitere întreruptă - nu se retrimite automat">
              <strong>{preview.emails.unknown}</strong> emailuri cu status necunoscut
            </li>
          ) : null}
          {preview.emails?.noEmail ? (
            <li>
              <strong>{preview.emails.noEmail}</strong> vendori fără email
            </li>
          ) : null}
        </ul>
      )}

      {running && progress && (
        <p className={styles.progress} role="status">
          Se trimite: {progress.processed} / {progress.eligibleVendors} vendori procesați…
        </p>
      )}

      {!running && result && (
        <div className={styles.result} role="status">
          <strong>Rezultatul ultimei trimiteri ({formatDate(last.finishedAt)})</strong>
          <span>{result.notificationsSent} notificări trimise</span>
          <span>{result.emailsSent} emailuri trimise</span>
          <span>{result.skippedVendors} deja trimise / skip</span>
          <span>{result.errors} erori</span>
          {result.emailsUnknown ? <span>{result.emailsUnknown} emailuri cu status necunoscut (nu se retrimit)</span> : null}
          {result.emailsNoAddress ? <span>{result.emailsNoAddress} vendori fără email</span> : null}
          {last.error ? <span className={styles.errorText}>Oprită cu eroare: {last.error}</span> : null}
        </div>
      )}

      {error && <div className={shared.error}>{error}</div>}
    </section>
  );
}

/* ===================== Detalii / respingere ===================== */

function DetailRow({ label, children }) {
  return (
    <div className={styles.detailRow}>
      <dt>{label}</dt>
      <dd>{children || "—"}</dd>
    </div>
  );
}

// valorile salvate la înscriere; IP-ul și browserul sunt doar pentru Admin (vendorul nu le primește)
function TermsAcceptance({ item }) {
  const terms = termsAcceptanceView(item);
  return (
    <section className={styles.detailSection} aria-label="Acceptarea regulamentului">
      <h4>Acceptarea regulamentului</h4>
      <dl className={styles.details}>
        <DetailRow label="Versiune acceptată">
          {terms.accepted ? (
            terms.href ? (
              <a href={terms.href} target="_blank" rel="noopener noreferrer">
                {terms.version}
              </a>
            ) : (
              terms.version
            )
          ) : (
            TERMS_NOT_ACCEPTED_TEXT
          )}
        </DetailRow>
        <DetailRow label="Acceptat la">{terms.acceptedAt ? formatDate(terms.acceptedAt) : null}</DetailRow>
        <DetailRow label="IP">{terms.ip}</DetailRow>
        <DetailRow label="Browser / user agent">{terms.ua}</DetailRow>
      </dl>
    </section>
  );
}

function RegistrationDetails({ item, onClose }) {
  const cancellation = item.cancellation;
  return (
    <Modal title={`Înscriere - ${item.vendorName || "vendor"}`} onClose={onClose} wide>
      <dl className={styles.details}>
        <DetailRow label="Status">{STATUS_LABEL[item.status] || item.status}</DetailRow>
        <DetailRow label="Vendor">{item.vendorName}</DetailRow>
        <DetailRow label="Magazin">{storeNames(item)}</DetailRow>
        <DetailRow label="Persoană de contact">{item.contactName}</DetailRow>
        <DetailRow label="Telefon">{item.contactPhone}</DetailRow>
        <DetailRow label="Email">{item.contactEmail}</DetailRow>
        <DetailRow label="Tip participare">{TYPE_LABEL[item.participationType] || item.participationType}</DetailRow>
        <DetailRow label="Tipuri de produse">{item.productTypes?.join(", ")}</DetailRow>
        <DetailRow label="Număr estimativ">{item.estimatedProductCount}</DetailRow>
        <DetailRow label="Observații">{item.notes}</DetailRow>
        <DetailRow label="Data înscrierii">{formatDate(item.submittedAt)}</DetailRow>
        <DetailRow label="Verificată la">{item.reviewedAt ? formatDate(item.reviewedAt) : null}</DetailRow>
        <DetailRow label="Motiv intern respingere">{item.rejectionReason}</DetailRow>
        <DetailRow label="Retrasă la">{item.withdrawnAt ? formatDate(item.withdrawnAt) : null}</DetailRow>
        {cancellation && (
          <>
            <DetailRow label="Anulată la">{formatDate(cancellation.at)}</DetailRow>
            <DetailRow label="Cauza anulării">{CAUSE_LABEL[cancellation.cause] || cancellation.cause}</DetailRow>
            <DetailRow label="Motiv intern anulare">{cancellation.reason}</DetailRow>
            <DetailRow label="Mesaj pentru vendor">{cancellation.messageForVendor || "mesajul standard"}</DetailRow>
            <DetailRow label="Produse deja expediate la anulare">{cancellation.goodsShipped ? "da" : "nu"}</DetailRow>
            <DetailRow label="Taxa de participare">{cancellation.rules?.feeRuleText}</DetailRow>
            <DetailRow label="Costul returului">{cancellation.rules?.returnCostText}</DetailRow>
          </>
        )}
      </dl>

      <TermsAcceptance item={item} />

      <section className={styles.detailSection} aria-label="Istoricul deciziilor">
        <h4>Istoric</h4>
        <RegistrationHistory registrationId={item.id} />
      </section>

      {(item.status === "CANCELLED" || item.status === "APPROVED") && (
        <section className={styles.detailSection} aria-label="Retururi către vendor">
          <RegistrationReturns registration={item} />
        </section>
      )}
    </Modal>
  );
}

function RejectModal({ item, onClose, onConfirm, busy }) {
  const [reason, setReason] = useState("");
  return (
    <Modal
      title={`Respinge înscrierea - ${item.vendorName || "vendor"}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={styles.ghostBtn} onClick={onClose} disabled={busy}>
            Renunță
          </button>
          <button type="button" className={styles.dangerBtn} onClick={() => onConfirm(reason)} disabled={busy}>
            {busy ? "Se respinge…" : "Respinge"}
          </button>
        </>
      }
    >
      <label className={styles.field}>
        <span>Motiv intern (opțional, nu este afișat vendorului)</span>
        <textarea rows={4} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
    </Modal>
  );
}

/* ===================== Tab ===================== */

function RegistrationsSection() {
  const [items, setItems] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [details, setDetails] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [cancelling, setCancelling] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      if (typeFilter) params.set("participationType", typeFilter);
      const qs = params.toString();
      const res = await api(`${API}/registrations${qs ? `?${qs}` : ""}`);
      setItems(Array.isArray(res?.items) ? res.items : []);
      setCounts(res?.counts || {});
    } catch (e) {
      setError(e?.message || "Nu am putut încărca înscrierile.");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, typeFilter]);

  useEffect(() => {
    load();
  }, [load]);

  // link direct din notificare: /admin?tab=artfestFair&registration=<id> => detaliile înscrierii
  const [searchParams, setSearchParams] = useSearchParams();
  const linkedRegistration = searchParams.get("registration");
  useEffect(() => {
    if (!linkedRegistration) return undefined;
    let cancelled = false;
    api(`${API}/registrations/${encodeURIComponent(linkedRegistration)}`)
      .then((res) => {
        if (!cancelled && res?.item) setDetails(res.item);
      })
      .catch((e) => {
        if (!cancelled) setError(e?.data?.message || e?.message || "Înscrierea din notificare nu a fost găsită.");
      });
    return () => {
      cancelled = true;
    };
  }, [linkedRegistration]);

  function closeDetails() {
    setDetails(null);
    if (linkedRegistration) {
      const next = new URLSearchParams(searchParams);
      next.delete("registration");
      setSearchParams(next, { replace: true });
    }
  }

  async function review(item, action, reason = null) {
    setBusyId(item.id);
    setError("");
    try {
      const res = await api(`${API}/registrations/${encodeURIComponent(item.id)}/${action}`, {
        method: "POST",
        body: action === "reject" ? { reason } : {},
      });
      setItems((prev) => prev.map((row) => (row.id === item.id ? res.item : row)));
      setRejecting(null);
      load();
    } catch (e) {
      setError(e?.data?.message || e?.message || "Acțiunea nu a reușit.");
    } finally {
      setBusyId(null);
    }
  }

  function onApprove(item) {
    if (!window.confirm(`Aprobi participarea vendorului „${item.vendorName || "—"}” la târg?`)) return;
    review(item, "approve");
  }

  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);

  return (
    <>
      <InvitePanel />

      <div className={styles.toolbar}>
        <h3 className={styles.panelTitle}>
          Înscrieri ({total}
          {total
            ? `: ${Object.entries(STATUS_LABEL)
                .filter(([key]) => counts[key])
                .map(([key, label]) => `${counts[key]} ${label.toLowerCase()}`)
                .join(", ")}`
            : ""}
          )
        </h3>
        <div className={styles.filters}>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filtru status">
            <option value="">Toate statusurile</option>
            {Object.entries(STATUS_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Filtru tip participare">
            <option value="">Toate tipurile</option>
            {Object.entries(TYPE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <div className={shared.error}>{error}</div>}

      {!items.length ? (
        <p className={shared.subtle}>{loading ? "Se încarcă…" : "Nu există înscrieri."}</p>
      ) : (
        <div className={shared.tableWrapper}>
          <table className={shared.table}>
            <thead>
              <tr>
                <th>Vendor</th>
                <th>Magazin</th>
                <th>Contact</th>
                <th>Telefon</th>
                <th>Email</th>
                <th>Tip participare</th>
                <th>Nr. estimat produse</th>
                <th>Data înscrierii</th>
                <th>Status</th>
                <th>Observații</th>
                <th>Acțiuni</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                // REJECTED doar pentru înscrieri neaprobate; o participare aprobată se anulează separat
                const canApprove = item.actions?.canApprove ?? (item.status === "SUBMITTED" || item.status === "REJECTED");
                const canReject = item.actions?.canReject ?? item.status === "SUBMITTED";
                const canCancel = item.actions?.canCancel ?? item.status === "APPROVED";
                const busy = busyId === item.id;
                return (
                  <tr key={item.id}>
                    <td>{item.vendorName || "—"}</td>
                    <td>{storeNames(item)}</td>
                    <td>{item.contactName}</td>
                    <td>{item.contactPhone}</td>
                    <td>{item.contactEmail}</td>
                    <td>{TYPE_LABEL[item.participationType] || item.participationType}</td>
                    <td>{item.estimatedProductCount ?? "—"}</td>
                    <td>{formatDate(item.submittedAt)}</td>
                    <td>
                      <span className={`${styles.badge} ${STATUS_TONE[item.status] || ""}`}>
                        {STATUS_LABEL[item.status] || item.status}
                      </span>
                    </td>
                    <td className={styles.notes} title={item.notes || ""}>
                      {item.notes || "—"}
                    </td>
                    <td>
                      <div className={styles.actions}>
                        <button type="button" className={styles.ghostBtn} onClick={() => setDetails(item)}>
                          Vezi detalii
                        </button>
                        {item.status !== "CANCELLED" && (
                          <button
                            type="button"
                            className={styles.successBtn}
                            onClick={() => onApprove(item)}
                            disabled={!canApprove || busy}
                          >
                            Aprobă
                          </button>
                        )}
                        {canCancel ? (
                          <button
                            type="button"
                            className={styles.dangerBtn}
                            onClick={() => setCancelling(item)}
                            disabled={busy}
                          >
                            Anulează participarea
                          </button>
                        ) : (
                          item.status !== "CANCELLED" && (
                            <button
                              type="button"
                              className={styles.dangerBtn}
                              onClick={() => setRejecting(item)}
                              disabled={!canReject || busy}
                            >
                              Respinge
                            </button>
                          )
                        )}
                        {item.status === "CANCELLED" && (
                          <button type="button" className={styles.ghostBtn} onClick={() => setDetails(item)}>
                            Istoric și retur
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {details && <RegistrationDetails item={details} onClose={closeDetails} />}
      {rejecting && (
        <RejectModal
          item={rejecting}
          busy={busyId === rejecting.id}
          onClose={() => setRejecting(null)}
          onConfirm={(reason) => review(rejecting, "reject", reason)}
        />
      )}
      {cancelling && (
        <CancelParticipationModal
          item={cancelling}
          onClose={() => setCancelling(null)}
          onDone={(next) => {
            setCancelling(null);
            if (next) setItems((prev) => prev.map((row) => (row.id === next.id ? next : row)));
            load();
          }}
        />
      )}
    </>
  );
}

/* ===================== Tab: Înscrieri | Recepție produse ===================== */

const SECTIONS = [
  { id: "registrations", label: "Înscrieri și invitație" },
  { id: "reception", label: "Recepție produse" },
  { id: "labels", label: "Etichete" },
  { id: "pos", label: "POS / Vânzare" },
  { id: "settlements", label: "Deconturi" },
];

export default function AdminArtfestFairTab() {
  const [searchParams, setSearchParams] = useSearchParams();
  const section = SECTIONS.some((s) => s.id === searchParams.get("section")) ? searchParams.get("section") : "registrations";

  function select(id) {
    const next = new URLSearchParams(searchParams);
    if (id === "registrations") next.delete("section");
    else next.set("section", id);
    setSearchParams(next, { replace: true });
  }

  return (
    <>
      <div className={styles.sections} role="tablist" aria-label="Târg Artfest">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={section === s.id}
            className={`${styles.sectionBtn} ${section === s.id ? styles.sectionBtnActive : ""}`}
            onClick={() => select(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>
      {section === "reception" ? (
        <AdminFairReceptionPanel />
      ) : section === "labels" ? (
        <AdminFairLabelsPanel />
      ) : section === "pos" ? (
        <AdminFairPosPanel />
      ) : section === "settlements" ? (
        <AdminFairSettlementsPanel />
      ) : (
        <RegistrationsSection />
      )}
    </>
  );
}
