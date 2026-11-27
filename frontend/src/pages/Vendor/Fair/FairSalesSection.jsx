// src/pages/Vendor/Fair/FairSalesSection.jsx
//
// „Vânzări” la Târgul Artfest: raportul zilnic al vendorului (vânzările zilei cu
// valorile de la vânzare + retururile făcute în ziua aleasă), produsele vândute
// și liniile proprii de vânzare, cu retururile lor. Serverul filtrează după
// vendorul din sesiune - aici nu ajung liniile altor vendori, datele clienților
// (inclusiv motivele retururilor) sau datele Admin. Vendorul doar citește.

import { useCallback, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { BarChart3, Download, RefreshCw } from "lucide-react";
import { api } from "../../../lib/api";
import { downloadLabelsPdf } from "./fairInventory.js";
import { accessoriesListText } from "./fairAccessories.js";
import {
  DISPOSITION_LABEL,
  LINE_STATUS_LABEL,
  PAYMENT_LABEL,
  SALES_API,
  VENDOR_REPORT_API,
  VENDOR_SUMMARY_API,
  formatLei,
  initialFairDate,
  isValidDate,
  reportUrl,
  unitPricesText,
} from "./fairSales.js";
import styles from "./FairInventory.module.css";

/*
 * Pe scurt (mereu „azi” = ziua de azi în ora României, indiferent de ziua aleasă mai jos):
 * ce s-a vândut azi, totalul la târg, suma care îți revine, ce s-a decontat și restul.
 */
function SalesSummary({ summary }) {
  if (!summary) return null;
  const { today, total, settlement, todayProducts } = summary;
  return (
    <div className={styles.summaryBox}>
      <h3 className={styles.label}>Pe scurt</h3>
      <dl className={styles.receptionStats}>
        <Stat label={`Azi (${summary.date})`} value={`${today.net.unitsSold} buc. · ${formatLei(today.net.collectedCents)}`} />
        <Stat label="Total la târg" value={`${total.net.unitsSold} buc. · ${formatLei(total.net.collectedCents)}`} />
        <Stat label="Îți revine" value={formatLei(settlement.dueCents)} />
        <Stat label="Decontat (plătit)" value={formatLei(settlement.paidCents)} />
        <Stat label="Rest de primit" value={formatLei(settlement.remainingCents)} />
      </dl>
      {todayProducts.length > 0 ? (
        <ul className={styles.receptionMessages}>
          {todayProducts.map((p) => (
            <li key={p.inventoryItemId}>
              Azi: {p.title}
              {p.variantLabel ? ` (${p.variantLabel})` : ""} · {p.quantity} buc. · preț final {unitPricesText(p.unitPricesCents)} · îți revine{" "}
              {formatLei(p.vendorNetCents)}
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.empty}>Nicio vânzare azi.</p>
      )}
      {(total.voids.units > 0 || total.returns.units > 0) && (
        <p className={styles.hint}>
          Anulări: {total.voids.units} buc. · Retururi: {total.returns.units} buc. Suma care îți revine ține cont de ele.
        </p>
      )}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export default function FairSalesSection() {
  const location = useLocation();
  const [date, setDate] = useState(() => initialFairDate(location.search));
  const [report, setReport] = useState(null);
  const [sales, setSales] = useState(null);
  const [summary, setSummary] = useState(null);
  const [busy, setBusy] = useState(false);
  const [csvBusy, setCsvBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!isValidDate(date)) return;
    setBusy(true);
    try {
      const [rep, list, sum] = await Promise.all([
        api(reportUrl(VENDOR_REPORT_API, date)),
        api(`${SALES_API}?date=${encodeURIComponent(date)}&limit=200`),
        api(VENDOR_SUMMARY_API),
      ]);
      setReport(rep);
      setSales(list);
      setSummary(sum);
      setError("");
    } catch (err) {
      setError(err?.data?.message || err?.message || "Nu am putut încărca vânzările.");
    } finally {
      setBusy(false);
    }
  }, [date]);

  useEffect(() => {
    load();
  }, [load]);

  // link din notificarea zilnică (#vanzari): secțiunea apare după încărcare
  useEffect(() => {
    if (report && location.hash === "#vanzari") document.getElementById("vanzari")?.scrollIntoView({ block: "start" });
  }, [report, location.hash]);

  async function downloadCsv() {
    setCsvBusy(true);
    setError("");
    try {
      await downloadLabelsPdf(
        reportUrl(VENDOR_REPORT_API, date, { csv: true }),
        `raport-targ-artfest-${date}.csv`,
        "Nu am putut exporta raportul."
      );
    } catch (err) {
      setError(err?.message || "Nu am putut exporta raportul.");
    } finally {
      setCsvBusy(false);
    }
  }

  const ret = report?.returns;

  return (
    <section id="vanzari" className={styles.section} aria-labelledby="fair-sales-title">
      <div className={styles.head}>
        <div>
          <h2 id="fair-sales-title" className={styles.title}>
            <BarChart3 size={20} aria-hidden="true" /> Vânzări
          </h2>
          <p className={styles.muted}>
            Produsele tale vândute la târg. Ziua se calculează după ora României. Retururile apar în ziua în care s-au
            făcut.
          </p>
        </div>
        <div className={styles.headActions}>
          <label className={styles.label}>
            Ziua
            <input
              type="date"
              className={styles.input}
              value={date}
              onChange={(e) => setDate(e.target.value)}
              aria-label="Ziua raportului"
            />
          </label>
          <button type="button" className={styles.btnGhost} onClick={load} disabled={busy}>
            <RefreshCw size={16} aria-hidden="true" /> {busy ? "Se actualizează…" : "Actualizează"}
          </button>
          <button type="button" className={styles.btnGhost} onClick={downloadCsv} disabled={csvBusy || !report}>
            <Download size={16} aria-hidden="true" /> {csvBusy ? "Se exportă…" : "CSV"}
          </button>
        </div>
      </div>

      {error && (
        <div className={styles.errorBox} role="alert">
          {error}
        </div>
      )}

      <SalesSummary summary={summary} />

      {report && (
        <>
          <h3 className={styles.label}>Raport zilnic · {report.date}</h3>
          <dl className={styles.receptionStats}>
            <Stat label="Vânzări" value={report.salesCount} />
            <Stat label="Bucăți" value={report.units} />
            <Stat label="Valoare de listă" value={formatLei(report.listCents)} />
            <Stat label="Reduceri" value={formatLei(report.discountCents)} />
            <Stat label="Încasat" value={formatLei(report.grossCents)} />
            <Stat label="Numerar" value={formatLei(report.cashCents)} />
            <Stat label="Card" value={formatLei(report.cardCents)} />
            <Stat label="Comision / adaos Artfest" value={formatLei(report.commissionCents)} />
            {report.accessoriesCents > 0 && <Stat label="Ambalare și accesorii (Artfest)" value={formatLei(report.accessoriesCents)} />}
            {report.artfestFundedDiscountCents > 0 && (
              <Stat label="Reduceri suportate de Artfest" value={formatLei(report.artfestFundedDiscountCents)} />
            )}
            <Stat label="Net din vânzări" value={formatLei(report.vendorNetCents)} />
          </dl>

          {ret && ret.units > 0 && (
            <>
              <h3 className={styles.label}>Retururi / rambursări în ziua aleasă</h3>
              <dl className={styles.receptionStats}>
                <Stat label="Bucăți" value={ret.units} />
                <Stat label="Rambursat" value={formatLei(ret.refundCents)} />
                <Stat label="Comision inversat" value={formatLei(ret.vendorBorne.commissionReversedCents)} />
                <Stat label="Net retur (îți afectează netul)" value={formatLei(ret.vendorBorne.vendorNetReversedCents)} />
                {ret.artfestBorne.units > 0 && (
                  <Stat label="Rambursări suportate de Artfest" value={formatLei(ret.artfestBorne.refundCents)} />
                )}
              </dl>
              {ret.artfestBorne.units > 0 && (
                <p className={styles.hint}>Rambursările suportate de Artfest nu îți afectează netul.</p>
              )}
              <ul className={styles.receptionMessages}>
                {report.returnLines.map((r) => (
                  <li key={`${r.reference}-${r.titleSnapshot}-${r.disposition}`}>
                    {r.localTime} · {r.titleSnapshot}
                    {r.variantLabel ? ` (${r.variantLabel})` : ""} · {r.quantity} buc. · {DISPOSITION_LABEL[r.disposition] || r.disposition} ·
                    rambursat {formatLei(r.refundCents)} ·{" "}
                    {r.affectsVendorNet ? `netul tău scade cu ${formatLei(r.vendorNetImpactCents)}` : "nu îți afectează netul (suportat de Artfest)"}
                    {r.saleNumber ? ` · vânzarea #${r.saleNumber}` : ""}
                  </li>
                ))}
              </ul>
            </>
          )}

          <dl className={styles.receptionStats}>
            <Stat label="Net al zilei (vânzări − retururi)" value={formatLei(report.dayVendorNetCents)} />
          </dl>

          <h3 className={styles.label}>Produse vândute în ziua aleasă</h3>
          {report.products.length === 0 ? (
            <p className={styles.empty}>Nicio vânzare în această zi.</p>
          ) : (
            <ul className={styles.receptionMessages}>
              {report.products.map((p) => (
                <li key={p.inventoryItemId}>
                  {p.title}
                  {p.variantLabel ? ` (${p.variantLabel})` : ""} · {p.quantity} buc. · {formatLei(p.grossCents)}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {sales && sales.items.length > 0 && (
        <>
          <h3 className={styles.label}>Liniile tale de vânzare</h3>
          <ul className={styles.list}>
            {sales.items.map((line) => (
              <li key={line.saleLineId} className={styles.item}>
                <div className={styles.itemBody}>
                  <div className={styles.itemHead}>
                    <div className={styles.itemTitle}>
                      <strong>
                        {line.titleSnapshot}
                        {line.variantLabel ? ` (${line.variantLabel})` : ""}
                      </strong>
                      <span>
                        Vânzarea #{line.saleNumber} · {line.localDate} {line.localTime} ·{" "}
                        {PAYMENT_LABEL[line.paymentMethod] || line.paymentMethod}
                      </span>
                    </div>
                    <span className={styles.badge}>{LINE_STATUS_LABEL[line.status] || line.status}</span>
                  </div>
                  <dl className={styles.meta}>
                    <Stat label="Cantitate" value={line.quantity} />
                    <Stat label="Preț de listă" value={formatLei(line.listUnitPriceCents)} />
                    <Stat
                      label="Reducere"
                      value={
                        line.lineDiscountCents > 0
                          ? `${formatLei(line.lineDiscountCents)}${line.discount?.fundingSource === "ARTFEST" ? " (Artfest)" : ""}`
                          : "—"
                      }
                    />
                    <Stat label="Preț efectiv / buc." value={formatLei(line.effectiveUnitPriceCents)} />
                    <Stat label="Total" value={formatLei(line.lineGrossCents)} />
                    {line.declaredUnitPriceCents != null && (
                      <Stat label="Preț declarat / buc." value={formatLei(line.declaredUnitPriceCents)} />
                    )}
                    <Stat
                      label={line.financeRule === "DECLARED_PLUS_MARKUP" ? "Adaos Artfest" : line.financeRule === "DISCOUNTED_COMMISSION" ? "Comision 10% (după accesorii)" : "Comision"}
                      value={formatLei(line.commissionCents)}
                    />
                    {line.accessoriesCents > 0 && <Stat label="Ambalare și accesorii (Artfest)" value={formatLei(line.accessoriesCents)} />}
                    <Stat label="Net" value={formatLei(line.vendorNetCents)} />
                    {line.returnedQty > 0 && (
                      <>
                        <Stat label="Returnat" value={`${line.returnedQty} buc.`} />
                        <Stat label="Sumă returnată" value={formatLei(line.returned.refundCents)} />
                        <Stat label="Comision inversat" value={formatLei(line.returned.commissionReversedCents)} />
                        {line.returned.accessoriesReversedCents > 0 && (
                          <Stat label="Accesorii restituite" value={formatLei(line.returned.accessoriesReversedCents)} />
                        )}
                        <Stat label="Scăzut din netul tău" value={formatLei(line.returned.vendorNetImpactCents)} />
                      </>
                    )}
                  </dl>
                  {line.accessoriesCents > 0 && (
                    <p className={styles.hint}>
                      Ambalare și accesorii adăugate de Artfest: {accessoriesListText(line.accessories)} pe bucată × {line.quantity} buc. ={" "}
                      {formatLei(line.accessoriesCents)}
                      {line.financeRule === "DECLARED_PLUS_MARKUP" || line.financeRule === "DISCOUNTED_COMMISSION"
                        ? " (plătite de client, revin Artfest)."
                        : " (reținute din suma ta, pe lângă comisionul de 10% - regula de la data vânzării)."}
                    </p>
                  )}
                  {line.financeRule === "DECLARED_PLUS_MARKUP" && (
                    <p className={styles.hint}>
                      Regula vânzării: primești prețul declarat ({formatLei(line.declaredUnitPriceCents)} / buc.); Artfest primește adaosul și accesoriile.
                    </p>
                  )}
                  {line.financeRule === "DISCOUNTED_COMMISSION" && (
                    <p className={styles.hint}>
                      Vândut sub prețul propus ({formatLei(line.proposedUnitPriceCents)} / buc.): din încasare s-au scăzut accesoriile, apoi comisionul Artfest de 10%
                      din rest; ai primit {formatLei(line.vendorNetCents)} (preț declarat {formatLei(line.declaredUnitPriceCents)} / buc.).
                    </p>
                  )}
                  {line.priceSetManually && (
                    <p className={styles.hint}>
                      Prețul acestei vânzări a fost stabilit la casă ({formatLei(line.effectiveUnitPriceCents)} / buc.); comisionul și netul
                      tău sunt calculate din acest preț.
                    </p>
                  )}
                  {line.returns.length > 0 && (
                    <ul className={styles.receptionMessages}>
                      {line.returns.map((r) => (
                        <li key={`${r.reference}-${r.disposition}`}>
                          {r.type === "VOID" ? "Anulare" : "Retur"} {r.localDate} {r.localTime} · {r.quantity} buc. ·{" "}
                          {DISPOSITION_LABEL[r.disposition] || r.disposition} · rambursat {formatLei(r.refundCents)} ·{" "}
                          {r.affectsVendorNet ? "îți afectează netul" : "nu îți afectează netul (suportat de Artfest)"}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {sales.total > sales.items.length && (
            <p className={styles.hint}>
              Se afișează {sales.items.length} din {sales.total} linii. Exportă CSV pentru lista completă.
            </p>
          )}
        </>
      )}
    </section>
  );
}
