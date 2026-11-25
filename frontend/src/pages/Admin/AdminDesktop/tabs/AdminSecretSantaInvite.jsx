// src/pages/Admin/AdminDesktop/tabs/AdminSecretSantaInvite.jsx
//
// Admin -> Secret Santa -> „Invitație prin email”: numărul vânzătorilor eligibili
// (calculat pe server), previzualizarea exactă a emailului, emailul de test către o
// singură adresă și trimiterea către toți (cu confirmare, în fundal, fără duplicate).
// Rezultatele (trimise / eșuate / data) sunt salvate pe server per destinatar.

import { useCallback, useEffect, useState } from "react";
import { api } from "../../../../lib/api";
import { SS_ADMIN_API, inviteSendDisabledReason } from "../../../SecretSanta/secretSanta.js";
import styles from "./AdminSecretSantaTab.module.css";

const INVITE_API = `${SS_ADMIN_API}/invite`;
const POLL_MS = 3000;

function fmt(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("ro-RO", { timeZone: "Europe/Bucharest" });
}
const errorText = (err, fallback) => err?.data?.message || err?.message || fallback;

export default function AdminSecretSantaInvite() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [testEmail, setTestEmail] = useState("");
  const [busy, setBusy] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [previewWidth, setPreviewWidth] = useState(375);

  const load = useCallback(async () => {
    try {
      setData(await api(INVITE_API));
      setError("");
    } catch (err) {
      setError(errorText(err, "Nu am putut încărca invitația."));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // în timpul trimiterii: progres + rezultate, fără reîncărcarea paginii
  const running = Boolean(data?.run?.running);
  useEffect(() => {
    if (!running) return undefined;
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [running, load]);

  const sendTest = async (event) => {
    event.preventDefault();
    setBusy("test");
    setError("");
    setNotice("");
    try {
      const out = await api(`${INVITE_API}/test`, { method: "POST", body: { email: testEmail } });
      setNotice(`Emailul de test a fost trimis către ${out.to}.`);
    } catch (err) {
      setError(errorText(err, "Emailul de test nu a putut fi trimis."));
    } finally {
      setBusy("");
    }
  };

  const sendAll = async () => {
    setBusy("send");
    setError("");
    setNotice("");
    try {
      await api(`${INVITE_API}/send`, { method: "POST", body: { confirm: true, expectedCount: data.willSend } });
      setConfirming(false);
      setNotice("Trimiterea a început. Poți închide pagina: emailurile pleacă în fundal, iar rezultatele rămân salvate.");
    } catch (err) {
      setConfirming(false);
      setError(errorText(err, "Trimiterea nu a putut fi pornită."));
    } finally {
      setBusy("");
      load();
    }
  };

  if (!data) {
    return (
      <section className={styles.box} aria-label="Invitație prin email">
        <h3 className={styles.title}>Invitație prin email către vânzători</h3>
        {error ? <p className={styles.error}>{error}</p> : <p className={styles.muted}>Se încarcă…</p>}
      </section>
    );
  }

  const disabledReason = inviteSendDisabledReason(data);
  const progress = data.run?.current?.progress;
  const lastRun = data.run?.last;

  return (
    <section className={styles.box} aria-label="Invitație prin email" data-ss-invite>
      <div>
        <h3 className={styles.title}>Invitație prin email către vânzători</h3>
        <p className={styles.muted}>
          Ediția: {data.edition ? `${data.edition.title} (${data.edition.registrationOpen ? "înscrieri deschise" : "înscrieri închise"})` : "nicio ediție publicată"}.
          Destinatari: vânzătorii care se pot înscrie, cu email confirmat și acord pentru noutăți, nedezabonați și încă neînscriși; o singură invitație per adresă.
        </p>
      </div>

      <div className={styles.statusLine} data-ss-invite-counts>
        <span className={styles.badge}>
          Eligibili: <strong data-ss-invite-eligible>{data.eligible}</strong>
        </span>
        <span className={styles.badge}>
          De trimis: <strong data-ss-invite-willsend>{data.willSend}</strong>
        </span>
        <span className={styles.badge}>Deja trimise: {data.counts.alreadySent}</span>
        {data.counts.failedRetry ? <span className={styles.badge}>Eșuate (se reîncearcă): {data.counts.failedRetry}</span> : null}
        {data.counts.unknown ? <span className={styles.badge}>Stare necunoscută (nu se retrimit): {data.counts.unknown}</span> : null}
      </div>

      {data.excluded?.length ? (
        <details>
          <summary className={styles.muted}>Excluși ({data.excluded.reduce((sum, e) => sum + e.count, 0)}), pe motive</summary>
          <ul className={styles.muted}>
            {data.excluded.map((e) => (
              <li key={e.reason}>
                {e.label}: {e.count}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <div className={styles.statusLine} data-ss-invite-results>
        <span>
          Rezultate salvate: <strong>{data.results.sent}</strong> trimise, <strong>{data.results.failed}</strong> eșuate
          {data.results.unknown ? `, ${data.results.unknown} cu stare necunoscută` : ""}
        </span>
        <span className={styles.muted}>
          Prima trimitere: {fmt(data.results.firstSentAt)} · Ultima: {fmt(data.results.lastSentAt)}
        </span>
      </div>
      {data.results.failures?.length ? (
        <details>
          <summary className={styles.muted}>Adrese cu probleme ({data.results.failures.length})</summary>
          <ul className={styles.muted}>
            {data.results.failures.map((f) => (
              <li key={`${f.email}-${f.at}`}>
                {f.email} - {f.status === "UNKNOWN" ? "stare necunoscută (nu se retrimite automat)" : f.error || "eroare"}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {running ? (
        <p className={styles.notice} role="status" data-ss-invite-progress>
          Trimitere în curs: {progress?.processed || 0} / {data.run.current.total} procesați · {progress?.sent || 0} trimise ·{" "}
          {progress?.failed || 0} eșuate
        </p>
      ) : lastRun ? (
        <p className={styles.muted}>
          Ultima rulare (încheiată {fmt(lastRun.finishedAt)}): {lastRun.result?.sent || 0} trimise, {lastRun.result?.failed || 0} eșuate
          {lastRun.error ? ` - oprită: ${lastRun.error}` : ""}.
        </p>
      ) : null}

      {notice ? (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      ) : null}
      {error ? <p className={styles.error}>{error}</p> : null}

      <form className={styles.row} onSubmit={sendTest}>
        <label className={styles.field}>
          Adresa pentru emailul de test
          <input type="email" value={testEmail} onChange={(e) => setTestEmail(e.target.value)} placeholder="nume@exemplu.ro" autoComplete="email" required data-ss-invite-test-email />
        </label>
        <button type="submit" className={styles.ghost} disabled={busy !== "" || !testEmail.trim()} data-ss-invite-test>
          {busy === "test" ? "Se trimite…" : "Trimite email de test"}
        </button>
      </form>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.primary}
          disabled={Boolean(disabledReason) || busy !== "" || confirming}
          onClick={() => setConfirming(true)}
          data-ss-invite-send
        >
          Trimite invitația vânzătorilor
        </button>
        {disabledReason ? <span className={styles.muted}>{disabledReason}</span> : null}
      </div>

      {confirming ? (
        <div className={styles.confirm} role="alertdialog" aria-label="Confirmare trimitere">
          <p>
            Trimiți invitația Secret Santa către <strong>{data.willSend}</strong> {data.willSend === 1 ? "vânzător" : "vânzători"}? Emailurile pleacă
            în fundal; cei care au primit-o deja nu o mai primesc.
          </p>
          <div className={styles.actions}>
            <button type="button" className={styles.danger} onClick={sendAll} disabled={busy !== ""} data-ss-invite-confirm>
              {busy === "send" ? "Se pornește…" : `Da, trimite către ${data.willSend}`}
            </button>
            <button type="button" className={styles.ghost} onClick={() => setConfirming(false)} disabled={busy !== ""}>
              Renunță
            </button>
          </div>
        </div>
      ) : null}

      <div>
        <div className={styles.statusLine}>
          <strong>Previzualizare</strong>
          <span className={styles.muted}>Subiect: {data.email.subject}</span>
        </div>
        <div className={styles.actions} style={{ margin: "8px 0" }}>
          {[
            [375, "Telefon"],
            [640, "Desktop"],
          ].map(([w, label]) => (
            <button key={w} type="button" className={styles.ghost} aria-pressed={previewWidth === w} onClick={() => setPreviewWidth(w)}>
              {label}
            </button>
          ))}
        </div>
        <iframe
          title="Previzualizare email Secret Santa"
          srcDoc={data.email.html}
          sandbox=""
          data-ss-invite-preview
          style={{ width: "100%", maxWidth: previewWidth, height: 900, border: "1px solid var(--color-border)", borderRadius: 12, background: "#fff" }}
        />
      </div>
    </section>
  );
}
