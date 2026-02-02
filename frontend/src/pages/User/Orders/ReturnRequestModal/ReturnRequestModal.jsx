import React, { useEffect, useMemo, useState } from "react";
import styles from "./ReturnRequestModal.module.css";
import { api } from "../../../../lib/api.js";

/**
 * IMPORTANT:
 * - Politica de retur este la nivel de PLATFORMĂ (Artfest), nu la nivel de vânzător.
 * - Linkul din UI trebuie să ducă la documentul/pagina oficială a politicii de retur a platformei.
 */

/**
 * URL absolut către backend pentru documente (dacă VITE_API_URL există),
 * altfel rămâne relativ (merge pe același origin).
 */
function absUrl(pathname) {
  const p = pathname || "";
  if (/^https?:\/\//i.test(p)) return p;
  const rel = p.startsWith("/") ? p : `/${p}`;
  const base = (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");
  return base ? `${base}${rel}` : rel;
}

/* ===== helper upload direct în R2 via /api/upload ===== */
async function uploadToR2(file) {
  const form = new FormData();
  form.append("file", file);

  const res = await fetch("/api/upload", {
    method: "POST",
    body: form,
    credentials: "include",
  });

  if (!res.ok) {
    let errMsg = "Upload eșuat. Încearcă din nou.";
    try {
      const data = await res.json();
      if (data?.message) errMsg = data.message;
    } catch {""}
    throw new Error(errMsg);
  }

  const data = await res.json(); // { ok, url, key }
  if (!data?.ok || !data?.url) {
    throw new Error("Upload eșuat. Răspuns invalid de la server.");
  }
  return data.url;
}

const REASONS = [
  { code: "DEFECT", label: "Produs defect / deteriorat" },
  { code: "WRONG_ITEM", label: "Produs greșit primit" },
  { code: "NOT_AS_DESCRIBED", label: "Nu corespunde descrierii" },
  { code: "SIZE_COLOR", label: "Mărime/culoare nepotrivită" },
  { code: "CHANGED_MIND", label: "M-am răzgândit" },
  { code: "OTHER", label: "Alt motiv" },
];

const RESOLUTIONS = [
  { code: "REFUND", label: "Ramburs" },
  { code: "EXCHANGE", label: "Schimb produs" },
  { code: "VOUCHER", label: "Voucher" },
];

function formatAddress(addr) {
  if (!addr) return "";
  const parts = [
    addr.name,
    addr.street,
    addr.city,
    addr.county,
    addr.postalCode,
    addr.country,
  ].filter(Boolean);
  return parts.join(", ");
}

function shortId(id = "") {
  if (!id) return "";
  if (id.length <= 8) return id;
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
}

function daysBetween(a, b) {
  const ms = Math.abs(a.getTime() - b.getTime());
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

/**
 * Props:
 * - open: boolean
 * - onClose: () => void
 * - orderId: string
 *
 * Backend:
 * - GET /api/user/orders/:id (existent)
 * - optional: GET /api/user/orders/:id/return-info (recomandat)
 *   -> ideal include:
 *      {
 *        policy: { title, url, key, version, summary },   // <- POLICY DE PLATFORMĂ (Artfest)
 *        windowDays: 14,
 *        vendors: [{ shipmentId, vendorName, returnAddress }]
 *      }
 * - POST /api/user/returns
 */
export default function ReturnRequestModal({ open, onClose, orderId }) {
  const [loading, setLoading] = useState(false);
  const [details, setDetails] = useState(null);
  const [returnInfo, setReturnInfo] = useState(null);
  const [err, setErr] = useState("");

  // form state
  const [selectedShipmentId, setSelectedShipmentId] = useState("");
  const [selectedItems, setSelectedItems] = useState({}); // orderItemId -> qty
  const [reasonCode, setReasonCode] = useState("DEFECT");
  const [reasonText, setReasonText] = useState("");
  const [faultParty, setFaultParty] = useState("UNKNOWN"); // VENDOR | CUSTOMER | UNKNOWN (doar pentru triere internă)
  const [resolutionWanted, setResolutionWanted] = useState("REFUND");
  const [notesUser, setNotesUser] = useState("");
  const [acceptPolicy, setAcceptPolicy] = useState(false);

  // photos
  const [photoUrls, setPhotoUrls] = useState([]);
  const [uploading, setUploading] = useState(false);

  const [submitted, setSubmitted] = useState(false);
  const [createdRequest, setCreatedRequest] = useState(null);

  // close on ESC
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // load data when open
  useEffect(() => {
    let alive = true;
    if (!open || !orderId) return;

    (async () => {
      setLoading(true);
      setErr("");
      setSubmitted(false);
      setCreatedRequest(null);

      try {
        const d = await api(`/api/user/orders/${encodeURIComponent(orderId)}`);
        if (!alive) return;
        setDetails(d);

        // try return-info (optional)
        try {
          const ri = await api(
            `/api/user/orders/${encodeURIComponent(orderId)}/return-info`
          );
          if (!alive) return;
          setReturnInfo(ri);
        } catch {
          setReturnInfo(null);
        }

        // default pick first shipment (prefer delivered)
        const sh = Array.isArray(d?.shipments) ? d.shipments : [];
        const deliveredFirst = sh.find((s) => s?.status === "DELIVERED") || sh[0];

        setSelectedShipmentId(deliveredFirst?.id || "");
        setSelectedItems({});
        setReasonCode("DEFECT");
        setReasonText("");
        setFaultParty("UNKNOWN");
        setResolutionWanted("REFUND");
        setNotesUser("");
        setPhotoUrls([]);
        setAcceptPolicy(false);
      } catch (e) {
        if (!alive) return;
        setErr(e?.message || "Nu am putut încărca datele comenzii.");
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [open, orderId]);

  const uiStatus = details?.status; // DELIVERED etc

  const shipments = useMemo(() => {
    const s = Array.isArray(details?.shipments) ? details.shipments : [];
    const delivered = s.filter((x) => x?.status === "DELIVERED");
    return delivered.length ? delivered : s;
  }, [details]);

  // items grouped by shipmentId
  const itemsByShipment = useMemo(() => {
    const map = new Map();
    const items = Array.isArray(details?.items) ? details.items : [];
    for (const it of items) {
      const sid = it.shipmentId || "unknown";
      if (!map.has(sid)) map.set(sid, []);
      map.get(sid).push(it);
    }
    for (const [k, list] of map.entries()) {
      list.sort((a, b) => (a.title || "").localeCompare(b.title || "", "ro"));
      map.set(k, list);
    }
    return map;
  }, [details]);

  const activeShipment = useMemo(() => {
    return shipments.find((s) => s.id === selectedShipmentId) || null;
  }, [shipments, selectedShipmentId]);

  const activeItems = useMemo(() => {
    if (!selectedShipmentId) return [];
    return itemsByShipment.get(selectedShipmentId) || [];
  }, [itemsByShipment, selectedShipmentId]);

  const vendorName =
    activeShipment?.vendorName ||
    (returnInfo?.vendors || []).find((v) => v?.shipmentId === selectedShipmentId)
      ?.vendorName ||
    "Artizan";

  const returnAddressText = useMemo(() => {
    const fromReturnInfo =
      (returnInfo?.vendors || []).find((v) => v?.shipmentId === selectedShipmentId)
        ?.returnAddress || null;

    const storeAddr = activeShipment?.storeAddress || null;
    const addr = fromReturnInfo || storeAddr;
    return formatAddress(addr);
  }, [returnInfo, selectedShipmentId, activeShipment]);

  /**
   * ✅ POLITICĂ DE PLATFORMĂ (Artfest)
   * Aici vrem link către documentul/pagina oficială de retur (platform-level).
   * - ideal: returnInfo.policy.url = link către documentul de politici de retur (fișierul tău)
   * - fallback: o rută publică stabilă
   */
  const policy = useMemo(() => {
    const fallback = {
      title: "Politica de retur — Artfest (platformă)",
      // IMPORTANT: schimbă acest fallback în ruta ta reală publică (pagina/fișierul politicii)
      url: "/legal/politica-de-retur",
      key: "returns_policy_ack",
      version: 1,
      summary:
        "Aceasta este politica de retur a platformei Artfest. Rambursările către client sunt efectuate de Artfest, conform acestei politici.",
    };

    const p = returnInfo?.policy || null; // <- trebuie să fie policy de PLATFORMĂ
    return p?.title || p?.url ? { ...fallback, ...p } : fallback;
  }, [returnInfo]);

  // ✅ link către politicile de retur (platform-level), absolut ca în onboarding
  const policyUrl = useMemo(
    () => absUrl(policy?.url || "/legal/politica-de-retur"),
    [policy]
  );

  const returnWindowDays = returnInfo?.windowDays || 14;

  const deliveredAt = useMemo(() => {
    const s = shipments.find((x) => x.id === selectedShipmentId);
    const t =
      s?.deliveredAt ||
      s?.statusUpdatedAt ||
      details?.deliveredAt ||
      details?.statusUpdatedAt ||
      null;
    return t ? new Date(t) : null;
  }, [shipments, selectedShipmentId, details]);

  const withinWindow = useMemo(() => {
    if (!deliveredAt) return true;
    return daysBetween(new Date(), deliveredAt) <= returnWindowDays;
  }, [deliveredAt, returnWindowDays]);

  function toggleItem(it, checked) {
    setSelectedItems((prev) => {
      const next = { ...prev };
      if (!checked) {
        delete next[it.id];
        return next;
      }
      next[it.id] = Math.max(1, Number(it.qty || 1));
      return next;
    });
  }

  function changeQty(itemId, qty, maxQty) {
    const q = Math.max(1, Math.min(Number(qty || 1), Number(maxQty || 1)));
    setSelectedItems((prev) => ({ ...prev, [itemId]: q }));
  }

  const selectedCount = useMemo(() => Object.keys(selectedItems).length, [selectedItems]);

  const needsEvidence = useMemo(() => {
    return ["DEFECT", "WRONG_ITEM", "NOT_AS_DESCRIBED"].includes(reasonCode);
  }, [reasonCode]);

  const canSubmit = useMemo(() => {
    if (uiStatus !== "DELIVERED") return false;
    if (!selectedShipmentId) return false;
    if (selectedCount === 0) return false;

    // ✅ trebuie acceptată politica de retur a platformei
    if (!acceptPolicy) return false;

    if (reasonCode === "OTHER" && !reasonText.trim()) return false;
    if (needsEvidence && photoUrls.length === 0) return false;

    // dacă e depășită fereastra standard, permitem doar pentru neconformitate
    if (!withinWindow) {
      const isNonConform = ["DEFECT", "WRONG_ITEM", "NOT_AS_DESCRIBED"].includes(reasonCode);
      if (!isNonConform) return false;
    }
    return true;
  }, [
    uiStatus,
    selectedShipmentId,
    selectedCount,
    acceptPolicy,
    reasonCode,
    reasonText,
    needsEvidence,
    photoUrls.length,
    withinWindow,
  ]);

  async function onPickPhotos(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;

    try {
      setUploading(true);
      setErr("");

      const limited = files.slice(0, Math.max(0, 6 - photoUrls.length));
      for (const f of limited) {
        if (!/^image\/(png|jpe?g|webp)$/i.test(f.type)) {
          throw new Error("Acceptăm doar PNG / JPG / WebP.");
        }
        if (f.size > 3 * 1024 * 1024) {
          throw new Error("Maxim 3 MB per poză.");
        }

        const url = await uploadToR2(f);
        setPhotoUrls((prev) => [...prev, url].slice(0, 6));
      }
    } catch (e2) {
      setErr(e2?.message || "Nu am putut încărca pozele.");
    } finally {
      setUploading(false);
    }
  }

  function removePhoto(url) {
    setPhotoUrls((prev) => prev.filter((x) => x !== url));
  }

  async function submit() {
    setErr("");
    if (!canSubmit) return;

    try {
      setLoading(true);

      const itemsPayload = Object.entries(selectedItems).map(([orderItemId, qty]) => ({
        orderItemId,
        qty: Number(qty || 1),
      }));

      const body = {
        orderId,
        shipmentId: selectedShipmentId,
        vendorId: activeShipment?.vendorId || null,
        items: itemsPayload,
        reasonCode,
        reasonText: reasonCode === "OTHER" ? reasonText.trim() : null,
        faultParty,
        resolutionWanted,
        notesUser: notesUser.trim() || null,
        photos: photoUrls,

        // ✅ audit: user a acceptat politica de retur a PLATFORMEI + linkul către document
        policyAck: {
          accepted: true,
          key: policy.key, // "returns_policy_ack"
          version: policy.version,
          acceptedAt: new Date().toISOString(),
          url: policyUrl, // link către politicile de retur (platform-level)
        },
      };

      const res = await api("/api/user/returns", { method: "POST", body });
      setCreatedRequest(res || { ok: true });
      setSubmitted(true);
    } catch (e) {
      setErr(e?.message || "Nu am putut trimite cererea de retur.");
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-label="Cerere retur">
      <div className={styles.modal}>
        <div className={styles.head}>
          <div>
            <div className={styles.title}>Inițiere retur</div>
            <div className={styles.subtle}>
              Comandă: <b>#{details?.orderNumber || details?.id || orderId}</b>
            </div>
          </div>
          <button className={styles.iconBtn} onClick={onClose} aria-label="Închide">
            ×
          </button>
        </div>

        {loading && !details ? (
          <div className={styles.body}>Se încarcă…</div>
        ) : err ? (
          <div className={styles.body}>
            <div className={styles.error}>{err}</div>
            <div className={styles.actions}>
              <button className={styles.btnGhost} onClick={onClose}>
                Închide
              </button>
            </div>
          </div>
        ) : uiStatus !== "DELIVERED" ? (
          <div className={styles.body}>
            <div className={styles.warn}>
              Returul este disponibil doar pentru comenzi <b>Livrate</b>.
            </div>
            <div className={styles.actions}>
              <button className={styles.btnGhost} onClick={onClose}>
                Am înțeles
              </button>
            </div>
          </div>
        ) : submitted ? (
          <div className={styles.body}>
            <div className={styles.successTitle}>Cererea de retur a fost trimisă ✅</div>

            <div className={styles.subtle} style={{ marginTop: 8 }}>
              Politica de retur (platformă):{" "}
              <a className={styles.link} href={policyUrl} target="_blank" rel="noreferrer">
                {policy.title}
              </a>{" "}
              (v{policy.version})
            </div>

            <div className={styles.card}>
              <div className={styles.cardTitle}>Ce urmează</div>
              <ol className={styles.steps}>
                <li>Ambalează produsul în siguranță (ideal în ambalajul original).</li>
                <li>
                  Notează pe colet: <b>Comandă #{details?.orderNumber || shortId(details?.id)}</b>
                  {createdRequest?.returnRequestId ? (
                    <>
                      {" "}
                      · <b>Cerere #{createdRequest.returnRequestId}</b>
                    </>
                  ) : null}
                </li>
                <li>
                  Depune coletul la curier (manual). În caz de neconformitate, soluționarea se face conform
                  politicii de retur a platformei.
                </li>
              </ol>
            </div>

            <div className={styles.card}>
              <div className={styles.cardTitle}>Adresa de retur ({vendorName})</div>
              <div className={styles.addr}>{returnAddressText || "Adresa nu este disponibilă încă."}</div>
            </div>

            <div className={styles.actions}>
              <button className={styles.btnPrimary} onClick={onClose}>
                Închide
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className={styles.body}>
              {/* Policy (platform-level) */}
              <div className={styles.card}>
                <div className={styles.cardTitle}>Politica de retur (platformă)</div>
                <div className={styles.subtle}>{policy.summary}</div>
                <div style={{ marginTop: 8 }}>
                  <a className={styles.link} href={policyUrl} target="_blank" rel="noreferrer">
                    Vezi politicile de retur →{/* <- link către documentul de politici */}
                  </a>
                  <span className={styles.subtle}> &nbsp;· v{policy.version}</span>
                </div>
              </div>

              {!withinWindow && (
                <div className={styles.card}>
                  <div className={styles.warn}>
                    Perioada standard de retur ({returnWindowDays} zile) pare depășită pentru acest colet.
                    Dacă produsul este defect/neconform, poți trimite în continuare o solicitare.
                  </div>
                </div>
              )}

              {/* Shipment pick (logistic, nu politică) */}
              <div className={styles.card}>
                <div className={styles.cardTitle}>Alege coletul (pentru retur)</div>
                <div className={styles.subtle}>
                  Dacă ai comandă cu mai multe colete, returul se inițiază separat pe fiecare.
                </div>

                <div className={styles.row} style={{ marginTop: 10 }}>
                  <label className={styles.label}>Colet</label>
                  <select
                    className={styles.select}
                    value={selectedShipmentId}
                    onChange={(e) => {
                      setSelectedShipmentId(e.target.value);
                      setSelectedItems({});
                      setPhotoUrls([]);
                    }}
                  >
                    {shipments.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.vendorName || "Artizan"} · {s.status}
                      </option>
                    ))}
                  </select>
                </div>

                <div className={styles.row} style={{ marginTop: 10 }}>
                  <label className={styles.label}>Adresa de retur</label>
                  <div className={styles.addr}>{returnAddressText || "Adresa nu este disponibilă încă."}</div>
                </div>
              </div>

              {/* Items */}
              <div className={styles.card}>
                <div className={styles.cardTitle}>Selectează produsele pentru retur</div>

                {activeItems.length === 0 ? (
                  <div className={styles.warn}>Nu am găsit produse pentru acest colet.</div>
                ) : (
                  <>
                    <div
                      className={styles.row}
                      style={{ justifyContent: "space-between", marginBottom: 8, gap: 10 }}
                    >
                      <button
                        type="button"
                        className={styles.btnGhost}
                        onClick={() => {
                          const next = {};
                          for (const it of activeItems) next[it.id] = Math.max(1, Number(it.qty || 1));
                          setSelectedItems(next);
                        }}
                      >
                        Selectează toate
                      </button>

                      <button
                        type="button"
                        className={styles.btnGhost}
                        onClick={() => setSelectedItems({})}
                        disabled={selectedCount === 0}
                      >
                        Deselectează
                      </button>
                    </div>

                    <div className={styles.items}>
                      {activeItems.map((it) => {
                        const checked = selectedItems[it.id] != null;
                        const maxQty = Number(it.qty || 1);
                        return (
                          <div key={it.id} className={styles.itemRow}>
                            <label className={styles.itemLeft}>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => toggleItem(it, e.target.checked)}
                              />
                              <img
                                src={it.image || "/placeholder.png"}
                                alt={it.title}
                                className={styles.thumb}
                                loading="lazy"
                              />
                              <div>
                                <div className={styles.itemTitle}>{it.title}</div>
                                <div className={styles.subtle}>
                                  Cantitate cumpărată: <b>{maxQty}</b>
                                </div>
                              </div>
                            </label>

                            <div className={styles.itemRight}>
                              <label className={styles.subtle}>Qty retur</label>
                              <input
                                className={styles.qty}
                                type="number"
                                min={1}
                                max={maxQty}
                                value={checked ? selectedItems[it.id] : 1}
                                disabled={!checked}
                                onChange={(e) => changeQty(it.id, e.target.value, maxQty)}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>

              {/* Reason */}
              <div className={styles.card}>
                <div className={styles.cardTitle}>Detalii retur</div>

                <div className={styles.grid2}>
                  <div className={styles.row}>
                    <label className={styles.label}>Motiv</label>
                    <select
                      className={styles.select}
                      value={reasonCode}
                      onChange={(e) => setReasonCode(e.target.value)}
                    >
                      {REASONS.map((r) => (
                        <option key={r.code} value={r.code}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className={styles.row}>
                    <label className={styles.label}>Soluție dorită</label>
                    <select
                      className={styles.select}
                      value={resolutionWanted}
                      onChange={(e) => setResolutionWanted(e.target.value)}
                    >
                      {RESOLUTIONS.map((r) => (
                        <option key={r.code} value={r.code}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {reasonCode === "OTHER" && (
                  <div className={styles.row} style={{ marginTop: 10 }}>
                    <label className={styles.label}>Detaliază motivul</label>
                    <input
                      className={styles.input}
                      value={reasonText}
                      onChange={(e) => setReasonText(e.target.value)}
                      placeholder="Scrie pe scurt motivul…"
                    />
                  </div>
                )}

                <div className={styles.row} style={{ marginTop: 10 }}>
                  <label className={styles.label}>Observații</label>
                  <textarea
                    className={styles.textarea}
                    rows={4}
                    value={notesUser}
                    onChange={(e) => setNotesUser(e.target.value)}
                    placeholder="Ex: are o zgârietură pe lateral, lipsește un accesoriu…"
                  />
                </div>
              </div>

              {/* Photos */}
              <div className={styles.card}>
                <div className={styles.cardTitle}>
                  Poze {needsEvidence ? "(obligatoriu pentru acest motiv)" : "(recomandat)"}
                </div>
                <div className={styles.subtle}>Max 6 poze · PNG/JPG/WebP · max 3MB/poză</div>

                {needsEvidence && photoUrls.length === 0 && (
                  <div className={styles.hint}>Pentru acest motiv, te rugăm să adaugi cel puțin o poză.</div>
                )}

                <div className={styles.photoRow}>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    multiple
                    onChange={onPickPhotos}
                    disabled={uploading || photoUrls.length >= 6}
                  />
                  {uploading && <span className={styles.subtle}>Se încarcă…</span>}
                </div>

                {photoUrls.length > 0 && (
                  <div className={styles.photos}>
                    {photoUrls.map((u) => (
                      <div key={u} className={styles.photo}>
                        <img src={u} alt="Poză retur" />
                        <button
                          type="button"
                          className={styles.photoRemove}
                          onClick={() => removePhoto(u)}
                          aria-label="Șterge poză"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Accept policy (platform-level + link) */}
              <div className={styles.card}>
                <label className={styles.check}>
                  <input
                    type="checkbox"
                    checked={acceptPolicy}
                    onChange={(e) => setAcceptPolicy(e.target.checked)}
                  />
                  <span>
                    Confirm că am citit și accept{" "}
                    <a
                      className={styles.link}
                      href={policyUrl}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                    >
                      politicile de retur ale platformei Artfest
                    </a>{" "}
                    (v{policy.version}).
                  </span>
                </label>
              </div>

              {err && <div className={styles.error}>{err}</div>}
            </div>

            <div className={styles.actions}>
              <button className={styles.btnGhost} onClick={onClose} disabled={loading}>
                Anulează
              </button>
              <button
                className={styles.btnPrimary}
                onClick={submit}
                disabled={!canSubmit || loading}
                title={
                  !canSubmit
                    ? needsEvidence && photoUrls.length === 0
                      ? "Adaugă cel puțin o poză și acceptă politicile de retur"
                      : "Selectează produse și acceptă politicile de retur"
                    : undefined
                }
              >
                {loading ? "Se trimite…" : "Trimite cererea de retur"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
