import { useEffect, useId, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, Loader2, PauseCircle, PlayCircle, RefreshCw, Store, Unplug } from "lucide-react";

import styles from "./WooCommerceImport.module.css";
import { connectionStatus, errorMessage } from "./wooImportLogic.js";
import { wooApi } from "./wooApi.js";

function formatDate(value) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("ro-RO", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  } catch {
    return "—";
  }
}


/** Cardul magazinului conectat: identificare, verificare, pauză, deconectare. */
export function WooConnectionCard({ connection, onChange, onDisconnected }) {
  const id = useId();
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const confirmRef = useRef(null);

  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);

  const status = connectionStatus(connection);

  async function run(kind, action, success) {
    setBusy(kind);
    setNotice(null);
    try {
      const data = await action();
      if (data?.connection) onChange(data.connection);
      setNotice({ tone: "success", text: success });
      return data;
    } catch (err) {
      setNotice({ tone: "error", text: errorMessage(err.code, err.message) });
      // starea de eroare e salvată pe conexiune: o reîncărcăm
      if (kind === "test") wooApi.status(connection.id).then((d) => d?.connection && onChange(d.connection)).catch(() => {});
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function handleDisconnect() {
    const data = await run("disconnect", () => wooApi.disconnect(connection.id), "Magazinul a fost deconectat.");
    setConfirming(false);
    if (data) onDisconnected(data.connection);
  }

  return (
    <section className={styles.panel} aria-labelledby={`${id}-shop`}>
      <div className={styles.shopHead}>
        <span className={styles.panelIcon}>
          <Store size={20} />
        </span>
        <div className={styles.shopInfo}>
          <h3 id={`${id}-shop`}>{connection.label || "Magazin WooCommerce"}</h3>
          <a href={connection.shopUrl} target="_blank" rel="noopener noreferrer" className={styles.shopUrl}>
            {connection.shopUrl.replace(/^https:\/\//, "")}
          </a>
        </div>
        <span className={`${styles.statusPill} ${styles[`tone_${status.tone}`]}`}>{status.label}</span>
      </div>

      <dl className={styles.facts}>
        <div>
          <dt>Produse în magazin</dt>
          <dd>{connection.storeProductCount ?? "—"}</dd>
        </div>
        <div>
          <dt>Monedă</dt>
          <dd>{connection.storeCurrency || "—"}</dd>
        </div>
        <div>
          <dt>Ultima verificare</dt>
          <dd>{formatDate(connection.lastTestedAt)}</dd>
        </div>
        <div>
          <dt>Cheie API</dt>
          <dd>{connection.hasCredentials ? "Salvată criptat" : "Lipsă"}</dd>
        </div>
      </dl>

      {connection.storeCurrency && connection.storeCurrency !== "RON" && (
        <div className={styles.alertWarning} role="status">
          <AlertTriangle size={18} />
          <p>
            Magazinul folosește moneda {connection.storeCurrency}. Pe Artfest prețurile sunt în lei, așa că produsele nu pot fi
            importate până când magazinul nu folosește RON.
          </p>
        </div>
      )}

      {connection.status === "ERROR" && connection.lastErrorCode && (
        <div className={styles.alertError} role="status">
          <AlertTriangle size={18} />
          <div>
            <strong>Ultima verificare a eșuat ({formatDate(connection.lastErrorAt)})</strong>
            <p>{errorMessage(connection.lastErrorCode, connection.lastErrorMessage)}</p>
          </div>
        </div>
      )}

      {notice && (
        <div className={notice.tone === "error" ? styles.alertError : styles.alertSuccess} role={notice.tone === "error" ? "alert" : "status"}>
          {notice.tone === "error" ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
          <p>{notice.text}</p>
        </div>
      )}

      <div className={styles.actions}>
        <button type="button" className={styles.secondaryBtn} disabled={Boolean(busy)} onClick={() => run("test", () => wooApi.test(connection.id), "Conexiunea funcționează.")}>
          {busy === "test" ? <Loader2 size={16} className={styles.spin} /> : <RefreshCw size={16} />}
          Verifică din nou
        </button>
        <button
          type="button"
          className={styles.secondaryBtn}
          disabled={Boolean(busy)}
          aria-pressed={connection.isPaused}
          onClick={() =>
            run(
              "pause",
              () => wooApi.update(connection.id, { isPaused: !connection.isPaused }),
              connection.isPaused ? "Sincronizarea a fost reluată." : "Sincronizarea a fost pusă pe pauză."
            )
          }
        >
          {busy === "pause" ? <Loader2 size={16} className={styles.spin} /> : connection.isPaused ? <PlayCircle size={16} /> : <PauseCircle size={16} />}
          {connection.isPaused ? "Reia sincronizarea" : "Pune pe pauză"}
        </button>
        <button type="button" className={styles.dangerGhostBtn} disabled={Boolean(busy)} onClick={() => setConfirming(true)}>
          <Unplug size={16} />
          Deconectează
        </button>
      </div>

      {confirming && (
        <div className={styles.confirmBox} role="alertdialog" aria-labelledby={`${id}-confirm`} aria-describedby={`${id}-confirm-desc`}>
          <strong id={`${id}-confirm`}>Deconectezi magazinul?</strong>
          <p id={`${id}-confirm-desc`}>
            Cheile API se șterg din Artfest. Produsele deja importate rămân în catalogul tău, dar nu se mai leagă de magazinul
            WooCommerce. Te poți conecta din nou oricând.
          </p>
          <div className={styles.actions}>
            <button ref={confirmRef} type="button" className={styles.dangerBtn} disabled={busy === "disconnect"} onClick={handleDisconnect}>
              {busy === "disconnect" ? <Loader2 size={16} className={styles.spin} /> : <Unplug size={16} />}
              Da, deconectează
            </button>
            <button type="button" className={styles.secondaryBtn} disabled={busy === "disconnect"} onClick={() => setConfirming(false)}>
              Renunță
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/** Setările de sincronizare acceptate de backend + starea reală. */
export function WooSyncSettings({ connection, onChange }) {
  const id = useId();
  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState("");
  const [buffer, setBuffer] = useState(String(connection.safetyBufferQty ?? 0));
  const [bufferError, setBufferError] = useState("");
  const [saving, setSaving] = useState(null);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    let alive = true;
    wooApi
      .status(connection.id)
      .then((data) => alive && setStatus(data))
      .catch((err) => alive && setStatusError(errorMessage(err.code, err.message)));
    return () => {
      alive = false;
    };
  }, [connection.id, connection.lastTestedAt, connection.isPaused]);

  useEffect(() => setBuffer(String(connection.safetyBufferQty ?? 0)), [connection.safetyBufferQty]);

  async function save(kind, body, success) {
    setSaving(kind);
    setNotice(null);
    try {
      const data = await wooApi.update(connection.id, body);
      onChange(data.connection);
      setNotice({ tone: "success", text: success });
    } catch (err) {
      setNotice({ tone: "error", text: errorMessage(err.code, err.message) });
    } finally {
      setSaving(null);
    }
  }

  function saveBuffer(event) {
    event.preventDefault();
    const qty = Number(buffer);
    if (!Number.isInteger(qty) || qty < 0 || qty > 1000) {
      setBufferError("Introdu un număr întreg între 0 și 1000.");
      return;
    }
    setBufferError("");
    save("buffer", { safetyBufferQty: qty }, "Rezerva de siguranță a fost salvată.");
  }

  const automatic = status?.automaticSync === true;

  return (
    <section className={styles.panel} aria-labelledby={`${id}-title`}>
      <div className={styles.panelHead}>
        <span className={styles.panelIcon}>
          <RefreshCw size={20} />
        </span>
        <div>
          <h3 id={`${id}-title`}>Sincronizare</h3>
          <p>Alege cum se va păstra stocul la zi între WooCommerce și Artfest.</p>
        </div>
      </div>

      {status && !automatic && (
        <div className={styles.alertInfo} role="status">
          <Info size={18} />
          <div>
            <strong>Sincronizarea automată nu este încă pornită</strong>
            <p>
              Setările de mai jos se salvează acum și se vor aplica atunci când Artfest pornește sincronizarea automată. Până
              atunci, stocul produselor importate nu se actualizează singur.
            </p>
          </div>
        </div>
      )}

      <fieldset className={styles.fieldset}>
        <legend>Ce se sincronizează</legend>
        <label className={styles.choice}>
          <input type="radio" name={`${id}-mode`} checked={!connection.syncContent} readOnly />
          <span>
            <strong>Doar stocul</strong>
            <small>Cantitățile disponibile, pe produs și pe variante.</small>
          </span>
        </label>
        <label className={`${styles.choice} ${styles.choiceDisabled}`}>
          <input type="radio" name={`${id}-mode`} disabled aria-describedby={`${id}-content-na`} />
          <span>
            <strong>
              Stoc, conținut și prețuri <span className={styles.soonBadge}>Indisponibil momentan</span>
            </strong>
            <small id={`${id}-content-na`}>Titlurile, descrierile, pozele și prețurile nu se sincronizează încă. Le modifici din Artfest.</small>
          </span>
        </label>
      </fieldset>

      <fieldset className={styles.fieldset} disabled={saving === "master"}>
        <legend>Sursa principală a stocului</legend>
        {[
          ["EXTERNAL", "Magazinul WooCommerce", "Stocul din WooCommerce e cel corect; Artfest îl preia."],
          ["ARTFEST", "Artfest", "Stocul din Artfest e cel corect; magazinul WooCommerce îl primește."],
        ].map(([value, title, hint]) => (
          <label key={value} className={styles.choice}>
            <input
              type="radio"
              name={`${id}-master`}
              value={value}
              checked={connection.stockMaster === value}
              onChange={() => save("master", { stockMaster: value }, "Sursa stocului a fost salvată.")}
            />
            <span>
              <strong>{title}</strong>
              <small>{hint}</small>
            </span>
          </label>
        ))}
      </fieldset>

      <form className={styles.inlineForm} onSubmit={saveBuffer} noValidate>
        <div className={styles.field}>
          <label htmlFor={`${id}-buffer`}>Rezervă de siguranță (bucăți)</label>
          <input
            id={`${id}-buffer`}
            className={`${styles.input} ${styles.inputNarrow} ${bufferError ? styles.inputInvalid : ""}`}
            type="number"
            inputMode="numeric"
            min="0"
            max="1000"
            step="1"
            value={buffer}
            onChange={(e) => {
              setBuffer(e.target.value);
              setBufferError("");
            }}
            aria-invalid={Boolean(bufferError)}
            aria-describedby={`${id}-buffer-hint`}
          />
          <span id={`${id}-buffer-hint`} className={bufferError ? styles.fieldError : styles.fieldHint} role={bufferError ? "alert" : undefined}>
            {bufferError || "Câte bucăți păstrezi deoparte, ca să eviți vânzarea aceluiași produs în ambele magazine."}
          </span>
        </div>
        <button type="submit" className={styles.secondaryBtn} disabled={saving === "buffer"}>
          {saving === "buffer" && <Loader2 size={16} className={styles.spin} />}
          Salvează
        </button>
      </form>

      {notice && (
        <div className={notice.tone === "error" ? styles.alertError : styles.alertSuccess} role={notice.tone === "error" ? "alert" : "status"}>
          {notice.tone === "error" ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
          <p>{notice.text}</p>
        </div>
      )}

      <div className={styles.statusBlock}>
        <h4>Starea conexiunii</h4>
        {!status && !statusError && (
          <p className={styles.muted}>
            <Loader2 size={15} className={styles.spin} /> Se încarcă…
          </p>
        )}
        {statusError && <p className={styles.fieldError}>{statusError}</p>}
        {status && (
          <>
            <dl className={styles.facts}>
              <div>
                <dt>Produse legate</dt>
                <dd>{Object.values(status.products || {}).reduce((a, b) => a + b, 0)}</dd>
              </div>
              <div>
                <dt>Sincronizare automată</dt>
                <dd>{automatic ? (connection.isPaused ? "În pauză" : "Activă") : "Neactivată"}</dd>
              </div>
              <div>
                <dt>Ultima sincronizare reușită</dt>
                <dd>{formatDate(connection.lastSuccessAt)}</dd>
              </div>
              <div>
                <dt>Ultimul import</dt>
                <dd>{status.lastImport ? formatDate(status.lastImport.createdAt) : "—"}</dd>
              </div>
            </dl>
            {status.recentFailures?.length > 0 && (
              <ul className={styles.failureList}>
                {status.recentFailures.map((f, i) => (
                  <li key={i}>
                    <AlertTriangle size={15} />
                    <span>
                      {formatDate(f.at)}: {errorMessage(f.code, f.message)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </section>
  );
}
