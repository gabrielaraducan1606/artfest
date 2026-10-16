// src/pages/Vendor/Fair/FairSettlementsSection.jsx
//
// „Deconturi” la Târgul Artfest: doar deconturile finalizate ale vendorului din
// sesiune (serverul filtrează). Vendorul vede suma de primit și breakdown-ul,
// fără motive interne Admin; ajustările apar cu suma și, dacă există, nota
// pentru vendor. Fără factură / document fiscal în această etapă.

import { useCallback, useEffect, useState } from "react";
import { Download, Wallet } from "lucide-react";
import { api } from "../../../lib/api";
import { downloadLabelsPdf } from "./fairInventory.js";
import {
  SETTLEMENT_STATUS_LABEL,
  SETTLEMENT_STATUS_TONE,
  VENDOR_SETTLEMENTS_API as API,
  amountHeadline,
  formatDateRo,
  formatLei,
  periodText,
  signedLei,
} from "./fairSettlements.js";
import styles from "./FairInventory.module.css";

const DISPOSITION_LABEL = { RESTOCKED: "returnat, revandabil", NOT_RESTOCKED: "returnat, nevandabil", NOT_RETURNED: "rambursare fără produs" };

function Stat({ label, value }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function SettlementDetail({ id }) {
  const [s, setS] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api(`${API}/${encodeURIComponent(id)}`)
      .then((res) => setS(res.item))
      .catch((err) => setError(err?.data?.message || err?.message || "Nu am putut încărca decontul."));
  }, [id]);

  async function csv() {
    try {
      await downloadLabelsPdf(`${API}/${encodeURIComponent(id)}.csv`, `decont-targ-artfest-${s.sequence}.csv`, "Nu am putut exporta decontul.");
    } catch (err) {
      setError(err?.message || "Nu am putut exporta decontul.");
    }
  }

  if (error) return <div className={styles.errorBox}>{error}</div>;
  if (!s) return <p className={styles.muted}>Se încarcă…</p>;

  return (
    <div className={styles.itemBody}>
      <dl className={styles.receptionStats}>
        <Stat label="Vânzări brute" value={formatLei(s.grossSalesCents)} />
        <Stat label="Reduceri" value={formatLei(s.discountsCents)} />
        <Stat label="Comision" value={formatLei(s.commissionCents)} />
        <Stat label="Net vânzări" value={formatLei(s.vendorNetCents)} />
        <Stat label="Rambursări clienți" value={formatLei(s.returnsRefundCents)} />
        <Stat label="din care suportate de Artfest" value={formatLei(s.artfestBorneRefundCents)} />
        <Stat label="Net retur care te afectează" value={s.vendorNetReversedCents ? `-${formatLei(s.vendorNetReversedCents)}` : formatLei(0)} />
        <Stat label="Ajustări" value={signedLei(s.adjustmentsCents)} />
        <Stat label="Sold reportat" value={signedLei(s.carriedInCents)} />
        <Stat label="Total" value={formatLei(s.finalDueCents)} />
      </dl>

      {s.adjustments.length > 0 && (
        <ul className={styles.receptionMessages}>
          {s.adjustments.map((a) => (
            <li key={a.id}>
              Ajustare: {signedLei(a.amountCents)}
              {a.vendorNote ? ` - ${a.vendorNote}` : ""}
            </li>
          ))}
        </ul>
      )}
      {s.carriedFrom && (
        <p className={styles.hint}>
          Sold reportat din decontul #{s.carriedFrom.sequence}: {signedLei(s.carriedFrom.finalDueCents)}
        </p>
      )}

      {s.saleLines.length > 0 && (
        <>
          <h4 className={styles.label}>Vânzări incluse</h4>
          <ul className={styles.receptionMessages}>
            {s.saleLines.map((l) => (
              <li key={l.id}>
                #{l.saleNumber} · {l.title}
                {l.variantLabel ? ` (${l.variantLabel})` : ""} · {l.quantity} buc. · încasat {formatLei(l.lineGrossCents)} · comision {formatLei(l.commissionCents)} · net{" "}
                {formatLei(l.vendorNetCents)}
              </li>
            ))}
          </ul>
        </>
      )}
      {s.returnLines.length > 0 && (
        <>
          <h4 className={styles.label}>Retururi incluse</h4>
          <ul className={styles.receptionMessages}>
            {s.returnLines.map((r) => (
              <li key={r.id}>
                {r.reference} · {r.title} · {r.quantity} buc. · {DISPOSITION_LABEL[r.disposition] || r.disposition} · rambursat {formatLei(r.refundCents)} ·{" "}
                {r.affectsVendorNet ? `netul tău scade cu ${formatLei(-r.entry.vendorNetCents)}` : "nu îți afectează netul (suportat de Artfest)"}
              </li>
            ))}
          </ul>
        </>
      )}
      <div className={styles.itemActions}>
        <button type="button" className={styles.btnGhost} onClick={csv}>
          <Download size={16} aria-hidden="true" /> CSV
        </button>
      </div>
    </div>
  );
}

export default function FairSettlementsSection() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(null);

  const load = useCallback(async () => {
    try {
      setItems((await api(API)).items || []);
      setError("");
    } catch (err) {
      setError(err?.data?.message || err?.message || "Nu am putut încărca deconturile.");
      setItems((prev) => prev || []);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // fără deconturi finalizate => secțiunea nu apare
  if (!items || (items.length === 0 && !error)) return null;

  return (
    <section id="deconturi" className={styles.section} aria-labelledby="fair-settlements-title">
      <div className={styles.head}>
        <div>
          <h2 id="fair-settlements-title" className={styles.title}>
            <Wallet size={20} aria-hidden="true" /> Deconturi
          </h2>
          <p className={styles.muted}>Decontul vânzărilor tale la târg. Document intern - nu este factură.</p>
        </div>
      </div>
      {error && <div className={styles.errorBox}>{error}</div>}
      <ul className={styles.list}>
        {items.map((s) => (
          <li key={s.id} className={styles.item}>
            <div className={styles.itemBody}>
              <div className={styles.itemHead}>
                <div className={styles.itemTitle}>
                  <strong>{amountHeadline(s)}</strong>
                  <span>
                    {s.label} · {periodText(s.periodFrom, s.periodTo)}
                    {s.finalizedAt ? ` · finalizat ${formatDateRo(s.finalizedAt)}` : ""}
                  </span>
                  {s.status === "PAID" && (
                    <span>
                      Plătit la {formatDateRo(s.paidAt)}
                      {s.paymentReference ? ` · referința plății: ${s.paymentReference}` : ""}
                    </span>
                  )}
                  {s.status === "CARRIED_FORWARD" && <span>Soldul negativ se scade din decontul următor.</span>}
                </div>
                <span className={`${styles.badge} ${styles[`tone_${SETTLEMENT_STATUS_TONE[s.status] || "muted"}`]}`}>
                  {SETTLEMENT_STATUS_LABEL[s.status] || s.status}
                </span>
              </div>
              <div className={styles.itemActions}>
                <button type="button" className={styles.btnGhost} onClick={() => setOpen(open === s.id ? null : s.id)}>
                  {open === s.id ? "Ascunde detaliile" : "Vezi detaliile"}
                </button>
              </div>
              {open === s.id && <SettlementDetail id={s.id} />}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
