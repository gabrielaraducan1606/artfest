// src/components/Returns/ReturnLogisticsPanel.jsx
//
// „Transport retur” în cardul unei cereri - pentru client (cont / guest) și
// vânzător. Date: câmpurile returnMethod / pickupAddress / returnShipment din
// listarea cererilor (services/returnRequestService.js). Doar afișare +
// acțiunile permise explicit de părinte:
//  - onSaveMethod: clientul își schimbă metoda / adresa (doar până la AWB);
//  - labelPath(format): eticheta PDF (doar cu AWB confirmat).
// Vânzătorul NU primește nicio acțiune asupra AWB-ului (contractul Artfest).

import { useState } from "react";
import ReturnPickupForm from "./ReturnPickupForm.jsx";
import {
  LABEL_FORMATS,
  RETURN_METHOD_LABELS,
  canEditReturnMethod,
  formFromPickup,
  methodChoicesFor,
  pickupSummary,
  returnProgressSteps,
} from "./returnLogistics.js";
import { downloadReturnLabel, printReturnLabel } from "./returnPdf.js";
import { returnStyles as rs } from "./returnUtils.js";
import styles from "./ReturnLogistics.module.css";

export function ReturnSteps({ rr }) {
  const steps = returnProgressSteps(rr);
  if (!steps.length) return null;
  return (
    <ol className={styles.steps} aria-label="Progresul returului">
      {steps.map((s) => (
        <li key={s.key} className={`${styles.step} ${styles[`step_${s.state}`]}`} aria-current={s.state === "current" ? "step" : undefined}>
          <span className={styles.stepDot} aria-hidden="true">
            {s.state === "done" ? "✓" : ""}
          </span>
          <span className={styles.stepLabel}>{s.label}</span>
        </li>
      ))}
    </ol>
  );
}

export function LabelButtons({ labelPath, awbNumber, filePrefix = "AWB-retur" }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function run(kind, format) {
    setBusy(`${kind}-${format}`);
    setError("");
    try {
      if (kind === "print") await printReturnLabel(labelPath(format));
      else await downloadReturnLabel(labelPath(format), `${filePrefix}-${awbNumber || "eticheta"}-${format}.pdf`);
    } catch (e) {
      setError(e?.message || "Eticheta nu este disponibilă momentan.");
    } finally {
      setBusy("");
    }
  }

  return (
    <>
      <div className={rs.actions}>
        {LABEL_FORMATS.map((format) => (
          <button key={`d-${format}`} type="button" className={`${rs.btn} ${format === "A6" ? rs.btnPrimary : ""}`} disabled={!!busy} onClick={() => run("download", format)}>
            {busy === `download-${format}` ? "Se descarcă…" : `Descarcă eticheta ${format}`}
          </button>
        ))}
        <button type="button" className={rs.btn} disabled={!!busy} onClick={() => run("print", "A6")}>
          {busy === "print-A6" ? "Se deschide…" : "Tipărește"}
        </button>
      </div>
      {error && <div className={rs.error}>{error}</div>}
    </>
  );
}

export default function ReturnLogisticsPanel({ rr, audience = "client", onSaveMethod = null, labelPath = null, defaultAddress = null }) {
  const [editing, setEditing] = useState(false);
  const ship = rr.returnShipment || null;
  const method = rr.returnMethod || null;
  const editable = audience === "client" && typeof onSaveMethod === "function" && canEditReturnMethod(rr);
  const closedOrRejected = ["REJECTED", "CLOSED"].includes(rr.status);

  // nimic de arătat: cerere veche fără metodă, închisă
  if (!method && !ship && (!editable || closedOrRejected)) return null;

  return (
    <section className={styles.panel} aria-label="Transport retur">
      <div className={styles.panelHead}>
        <span className={styles.panelTitle}>Transport retur</span>
        {method && <span className={styles.methodTag}>{RETURN_METHOD_LABELS[method] || method}</span>}
      </div>

      {!closedOrRejected && <ReturnSteps rr={rr} />}

      {!method && editable && !editing && (
        <div className={`${rs.notice} ${rs.notice_warning}`}>Alege cum returnezi produsul: ridicare de la adresă prin curier sau expediere de către tine.</div>
      )}

      {method === "HOME_PICKUP" && rr.pickupAddress && audience === "client" && !editing && (
        <div className={rs.fact}>
          <span className={rs.factLabel}>Adresa de ridicare confirmată</span>
          {rr.pickupAddress.name} · {rr.pickupAddress.phone}
          <br />
          {pickupSummary(rr.pickupAddress)}
        </div>
      )}

      {/* AWB + etichetă + urmărire */}
      {ship?.awbState === "CONFIRMED" && (
        <div className={styles.awbBox}>
          <div className={styles.awbRow}>
            <span className={rs.factLabel}>AWB retur</span>
            <strong className={styles.awbNumber}>{ship.awbNumber}</strong>
          </div>
          {audience === "client" ? (
            <p className={rs.hint}>
              Ridicarea a fost comandată. Lipește eticheta pe colet (sau ține-o pregătită pentru curier); curierul te va contacta
              pentru ridicare.
            </p>
          ) : (
            <p className={rs.hint}>
              AWB generat de echipa Artfest. Coletul pleacă de la client după ridicarea de către curier și ajunge la adresa ta de
              ridicare din setările de livrare.
              {ship.parcels ? ` Colete: ${ship.parcels}` : ""}
              {ship.weightKg ? ` · ${ship.weightKg} kg` : ""}
            </p>
          )}
          <div className={rs.actions}>
            {ship.trackingUrl && (
              <a className={`${rs.btn} ${rs.btnGhost}`} href={ship.trackingUrl} target="_blank" rel="noreferrer">
                Urmărește coletul →
              </a>
            )}
          </div>
          {labelPath && audience === "client" && <LabelButtons labelPath={labelPath} awbNumber={ship.awbNumber} />}
        </div>
      )}

      {ship?.awbState === "VERIFYING" && (
        <div className={`${rs.notice} ${rs.notice_warning}`}>
          {audience === "client"
            ? `Anularea ridicării pentru AWB-ul ${ship.awbNumber || ""} este în verificare la Sameday. Nu preda coletul cu această etichetă până nu te anunțăm.`
            : `Anularea ridicării pentru AWB-ul ${ship.awbNumber || ""} este în verificare la echipa Artfest.`}
        </div>
      )}

      {ship?.awbState === "PENDING" && (
        <div className={`${rs.notice} ${rs.notice_info}`}>
          AWB-ul de retur este în curs de confirmare la Sameday. Eticheta apare aici după confirmare.
        </div>
      )}

      {Array.isArray(ship?.cancelledAwbs) && ship.cancelledAwbs.length > 0 && (
        <p className={rs.hint}>
          {ship.cancelledAwbs.length === 1 ? "AWB anterior anulat: " : "AWB-uri anterioare anulate: "}
          {ship.cancelledAwbs.map((a) => a.awbNumber).join(", ")}
          {audience === "client" ? " - etichetele acestora nu mai sunt valabile." : "."}
        </p>
      )}

      {audience === "vendor" && rr.receivedNeedsDelivery && (
        <p className={rs.hint}>
          „Am primit produsul” devine disponibil după ce curierul confirmă livrarea coletului de retur. Dacă ai primit deja coletul,
          contactează suportul Artfest.
        </p>
      )}

      {ship && ship.awbState === "NONE" && rr.status !== "CLOSED" && (
        <div className={`${rs.notice} ${rs.notice_info}`}>
          {audience === "client"
            ? "Coletul de retur este pregătit de echipa Artfest. Vei primi eticheta după comandarea ridicării."
            : "Echipa Artfest pregătește ridicarea coletului de retur prin curier."}
        </div>
      )}

      {method === "CUSTOMER_SELF" && !ship && rr.status === "APPROVED" && (
        <p className={rs.hint}>
          {audience === "client"
            ? "Expediezi tu coletul, la adresa din instrucțiunile vânzătorului."
            : "Clientul expediază singur coletul, la adresa ta de retur."}
        </p>
      )}

      {editable && !editing && (
        <div className={rs.actions}>
          <button type="button" className={rs.btn} onClick={() => setEditing(true)}>
            {method ? "Modifică metoda sau adresa" : "Alege metoda de retur"}
          </button>
        </div>
      )}

      {editable && editing && (
        <ReturnPickupForm
          initialMethod={method}
          initialForm={formFromPickup(rr.pickupAddress, defaultAddress)}
          methods={methodChoicesFor(rr)}
          onCancel={() => setEditing(false)}
          onSubmit={async (m, address) => {
            await onSaveMethod(m, address);
            setEditing(false);
          }}
        />
      )}

      {audience === "client" && !editable && method && !closedOrRejected && ship?.awbState !== "NONE" && ship && (
        <p className={rs.hint}>Metoda și adresa nu mai pot fi schimbate după generarea AWB-ului. Pentru modificări, contactează suportul Artfest.</p>
      )}
    </section>
  );
}
