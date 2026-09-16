import { useEffect, useMemo, useState } from "react";
import { X, Loader2, RefreshCw } from "lucide-react";
import { api } from "../../../lib/api";
import styles from "./AdminBillingToClient.module.css";

/*
 * Drawer/modal STRICT read-only (audit 2026-09-15, Admin Billing) -
 * citește GET /api/admin/billing/vendor-commission-breakdown, care la
 * rândul lui NU calculează nimic financiar nou - doar reformatează
 * ce e deja scris în ledger (VendorEarningEntry / VendorReferralEarningEntry
 * / InfluencerEarningEntry). Nicio scriere, niciun buton de acțiune
 * financiară aici (facturarea rămâne STRICT în tab-ul de bază,
 * "Creează factură").
 *
 * Etichete (cerere explicită, audit): own-sale NU e numit "remunerație
 * de referral", referral-ul NU e numit "reducere de comision" - vezi
 * SOURCE_LABELS/PROMOTER_LABELS de mai jos.
 */

function formatMoney(n, currency = "RON") {
  const v = Number(n || 0);
  return new Intl.NumberFormat("ro-RO", { style: "currency", currency }).format(v);
}

function formatDateShort(d) {
  if (!d) return "—";
  try {
    return new Intl.DateTimeFormat("ro-RO", { dateStyle: "medium" }).format(new Date(d));
  } catch {
    return "—";
  }
}

function getPreviousMonthRange() {
  const now = new Date();
  const first = new Date(Date.UTC(now.getFullYear(), now.getMonth() - 1, 1));
  const next = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
  return {
    from: first.toISOString().slice(0, 10),
    to: next.toISOString().slice(0, 10),
  };
}

const SOURCE_LABELS = {
  plan: "Comenzi normale (plan standard)",
  vendor_referral_own_sale: "Beneficiu own-sale (cod personal) — comision 5%",
  vendor_collection_own_sale: "Beneficiu own-sale (VendorCollection) — comision 5%",
  campaign: "Campanie vendor",
  mixed: "Comision mixt (mai multe surse pe același shipment)",
};

const PROMOTER_LABELS = {
  VENDOR_REFERRAL: "Remunerație vendor referral (?ref=)",
  VENDOR_COLLECTION_REFERRAL: "Remunerație VendorCollection (referral cross-vendor)",
  INFLUENCER: "Remunerație influencer",
};

export default function VendorCommissionBreakdownModal({ vendorId, vendorName, onClose }) {
  const defaultRange = useMemo(() => getPreviousMonthRange(), []);
  const [periodFrom, setPeriodFrom] = useState(defaultRange.from);
  const [periodTo, setPeriodTo] = useState(defaultRange.to);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [data, setData] = useState(null);

  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let alive = true;

    async function run() {
      setLoading(true);
      setErr("");

      try {
        const qs = new URLSearchParams({
          vendorId,
          periodFrom: new Date(`${periodFrom}T00:00:00.000Z`).toISOString(),
          periodTo: new Date(`${periodTo}T00:00:00.000Z`).toISOString(),
        }).toString();

        const res = await api(`/api/admin/billing/vendor-commission-breakdown?${qs}`);
        if (!alive) return;
        setData(res);
      } catch {
        if (!alive) return;
        setErr("Nu am putut încărca detaliile de comision pentru acest vendor/perioadă.");
      } finally {
        if (alive) setLoading(false);
      }
    }

    if (vendorId && periodFrom && periodTo) run();

    return () => {
      alive = false;
    };
  }, [vendorId, periodFrom, periodTo, reloadTick]);

  const currency = data?.currency || "RON";
  const summary = data?.summary || null;
  const bySource = data?.bySource || [];
  const promoterBreakdown = data?.promoterBreakdown || null;
  const shipments = data?.shipments || [];

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHead}>
          <div>
            <div style={{ fontWeight: 900, fontSize: 18 }}>
              Detalii comision — {vendorName || "Vendor"}
            </div>
            <div className={styles.muted} style={{ fontSize: 12 }}>
              Sumar strict informativ, pe baza înregistrărilor deja confirmate în ledger.
            </div>
          </div>

          <button type="button" className={styles.iconBtn} onClick={onClose} aria-label="Închide">
            <X size={18} />
          </button>
        </div>

        <div className={styles.modalBody}>
          <div className={styles.actions} style={{ justifyContent: "flex-start", marginBottom: 14 }}>
            <div className={styles.dateWrap}>
              <span className={styles.muted} style={{ fontSize: 13 }}>De la</span>
              <input
                type="date"
                className={styles.dateInput}
                value={periodFrom}
                onChange={(e) => setPeriodFrom(e.target.value)}
              />
            </div>

            <div className={styles.dateWrap}>
              <span className={styles.muted} style={{ fontSize: 13 }}>Până la</span>
              <input
                type="date"
                className={styles.dateInput}
                value={periodTo}
                onChange={(e) => setPeriodTo(e.target.value)}
              />
            </div>

            <button
              type="button"
              className={styles.secondaryBtn}
              onClick={() => setReloadTick((n) => n + 1)}
              disabled={loading}
            >
              {loading ? <Loader2 size={16} className={styles.spin} /> : <RefreshCw size={16} />}
              Reîncarcă
            </button>
          </div>

          {!!err && <p className={styles.error}>{err}</p>}

          {loading && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: 20 }}>
              <Loader2 size={18} className={styles.spin} /> Se încarcă…
            </div>
          )}

          {!loading && summary && (
            <>
              {/* A. SUMAR */}
              <h3 style={{ marginTop: 0 }}>A. Sumar perioadă</h3>
              <div className={styles.kvGrid}>
                <div className={styles.kv}>
                  <div className={styles.kvLabel}>Vânzări brute</div>
                  <div className={styles.kvValue}>{formatMoney(summary.grossSales, currency)}</div>
                </div>
                <div className={styles.kv}>
                  <div className={styles.kvLabel}>Refunduri ({summary.refundsCount})</div>
                  <div className={styles.kvValue}>{formatMoney(summary.refundsItemsNet, currency)}</div>
                </div>
                <div className={styles.kv}>
                  <div className={styles.kvLabel}>Vânzări nete</div>
                  <div className={styles.kvValue}>{formatMoney(summary.netSales, currency)}</div>
                </div>
                <div className={styles.kv}>
                  <div className={styles.kvLabel}>Comision brut Artfest</div>
                  <div className={styles.kvValue}>{formatMoney(summary.commissionGross, currency)}</div>
                </div>
                <div className={styles.kv}>
                  <div className={styles.kvLabel}>Reduceri suportate de Artfest (subvenție)</div>
                  <div className={styles.kvValue}>{formatMoney(summary.platformFundedDiscounts, currency)}</div>
                </div>
                <div className={styles.kv}>
                  <div className={styles.kvLabel}>Comision facturat vendorului (după subvenții)</div>
                  <div className={styles.kvValue} style={{ fontWeight: 900 }}>
                    {formatMoney(summary.commissionNetBilled, currency)}
                  </div>
                </div>
                <div className={styles.kv}>
                  <div className={styles.kvLabel}>Remunerații promoteri (influencer + vendor referral)</div>
                  <div className={styles.kvValue}>{formatMoney(summary.promoterEarnings, currency)}</div>
                </div>
                <div className={styles.kv}>
                  <div className={styles.kvLabel}>Net Artfest final (după remunerații promoteri)</div>
                  <div className={styles.kvValue} style={{ fontWeight: 900 }}>
                    {formatMoney(summary.artfestNetFinal, currency)}
                  </div>
                </div>
              </div>

              <p className={styles.muted} style={{ fontSize: 12, marginTop: 10 }}>
                Important: „Comision facturat vendorului” NU se modifică din cauza remunerației unui
                promoter — remunerația promoterului se scade STRICT din marja Artfest, separat, ca linie
                distinctă mai jos. Remunerația own-sale nu este un „câștig de referral” — este un
                comision Artfest redus (5%), aplicat direct pe vânzarea proprie a vendorului.
              </p>

              {/* B. PE TIP DE SURSĂ */}
              <h3>B. Comision seller pe sursă</h3>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead className={styles.thead}>
                    <tr>
                      <th className={styles.th}>Sursă</th>
                      <th className={styles.th}>Comenzi</th>
                      <th className={styles.th}>Comision brut</th>
                      <th className={styles.th}>Subvenție Artfest</th>
                      <th className={styles.th}>Comision facturat</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bySource.length === 0 && (
                      <tr>
                        <td className={styles.emptyCell} colSpan={5}>Nicio comandă în perioadă.</td>
                      </tr>
                    )}
                    {bySource.map((s) => (
                      <tr key={s.source} className={styles.row}>
                        <td className={styles.td}>{SOURCE_LABELS[s.source] || s.source}</td>
                        <td className={styles.td}>{s.count}</td>
                        <td className={styles.td}>{formatMoney(s.commissionGross, currency)}</td>
                        <td className={styles.td}>{formatMoney(s.platformSubsidyAmount, currency)}</td>
                        <td className={styles.td}>{formatMoney(s.commissionNet, currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className={styles.muted} style={{ fontSize: 12, margin: "8px 0 0" }}>
                „Produsul zilei” / „Artizanul săptămânii” NU sunt surse de comision — sunt promoții de
                PREȚ, separate de sursa comisionului. O comandă cu preț redus prin Produsul zilei apare
                aici sub „Comenzi normale” dacă vendorul e pe comisionul standard de plan.
              </p>

              {/* Remunerații promoteri, pe tip */}
              {promoterBreakdown && (
                <>
                  <h3>Remunerații promoteri, pe tip</h3>
                  <div className={styles.tableWrap}>
                    <table className={styles.table}>
                      <thead className={styles.thead}>
                        <tr>
                          <th className={styles.th}>Tip</th>
                          <th className={styles.th}>Comenzi</th>
                          <th className={styles.th}>Comision Artfest aferent</th>
                          <th className={styles.th}>Remunerație plătită promoterului</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(promoterBreakdown)
                          .filter(([, v]) => v.count > 0)
                          .map(([type, v]) => (
                            <tr key={type} className={styles.row}>
                              <td className={styles.td}>{PROMOTER_LABELS[type] || type}</td>
                              <td className={styles.td}>{v.count}</td>
                              <td className={styles.td}>{formatMoney(v.artfestCommissionNet, currency)}</td>
                              <td className={styles.td}>{formatMoney(v.earningNet, currency)}</td>
                            </tr>
                          ))}
                        {Object.values(promoterBreakdown).every((v) => v.count === 0) && (
                          <tr>
                            <td className={styles.emptyCell} colSpan={4}>
                              Nicio remunerație de promoter în această perioadă.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {/* C. PER COMANDĂ / SHIPMENT */}
              <h3>C. Detaliu pe comandă / shipment</h3>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead className={styles.thead}>
                    <tr>
                      <th className={styles.th}>Comandă</th>
                      <th className={styles.th}>Sursă comision</th>
                      <th className={styles.th}>% comision</th>
                      <th className={styles.th}>Comision brut</th>
                      <th className={styles.th}>Subvenție</th>
                      <th className={styles.th}>Facturat vendor</th>
                      <th className={styles.th}>Promoter</th>
                      <th className={styles.th}>Remunerație promoter</th>
                      <th className={styles.th}>Net Artfest final</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shipments.length === 0 && (
                      <tr>
                        <td className={styles.emptyCell} colSpan={9}>Nicio comandă în perioadă.</td>
                      </tr>
                    )}
                    {shipments.map((s) => (
                      <tr key={s.shipmentId} className={styles.row}>
                        <td className={styles.td}>
                          <div style={{ fontWeight: 700 }}>{s.orderNumber || "—"}</div>
                          <div className={styles.muted} style={{ fontSize: 11 }}>
                            {formatDateShort(s.occurredAt)}
                          </div>
                          {s.isReversed && (
                            <div className={styles.error} style={{ fontSize: 11, fontWeight: 800 }}>
                              REVERSAT (refund)
                            </div>
                          )}
                        </td>
                        <td className={styles.td}>
                          {SOURCE_LABELS[s.commissionSource] || s.commissionSource}
                          {s.isMixedCommission && (
                            <div className={styles.muted} style={{ fontSize: 11 }}>mixt</div>
                          )}
                        </td>
                        <td className={styles.td}>
                          {s.commissionBps != null ? `${(s.commissionBps / 100).toFixed(2)}%` : "—"}
                        </td>
                        <td className={styles.td}>{formatMoney(s.commissionGross, currency)}</td>
                        <td className={styles.td}>{formatMoney(s.platformSubsidyAmount, currency)}</td>
                        <td className={styles.td} style={{ fontWeight: 700 }}>
                          {formatMoney(s.commissionNetBilled, currency)}
                        </td>
                        <td className={styles.td}>
                          {s.promoterType ? (
                            <>
                              <div style={{ fontWeight: 700 }}>{s.promoterName || "—"}</div>
                              <div className={styles.muted} style={{ fontSize: 11 }}>
                                {PROMOTER_LABELS[s.promoterType] || s.promoterType}
                                {s.promoterBps != null ? ` · ${(s.promoterBps / 100).toFixed(2)}%` : ""}
                              </div>
                            </>
                          ) : (
                            <span className={styles.muted}>—</span>
                          )}
                        </td>
                        <td className={styles.td}>{formatMoney(s.promoterEarningNet, currency)}</td>
                        <td className={styles.td} style={{ fontWeight: 900 }}>
                          {formatMoney(s.artfestNetFinal, currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <div className={styles.modalActions}>
            <button type="button" className={styles.secondaryBtn} onClick={onClose}>
              Închide
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
