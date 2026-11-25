// src/pages/Admin/AdminDesktop/tabs/AdminSecretSantaTab.jsx
//
// Admin -> Secret Santa: ediții, deschidere / închidere înscrieri, participanți,
// extragere (confirmată cu cheia ediției), expedieri, retrimiterea emailurilor
// nereușite și ștergerea datelor de livrare după eveniment. Separat de Târg.

import { useCallback, useEffect, useState } from "react";
import { api } from "../../../../lib/api";
import { SS_ADMIN_API } from "../../../SecretSanta/secretSanta.js";
import styles from "./AdminSecretSantaTab.module.css";
import AdminSecretSantaInvite from "./AdminSecretSantaInvite.jsx";

const STATUS_LABEL = {
  DRAFT: "Ciornă (nepublicată)",
  OPEN: "Înscrieri deschise",
  CLOSED: "Înscrieri închise",
  DRAWN: "Extragere realizată",
};

function fmt(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("ro-RO", { timeZone: "Europe/Bucharest" });
}

// <input type="datetime-local"> <-> ISO
function toLocalInput(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
const fromLocalInput = (value) => (value ? new Date(value).toISOString() : null);

const errorText = (err, fallback) => err?.data?.message || err?.message || fallback;

export default function AdminSecretSantaTab() {
  const [editions, setEditions] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState("");

  const loadEditions = useCallback(async () => {
    try {
      const data = await api(`${SS_ADMIN_API}/editions`);
      const list = data?.editions || [];
      setEditions(list);
      setSelectedId((prev) => prev || list[0]?.id || "");
      setError("");
    } catch (err) {
      setError(errorText(err, "Nu am putut încărca edițiile."));
    }
  }, []);

  useEffect(() => {
    loadEditions();
  }, [loadEditions]);

  return (
    <div className={styles.wrap}>
      <header className={styles.head}>
        <p className={styles.muted}>
          Pagina publică: <a href="/secret-santa">/secret-santa</a>. Se afișează cea mai nouă ediție care nu e ciornă și nu e de test.
        </p>
      </header>
      {error ? <p className={styles.error}>{error}</p> : null}

      {/* invitația prin email către vânzători (ediția publică curentă) */}
      <AdminSecretSantaInvite />

      <div className={styles.toolbar}>
        <label className={styles.inline}>
          Ediția
          <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
            {editions.length ? null : <option value="">Nicio ediție</option>}
            {editions.map((edition) => (
              <option key={edition.id} value={edition.id}>
                {edition.title} ({edition._count?.participants || 0})
              </option>
            ))}
          </select>
        </label>
      </div>

      <NewEdition
        onCreated={async (edition) => {
          await loadEditions();
          setSelectedId(edition.id);
        }}
      />

      {selectedId ? <EditionPanel key={selectedId} editionId={selectedId} onChanged={loadEditions} /> : null}
    </div>
  );
}

function NewEdition({ onCreated }) {
  const year = new Date().getFullYear();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ key: `SECRET_SANTA_${year}`, title: `Secret Santa Artfest ${year}` });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!open) {
    return (
      <button type="button" className={styles.ghost} onClick={() => setOpen(true)}>
        + Ediție nouă
      </button>
    );
  }

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = await api(`${SS_ADMIN_API}/editions`, { method: "POST", body: form });
      setOpen(false);
      await onCreated(data.edition);
    } catch (err) {
      setError(errorText(err, "Nu am putut crea ediția."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={styles.box} onSubmit={submit}>
      <div className={styles.row}>
        <label className={styles.field}>
          Cheie (unică)
          <input value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} />
        </label>
        <label className={styles.field}>
          Titlu
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </label>
      </div>
      {error ? <p className={styles.error}>{error}</p> : null}
      <div className={styles.actions}>
        <button type="submit" className={styles.primary} disabled={busy}>
          Creează ciorna
        </button>
        <button type="button" className={styles.ghost} onClick={() => setOpen(false)} disabled={busy}>
          Renunță
        </button>
      </div>
    </form>
  );
}

function EditionPanel({ editionId, onChanged }) {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmKind, setConfirmKind] = useState(null); // "draw" | "purge"
  const [confirmText, setConfirmText] = useState("");

  const load = useCallback(async () => {
    try {
      const result = await api(`${SS_ADMIN_API}/editions/${encodeURIComponent(editionId)}`);
      setData(result);
      setForm({
        title: result.edition.title,
        registrationClosesAt: toLocalInput(result.edition.registrationClosesAt),
        shipByAt: toLocalInput(result.edition.shipByAt),
      });
      setError("");
    } catch (err) {
      setError(errorText(err, "Nu am putut încărca ediția."));
    }
  }, [editionId]);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (fn, okMessage) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      if (okMessage) setNotice(okMessage);
      await Promise.all([load(), onChanged()]);
    } catch (err) {
      setError(errorText(err, "Operația nu a reușit."));
    } finally {
      setBusy(false);
    }
  };

  if (!data || !form) return error ? <p className={styles.error}>{error}</p> : <p className={styles.muted}>Se încarcă…</p>;

  const { edition, participants } = data;
  const base = `${SS_ADMIN_API}/editions/${encodeURIComponent(edition.id)}`;
  const drawn = edition.status === "DRAWN";
  const byId = Object.fromEntries(participants.map((p) => [p.id, p]));
  const shipped = participants.filter((p) => p.giving?.shippedAt).length;
  const emailFailed = participants.filter((p) => p.giving && !p.giving.emailSentAt).length;

  const saveDetails = (event) => {
    event.preventDefault();
    run(
      () =>
        api(base, {
          method: "PATCH",
          body: {
            title: form.title,
            registrationClosesAt: fromLocalInput(form.registrationClosesAt),
            shipByAt: fromLocalInput(form.shipByAt),
          },
        }),
      "Detaliile au fost salvate."
    );
  };

  const setStatus = (status) =>
    run(() => api(`${base}/status`, { method: "POST", body: { status } }), status === "OPEN" ? "Înscrierile sunt deschise." : "Înscrierile sunt închise.");

  const confirmAction = () =>
    run(async () => {
      if (confirmKind === "draw") {
        await api(`${base}/draw`, { method: "POST", body: { confirm: confirmText.trim() } });
      } else {
        await api(`${base}/purge`, { method: "POST", body: { confirm: confirmText.trim() } });
      }
      setConfirmKind(null);
      setConfirmText("");
    }, confirmKind === "draw" ? "Extragerea a fost realizată. Emailurile pleacă acum; reîncarcă lista peste un minut." : "Datele de livrare au fost șterse.");

  return (
    <section className={styles.box}>
      <div className={styles.statusLine}>
        {data.meta?.test ? <span className={`${styles.badge} ${styles.badgeDRAWN}`}>TEST</span> : null}
        <span className={`${styles.badge} ${styles[`badge${edition.status}`] || ""}`}>{STATUS_LABEL[edition.status]}</span>
        <span className={styles.muted}>
          {participants.length === 1 ? "1 participant" : `${participants.length} participanți`}
          {drawn ? ` · ${shipped} cadouri expediate · extragere ${fmt(edition.drawnAt)}` : ""}
        </span>
      </div>

      <form className={styles.row} onSubmit={saveDetails}>
        <label className={styles.field}>
          Titlu
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </label>
        <label className={styles.field}>
          Înscrieri până la
          <input type="datetime-local" value={form.registrationClosesAt} onChange={(e) => setForm({ ...form, registrationClosesAt: e.target.value })} />
        </label>
        <label className={styles.field}>
          Expediere până la
          <input type="datetime-local" value={form.shipByAt} onChange={(e) => setForm({ ...form, shipByAt: e.target.value })} />
        </label>
        <button type="submit" className={styles.ghost} disabled={busy}>
          Salvează
        </button>
      </form>

      <div className={styles.actions}>
        {edition.status === "DRAFT" || edition.status === "CLOSED" ? (
          <button type="button" className={styles.primary} onClick={() => setStatus("OPEN")} disabled={busy}>
            {edition.status === "DRAFT" ? "Publică și deschide înscrierile" : "Redeschide înscrierile"}
          </button>
        ) : null}
        {edition.status === "OPEN" ? (
          <button type="button" className={styles.ghost} onClick={() => setStatus("CLOSED")} disabled={busy}>
            Închide înscrierile
          </button>
        ) : null}
        {edition.status === "CLOSED" ? (
          <button type="button" className={styles.danger} onClick={() => setConfirmKind("draw")} disabled={busy || participants.length < 2}>
            Realizează extragerea
          </button>
        ) : null}
        {drawn && emailFailed ? (
          <button
            type="button"
            className={styles.ghost}
            onClick={() => run(() => api(`${base}/resend-emails`, { method: "POST" }), "Retrimiterea a pornit; reîncarcă lista peste un minut.")}
            disabled={busy || Boolean(edition.personalDataPurgedAt)}
          >
            Retrimite emailurile netrimise ({emailFailed})
          </button>
        ) : null}
        {drawn ? (
          <button type="button" className={styles.ghost} onClick={load} disabled={busy}>
            Reîncarcă
          </button>
        ) : null}
        {drawn && !edition.personalDataPurgedAt ? (
          <button type="button" className={styles.dangerGhost} onClick={() => setConfirmKind("purge")} disabled={busy}>
            Șterge datele de livrare
          </button>
        ) : null}
      </div>

      {confirmKind ? (
        <div className={styles.confirm} role="alertdialog" aria-label="Confirmare">
          <p>
            {confirmKind === "draw"
              ? `Extragerea pentru ${participants.length} participanți este definitivă și nu poate fi repetată. Fiecare participant primește imediat emailul cu destinatarul.`
              : "Se șterg numele, adresele, telefoanele, emailurile, preferințele și AWB-urile tuturor participanților. Operația este definitivă."}
          </p>
          <label className={styles.field}>
            Scrie cheia ediției ({edition.key}) pentru confirmare
            <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" />
          </label>
          <div className={styles.actions}>
            <button type="button" className={styles.danger} onClick={confirmAction} disabled={busy || confirmText.trim() !== edition.key}>
              {confirmKind === "draw" ? "Confirm extragerea" : "Confirm ștergerea"}
            </button>
            <button type="button" className={styles.ghost} onClick={() => { setConfirmKind(null); setConfirmText(""); }} disabled={busy}>
              Renunță
            </button>
          </div>
        </div>
      ) : null}

      {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
      {error ? <p className={styles.error}>{error}</p> : null}
      {data.meta?.test ? (
        <p className={styles.muted}>
          Ediție de test: nu apare public, emailurile sunt simulate. Pagina de test pentru conturile de test:{" "}
          <a href={`/secret-santa?test=${encodeURIComponent(edition.key)}`}>/secret-santa?test={edition.key}</a>. La final,
          folosește „Șterge datele de livrare”.
        </p>
      ) : null}
      {data.meta?.registrationOpensAt ? (
        <p className={styles.muted}>
          Înscrierile se deschid automat pe {fmt(data.meta.registrationOpensAt)} (dacă ediția este publicată), nu mai devreme.
        </p>
      ) : null}
      {edition.personalDataPurgedAt ? <p className={styles.muted}>Datele de livrare au fost șterse la {fmt(edition.personalDataPurgedAt)}.</p> : null}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Magazin</th>
              <th>Destinatar / livrare</th>
              <th>Contact</th>
              {drawn ? <th>Trimite către</th> : null}
              {drawn ? <th>Email rezultat</th> : null}
              {drawn ? <th>Expediere</th> : null}
              {!drawn ? <th /> : null}
            </tr>
          </thead>
          <tbody>
            {participants.map((p) => (
              <tr key={p.id}>
                <td>
                  <strong>{p.storeName}</strong>
                  <div className={styles.muted}>înscris {fmt(p.createdAt)}</div>
                </td>
                <td>
                  {p.recipientName || "—"}
                  <div className={styles.muted}>
                    {[p.address, p.city, p.county && `jud. ${p.county}`, p.postalCode].filter(Boolean).join(", ")}
                  </div>
                  {p.preferences ? <div className={styles.muted}>Preferințe: {p.preferences}</div> : null}
                </td>
                <td>
                  {p.email || "—"}
                  <div className={styles.muted}>{p.phone}</div>
                </td>
                {drawn ? <td>{byId[p.giving?.receiverId]?.storeName || "—"}</td> : null}
                {drawn ? (
                  <td>
                    {p.giving?.emailError === "simulated_test" ? (
                      "simulat (test) – nimic trimis"
                    ) : p.giving?.emailSentAt ? (
                      `trimis ${fmt(p.giving.emailSentAt)}`
                    ) : (
                      <span className={styles.error}>netrimis{p.giving?.emailError ? ` (${p.giving.emailError})` : ""}</span>
                    )}
                  </td>
                ) : null}
                {drawn ? (
                  <td>
                    {p.giving?.shippedAt ? `expediat ${fmt(p.giving.shippedAt)}` : "în pregătire"}
                    {p.giving?.awb ? <div className={styles.muted}>AWB {p.giving.awb}{p.giving.courierName ? ` · ${p.giving.courierName}` : ""}</div> : null}
                  </td>
                ) : null}
                {!drawn ? (
                  <td>
                    <button
                      type="button"
                      className={styles.dangerGhost}
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm(`Elimini participantul „${p.storeName}”? Datele lui de livrare se șterg.`)) {
                          run(() => api(`${base}/participants/${encodeURIComponent(p.id)}`, { method: "DELETE" }), "Participantul a fost eliminat.");
                        }
                      }}
                    >
                      Elimină
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
            {!participants.length ? (
              <tr>
                <td colSpan={6} className={styles.muted}>
                  Încă nu există participanți.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
