// src/pages/Admin/AdminDesktop/tabs/AdminReturnLogistics.jsx
//
// „Transport retur” (Sameday STANDARD, contractul Artfest) într-o cerere din
// tab-ul Retururi. Pașii, în ordine, fiecare prin endpointul lui:
//   1. metoda + adresa confirmată de client        GET   /api/admin/returns/:id
//   2. cine suportă transportul                    PATCH /api/admin/returns/:id/cost-bearer
//   3. colete + greutate -> coletul RETURN          POST  /api/admin/returns/:id/create-shipment
//   4. verificare AWB (fără creare la curier)       POST  /api/admin/pickups/:sid/return-awb/preview
//   5. generare AWB - acțiune explicită, confirmată POST  /api/admin/pickups/:sid/return-awb (Idempotency-Key)
//   6. etichetă A6 / A4                             GET   /api/admin/pickups/:sid/awb-label
//   7. UNKNOWN -> „Verifică din nou la Sameday”     POST  /api/admin/pickups/:sid/return-awb/recover
//   8. anulare (doar înainte de predare)            POST  /api/admin/pickups/:sid/courier-awb/:awbId/cancel
//   9. retur vechi: completează livrarea / coletele POST  /api/admin/returns/:id/complete-shipment
//  10. notificări persistente per AWB: stare + retrimitere EXPLICITĂ (UNCERTAIN / FAILED)
//                                                  POST  /api/admin/returns/:id/notices/:awbId/:kind/resend
// Serverul decide tot (costBearer obligatoriu, un singur colet, un singur AWB
// activ); aici butoanele sunt doar ascunse / dezactivate în aceleași condiții,
// iar fiecare acțiune e blocată cât rulează (fără dublu-click).

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../../lib/api";
import {
  AWB_STATUS_LABELS,
  COST_BEARER_LABELS,
  NOTICE_STATE_LABELS,
  RETURN_METHOD_LABELS,
  adminLabelPath,
  adminReturnLogisticsState,
  newIdempotencyKey,
  pickupSummary,
} from "../../../../components/Returns/returnLogistics.js";
import { LabelButtons } from "../../../../components/Returns/ReturnLogisticsPanel.jsx";
import { formatReturnDate, returnStyles as rs } from "../../../../components/Returns/returnUtils.js";
import styles from "../../../../components/Returns/ReturnLogistics.module.css";

const errorText = (e, fallback) => e?.data?.message || e?.message || fallback;

export default function AdminReturnLogistics({ returnRequestId, onChanged }) {
  const [rr, setRr] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState(null);
  const [cost, setCost] = useState("");
  const [parcels, setParcels] = useState({ parcels: "1", weightKg: "", lengthCm: "", widthCm: "", heightCm: "" });
  const [parcelErrors, setParcelErrors] = useState([]);
  const [confirmGenerate, setConfirmGenerate] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelNote, setCancelNote] = useState("");
  // o cheie per încercare de generare: retrimiterea după o eroare de rețea folosește ACEEAȘI cheie
  const idemKey = useRef(null);

  const load = useCallback(async () => {
    try {
      const res = await api(`/api/admin/returns/${encodeURIComponent(returnRequestId)}`);
      setRr(res?.returnRequest || null);
      setCost(res?.returnRequest?.costBearer || "");
    } catch (e) {
      setError(errorText(e, "Nu am putut încărca detaliile returului."));
    } finally {
      setLoading(false);
    }
  }, [returnRequestId]);

  useEffect(() => {
    load();
  }, [load]);

  async function run(key, fn, { keepPreview = false } = {}) {
    if (busy) return;
    setBusy(key);
    setError("");
    setNotice("");
    try {
      const msg = await fn();
      if (msg) setNotice(msg);
      if (!keepPreview) setPreview(null);
      await load();
      await onChanged?.();
    } catch (e) {
      setError(errorText(e, "Acțiunea nu a putut fi finalizată."));
      if (Array.isArray(e?.data?.blockers)) setParcelErrors(e.data.blockers);
    } finally {
      setBusy("");
    }
  }

  if (loading) return <p className={rs.hint}>Se încarcă transportul returului…</p>;
  if (!rr) return error ? <div className={rs.error}>{error}</div> : null;

  const st = adminReturnLogisticsState(rr, preview);
  const ship = st.shipment;
  const awbs = ship?.courierAwbs || [];

  return (
    <section className={styles.panel} aria-label="Transport retur">
      <div className={styles.panelHead}>
        <span className={styles.panelTitle}>Transport retur (Sameday · contract Artfest)</span>
        <span className={styles.methodTag}>{rr.returnMethod ? RETURN_METHOD_LABELS[rr.returnMethod] : "Metodă nealeasă"}</span>
      </div>

      {/* 1. metoda + adresa */}
      <div className={styles.adminGrid}>
        <div className={rs.fact}>
          <span className={rs.factLabel}>Adresa de ridicare (client)</span>
          {rr.pickupAddress ? (
            <>
              {rr.pickupAddress.name} · {rr.pickupAddress.phone}
              {rr.pickupAddress.email ? ` · ${rr.pickupAddress.email}` : ""}
              <br />
              {pickupSummary(rr.pickupAddress)}
              <br />
              <span className={rs.meta}>Confirmată {formatReturnDate(rr.pickupAddress.confirmedAt)}</span>
            </>
          ) : rr.returnMethod === "HOME_PICKUP" ? (
            "Clientul nu a confirmat încă adresa."
          ) : (
            "—"
          )}
        </div>

        {/* 2. cost */}
        <div className={rs.fact}>
          <span className={rs.factLabel}>Cine suportă transportul</span>
          <div className={styles.adminRow}>
            <select
              className={styles.adminSelect}
              value={cost}
              disabled={!st.canSetCost || !!busy}
              onChange={(e) => setCost(e.target.value)}
              aria-label="Cine suportă transportul"
            >
              <option value="">Nedecis</option>
              {Object.entries(COST_BEARER_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={rs.btn}
              disabled={!st.canSetCost || !cost || cost === rr.costBearer || !!busy}
              onClick={() =>
                run("cost", async () => {
                  await api(`/api/admin/returns/${encodeURIComponent(rr.id)}/cost-bearer`, { method: "PATCH", body: { costBearer: cost } });
                  return "Decizia de cost a fost salvată.";
                }, { keepPreview: true })
              }
            >
              {busy === "cost" ? "Se salvează…" : "Salvează"}
            </button>
          </div>
          {rr.costDecidedAt && <span className={rs.meta}>Decis {formatReturnDate(rr.costDecidedAt)}</span>}
          {!rr.costBearer && <span className={styles.fieldError}>Obligatoriu înainte de AWB.</span>}
          {st.activeAwb && <span className={rs.meta}>Blocat cât există un AWB activ.</span>}
        </div>
      </div>

      {/* 3. coletul RETURN */}
      {!ship && (
        <div className={rs.composer}>
          <span className={rs.factLabel}>Coletul de retur</span>
          {st.createShipmentBlocker ? (
            <div className={`${rs.notice} ${rs.notice_info}`}>{st.createShipmentBlocker}</div>
          ) : (
            <>
              <div className={styles.adminRow}>
                {[
                  ["parcels", "Colete*", "1"],
                  ["weightKg", "Greutate totală (kg)*", "0.1"],
                  ["lengthCm", "Lungime (cm)", "1"],
                  ["widthCm", "Lățime (cm)", "1"],
                  ["heightCm", "Înălțime (cm)", "1"],
                ].map(([key, label, step]) => (
                  <label key={key} className={styles.field}>
                    <span>{label}</span>
                    <input
                      className={styles.adminInput}
                      type="number"
                      min="0"
                      step={step}
                      inputMode="decimal"
                      value={parcels[key]}
                      onChange={(e) => setParcels({ ...parcels, [key]: e.target.value })}
                    />
                  </label>
                ))}
              </div>
              {parcelErrors.length > 0 && (
                <ul className={styles.blockers}>
                  {parcelErrors.map((b) => (
                    <li key={`${b.code}-${b.field || ""}`}>{b.message}</li>
                  ))}
                </ul>
              )}
              <div className={rs.actions}>
                <button
                  type="button"
                  className={`${rs.btn} ${rs.btnPrimary}`}
                  disabled={!st.canCreateShipment || !parcels.parcels || !parcels.weightKg || !!busy}
                  onClick={() =>
                    run("ship", async () => {
                      setParcelErrors([]);
                      const num = (v) => (v === "" ? undefined : Number(v));
                      await api(`/api/admin/returns/${encodeURIComponent(rr.id)}/create-shipment`, {
                        method: "POST",
                        body: {
                          parcels: num(parcels.parcels),
                          weightKg: num(parcels.weightKg),
                          lengthCm: num(parcels.lengthCm),
                          widthCm: num(parcels.widthCm),
                          heightCm: num(parcels.heightCm),
                        },
                      });
                      return "Coletul de retur a fost creat. Verifică AWB-ul înainte de generare.";
                    })
                  }
                >
                  {busy === "ship" ? "Se creează…" : "Creează coletul de retur"}
                </button>
              </div>
              <div className={rs.hint}>Statusul cererii nu se schimbă aici; „Ridicare comandată” apare doar după AWB confirmat.</div>
            </>
          )}
        </div>
      )}

      {ship && (
        <div className={styles.awbBox}>
          <div className={styles.awbRow}>
            <span className={rs.factLabel}>Colet de retur</span>
            <span className={rs.meta}>
              {ship.parcels ? `${ship.parcels} colet(e)` : ""}
              {ship.weightKg ? ` · ${ship.weightKg} kg` : ""}
              {ship.status ? ` · ${ship.status}` : ""}
            </span>
          </div>

          {st.canComplete && (
            <div className={rs.composer}>
              <div className={`${rs.notice} ${rs.notice_warning}`}>
                Colet de retur creat înainte de noul flux:
                {st.missingDelivery ? " lipsește adresa de ridicare din livrare (se preia din adresa confirmată de client)" : ""}
                {st.missingDelivery && st.missingParcels ? ";" : ""}
                {st.missingParcels ? " lipsesc coletele / greutatea" : ""}. Se completează doar ce lipsește; datele existente nu se modifică.
              </div>
              {st.missingParcels && (
                <div className={styles.adminRow}>
                  {[
                    ["parcels", "Colete*", "1"],
                    ["weightKg", "Greutate totală (kg)*", "0.1"],
                  ].map(([key, label, step]) => (
                    <label key={key} className={styles.field}>
                      <span>{label}</span>
                      <input className={styles.adminInput} type="number" min="0" step={step} inputMode="decimal" value={parcels[key]} onChange={(e) => setParcels({ ...parcels, [key]: e.target.value })} />
                    </label>
                  ))}
                </div>
              )}
              <div className={rs.actions}>
                <button
                  type="button"
                  className={`${rs.btn} ${rs.btnPrimary}`}
                  disabled={!!busy || (st.missingParcels && (!parcels.parcels || !parcels.weightKg))}
                  onClick={() =>
                    run("complete", async () => {
                      const num = (v) => (v === "" || v == null ? undefined : Number(v));
                      await api(`/api/admin/returns/${encodeURIComponent(rr.id)}/complete-shipment`, {
                        method: "POST",
                        body: st.missingParcels ? { parcels: num(parcels.parcels), weightKg: num(parcels.weightKg) } : {},
                      });
                      return "Coletul de retur a fost completat. Verifică AWB-ul înainte de generare.";
                    })
                  }
                >
                  {busy === "complete" ? "Se completează…" : "Completează coletul de retur"}
                </button>
              </div>
            </div>
          )}

          {/* AWB-uri (cel mai nou primul) */}
          {awbs.length > 0 && (
            <div className={styles.awbTable}>
              {awbs.map((a) => (
                <div key={a.id} className={styles.awbLine}>
                  <span>
                    <strong className={styles.awbNumber}>{a.awbNumber || "fără număr"}</strong>{" "}
                    <span className={rs.meta}>{formatReturnDate(a.createdAt)}</span>
                  </span>
                  <span className={`${styles.awbState} ${styles[`awbState_${a.status}`] || ""}`}>
                    {AWB_STATUS_LABELS[a.status] || a.status}
                    {a.cancelState ? ` · anulare ${a.cancelState === "IN_PROGRESS" ? "în curs" : "neconfirmată"}` : ""}
                  </span>
                  {a.errorMessage && a.status !== "CREATED" && <span className={rs.meta}>{a.errorMessage}</span>}
                  {Object.entries(a.notices || {}).map(([kind, n]) => (
                    <span key={kind} className={rs.meta}>
                      Email „{kind === "cancelled" ? "ridicare anulată" : "ridicare comandată"}”: {NOTICE_STATE_LABELS[n.state] || n.state}
                      {n.attempts ? ` · ${n.attempts} încercări` : ""}
                      {n.lastError && n.state !== "SENT" ? ` · ${n.lastError}` : ""}
                      {n.resendable && (
                        <>
                          {" "}
                          <button
                            type="button"
                            className={`${rs.btn} ${rs.btnGhost}`}
                            disabled={!!busy}
                            title="Poate dubla un email deja livrat - retrimite doar după verificare."
                            onClick={() =>
                              run(`resend-${a.id}-${kind}`, async () => {
                                const res = await api(
                                  `/api/admin/returns/${encodeURIComponent(rr.id)}/notices/${encodeURIComponent(a.id)}/${kind}/resend`,
                                  { method: "POST" }
                                );
                                return `Notificare retrimisă: ${NOTICE_STATE_LABELS[res?.state] || res?.state || ""}`;
                              }, { keepPreview: true })
                            }
                          >
                            Retrimite
                          </button>
                        </>
                      )}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          )}

          {ship.trackingUrl && st.activeAwb?.status === "CREATED" && (
            <a className={`${rs.btn} ${rs.btnGhost} ${styles.toggle}`} href={ship.trackingUrl} target="_blank" rel="noreferrer">
              Urmărește la Sameday →
            </a>
          )}

          {/* 4 + 5. verificare + generare */}
          {!st.activeAwb && (
            <div className={rs.composer}>
              <div className={rs.actions}>
                <button
                  type="button"
                  className={rs.btn}
                  disabled={!st.canPreview || !!busy}
                  onClick={async () => {
                    setBusy("preview");
                    setError("");
                    setNotice("");
                    try {
                      const res = await api(`/api/admin/pickups/${encodeURIComponent(ship.id)}/return-awb/preview`, { method: "POST" });
                      setPreview(res?.preview || null);
                    } catch (e) {
                      setError(errorText(e, "Verificarea AWB-ului a eșuat."));
                    } finally {
                      setBusy("");
                    }
                  }}
                >
                  {busy === "preview" ? "Se verifică…" : preview ? "Verifică din nou" : "Verifică AWB-ul (fără generare)"}
                </button>
              </div>

              {preview && (
                <>
                  {preview.blockers?.length ? (
                    <ul className={styles.blockers}>
                      {preview.blockers.map((b) => (
                        <li key={`${b.code}-${b.field || ""}`}>{b.message}</li>
                      ))}
                    </ul>
                  ) : (
                    <span className={styles.ok}>Toate condițiile sunt îndeplinite.</span>
                  )}
                  <div className={styles.adminGrid}>
                    <div className={rs.fact}>
                      <span className={rs.factLabel}>Ridicare de la (client)</span>
                      {preview.pickup?.contactName} · {preview.pickup?.phone}
                      <br />
                      {preview.pickup?.fullAddress}
                    </div>
                    <div className={rs.fact}>
                      <span className={rs.factLabel}>Livrare la (vânzător)</span>
                      {preview.recipient?.name}
                      {preview.recipient?.company?.name ? ` · ${preview.recipient.company.name}` : ""}
                      <br />
                      {preview.deliveryAddress}
                    </div>
                    <div className={rs.fact}>
                      <span className={rs.factLabel}>Serviciu</span>
                      {preview.serviceName || "Retur standard"} · ramburs 0 · referință {preview.clientReference}
                    </div>
                  </div>
                  {preview.awbLiveEnabled === false && (
                    <div className={`${rs.notice} ${rs.notice_warning}`}>Generarea AWB nu este activată momentan (AWB live oprit).</div>
                  )}
                </>
              )}

              {st.canGenerate && !confirmGenerate && (
                <div className={rs.actions}>
                  <button type="button" className={`${rs.btn} ${rs.btnPrimary}`} disabled={!!busy} onClick={() => setConfirmGenerate(true)}>
                    Generează AWB-ul de retur
                  </button>
                </div>
              )}
              {st.canGenerate && confirmGenerate && (
                <div className={`${rs.notice} ${rs.notice_warning}`}>
                  Se creează un AWB real pe contractul Artfest, cu ridicare de la client. Confirmi?
                  <div className={rs.actions}>
                    <button
                      type="button"
                      className={`${rs.btn} ${rs.btnPrimary}`}
                      disabled={!!busy}
                      onClick={() =>
                        run("generate", async () => {
                          if (!idemKey.current) idemKey.current = newIdempotencyKey();
                          try {
                            const res = await api(`/api/admin/pickups/${encodeURIComponent(ship.id)}/return-awb`, {
                              method: "POST",
                              headers: { "Idempotency-Key": idemKey.current },
                            });
                            idemKey.current = null;
                            setConfirmGenerate(false);
                            return `AWB generat: ${res?.awb?.awbNumber || ""}`;
                          } catch (e) {
                            // eroare sigură (blocat / respins): următoarea încercare primește cheie nouă;
                            // rețea / timeout: păstrăm cheia -> retrimiterea nu poate crea al doilea AWB
                            if (e?.status && e.status < 500) idemKey.current = null;
                            setConfirmGenerate(false);
                            throw e;
                          }
                        })
                      }
                    >
                      {busy === "generate" ? "Se generează…" : "Da, generează AWB-ul"}
                    </button>
                    <button type="button" className={rs.btn} disabled={!!busy} onClick={() => setConfirmGenerate(false)}>
                      Renunță
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* AWB în curs / neconfirmat */}
          {st.awbInProgress && <div className={`${rs.notice} ${rs.notice_info}`}>AWB-ul este în curs de generare. Reîncarcă în câteva momente.</div>}
          {st.canRecover && (
            <div className={`${rs.notice} ${rs.notice_warning}`}>
              Sameday nu a confirmat rezultatul generării. Nu genera alt AWB - verifică întâi dacă AWB-ul există.
              <div className={rs.actions}>
                <button
                  type="button"
                  className={rs.btn}
                  disabled={!!busy}
                  onClick={() =>
                    run("recover", async () => {
                      const res = await api(`/api/admin/pickups/${encodeURIComponent(ship.id)}/return-awb/recover`, { method: "POST" });
                      idemKey.current = null;
                      return res?.outcome === "created"
                        ? `AWB găsit la Sameday: ${res?.awb?.awbNumber || ""}`
                        : "Sameday nu are AWB pentru această încercare. Poți genera din nou.";
                    })
                  }
                >
                  {busy === "recover" ? "Se verifică…" : "Verifică din nou la Sameday"}
                </button>
              </div>
            </div>
          )}

          {/* 6. etichetă */}
          {st.canDownloadLabel && <LabelButtons labelPath={(format) => adminLabelPath(ship.id, format)} awbNumber={st.activeAwb.awbNumber} />}

          {/* 8. anulare */}
          {st.cancelState && (
            <div className={`${rs.notice} ${rs.notice_warning}`}>
              Anularea AWB-ului este {st.cancelState === "IN_PROGRESS" ? "în curs" : "neconfirmată de Sameday"}. Fără etichetă până la
              clarificare; rezolvarea se face din secțiunea Ridicări / Curieri.
            </div>
          )}
          {st.canCancel && !cancelOpen && (
            <div className={rs.actions}>
              <button type="button" className={`${rs.btn} ${rs.btnDanger}`} disabled={!!busy} onClick={() => setCancelOpen(true)}>
                Anulează AWB-ul
              </button>
            </div>
          )}
          {st.canCancel && cancelOpen && (
            <div className={rs.composer}>
              <div className={rs.hint}>Anularea se trimite la Sameday; starea se schimbă doar după confirmare. Statusul cererii nu se modifică.</div>
              <textarea
                className={rs.textarea}
                value={cancelNote}
                onChange={(e) => setCancelNote(e.target.value)}
                placeholder="Motivul anulării (intern)"
                maxLength={500}
              />
              <div className={rs.actions}>
                <button
                  type="button"
                  className={`${rs.btn} ${rs.btnDanger}`}
                  disabled={!!busy}
                  onClick={() =>
                    run("cancel", async () => {
                      await api(
                        `/api/admin/pickups/${encodeURIComponent(ship.id)}/courier-awb/${encodeURIComponent(st.activeAwb.id)}/cancel`,
                        { method: "POST", body: { note: cancelNote.trim() || null } }
                      );
                      setCancelOpen(false);
                      setCancelNote("");
                      // la anulare confirmată cererea revine în „Acceptată”, iar clientul e anunțat
                      idemKey.current = null;
                      return "AWB-ul a fost anulat la Sameday. Clientul este anunțat; poți genera un AWB nou după o nouă verificare.";
                    })
                  }
                >
                  {busy === "cancel" ? "Se anulează…" : "Confirmă anularea"}
                </button>
                <button type="button" className={rs.btn} disabled={!!busy} onClick={() => setCancelOpen(false)}>
                  Renunță
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {notice && <div className={`${rs.notice} ${rs.notice_success}`}>{notice}</div>}
      {error && <div className={rs.error}>{error}</div>}
    </section>
  );
}
