import React, { useEffect, useMemo, useRef, useState } from "react";
import styles from "./ReturnRequestModal.module.css";
import { api } from "../../../../lib/api.js";
/*
 * Motivele și clasificarea produselor personalizate vin din aceeași sursă
 * ca validarea backend (OUG 34/2014: art. 9 - retragere fără motiv; art. 16
 * lit. c - excepția pentru produse realizate după specificațiile clientului
 * sau personalizate în mod clar).
 */
import {
  PERSONALIZATION,
  PERSONALIZED_WITHDRAWAL_MESSAGE,
  RETURN_REASONS,
  combinePersonalization,
  formReasonsFor,
  isConformityReason,
  isWithdrawalReason,
} from "../../../../../../backend/src/services/returnRequestRules.js";

/**
 * Politica de retur = documentul legal ACTIV „returns_policy_ack”, citit
 * din mecanismul legal existent (GET /api/legal?types=returns_policy_ack ->
 * versiunea publicată). Linkul duce la pagina publică /politica-retur, care
 * afișează mereu versiunea activă - fără versiune hardcodată aici. Versiunea
 * e trimisă doar intern, în policyAck (audit).
 */
const POLICY_FALLBACK = {
  key: "returns_policy_ack",
  version: null,
  url: "/politica-retur",
};

async function loadActiveReturnsPolicy() {
  try {
    const list = await api("/api/legal?types=returns_policy_ack");
    const doc = Array.isArray(list) ? list.find((d) => d?.type === "returns_policy_ack") : null;

    return doc
      ? { key: "returns_policy_ack", version: doc.version ?? null, url: doc.url || POLICY_FALLBACK.url }
      : POLICY_FALLBACK;
  } catch {
    return POLICY_FALLBACK;
  }
}

async function uploadPhoto(file, endpoint) {
  const form = new FormData();
  form.append("file", file);

  const res = await fetch(endpoint, {
    method: "POST",
    body: form,
    credentials: "include",
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok || !data?.url) {
    throw new Error(data?.message || "Upload eșuat. Încearcă din nou.");
  }

  return data.url;
}

const DEFAULT_REASON = "DEFECT";

const RESOLUTIONS = [
  { code: "REFUND", label: "Ramburs" },
  { code: "EXCHANGE", label: "Schimb produs" },
  { code: "VOUCHER", label: "Voucher" },
];

const MAX_PHOTOS = 6;

function daysBetween(a, b) {
  const ms = Math.abs(a.getTime() - b.getTime());
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

/**
 * Props:
 * - open, onClose, orderId
 * - mode: "user" (implicit) | "guest"
 * - guestToken: tokenul comenzii guest (doar în mode="guest")
 * - guestAccessQuery: query de acces gata construit (ex. "orderToken=..."),
 *   are prioritate față de guestToken
 * - onSubmitted: apelat după trimiterea cu succes (ex. reîncărcare listă)
 *
 * Backend:
 * - user:  GET /api/user/orders/:id, POST /api/user/returns, POST /api/upload
 * - guest: GET/POST /api/guest/orders/:id/returns?token=|orderToken=,
 *          POST /api/guest/orders/:id/returns/photos?token=|orderToken=
 */
export default function ReturnRequestModal({
  open,
  onClose,
  orderId,
  mode = "user",
  guestToken = "",
  guestAccessQuery = "",
  onSubmitted,
}) {
  const isGuest = mode === "guest";
  const guestQuery = guestAccessQuery || `token=${encodeURIComponent(guestToken || "")}`;

  const [loading, setLoading] = useState(false);
  const [details, setDetails] = useState(null);
  const [policy, setPolicy] = useState(POLICY_FALLBACK);
  const [err, setErr] = useState("");

  // form state
  const [selectedShipmentId, setSelectedShipmentId] = useState("");
  const [selectedItems, setSelectedItems] = useState({}); // orderItemId -> qty
  const [reasonCode, setReasonCode] = useState(DEFAULT_REASON);
  const [reasonText, setReasonText] = useState("");
  const [resolutionWanted, setResolutionWanted] = useState("REFUND");
  const [notesUser, setNotesUser] = useState("");
  const [acceptPolicy, setAcceptPolicy] = useState(false);

  // photos
  const [photoUrls, setPhotoUrls] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

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
        const [d, activePolicy] = await Promise.all([
          isGuest
            ? api(`/api/guest/orders/${encodeURIComponent(orderId)}/returns?${guestQuery}`).then((r) => r?.order)
            : api(`/api/user/orders/${encodeURIComponent(orderId)}`),
          loadActiveReturnsPolicy(),
        ]);
        if (!alive) return;

        setDetails(d || null);
        setPolicy(activePolicy);

        // default pick first shipment (prefer delivered)
        const sh = Array.isArray(d?.shipments) ? d.shipments : [];
        const deliveredFirst = sh.find((s) => s?.status === "DELIVERED") || sh[0];

        setSelectedShipmentId(deliveredFirst?.id || "");
        setSelectedItems({});
        setReasonCode(DEFAULT_REASON);
        setReasonText("");
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
  }, [open, orderId, isGuest, guestQuery]);

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

  const activeItems = useMemo(() => {
    if (!selectedShipmentId) return [];
    return itemsByShipment.get(selectedShipmentId) || [];
  }, [itemsByShipment, selectedShipmentId]);

  const policyUrl = policy?.url || POLICY_FALLBACK.url;

  const returnWindowDays = 14;

  const deliveredAt = useMemo(() => {
    const s = shipments.find((x) => x.id === selectedShipmentId);
    const t = s?.deliveredAt || s?.statusUpdatedAt || details?.deliveredAt || details?.statusUpdatedAt || null;
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

  /*
   * STANDARD | PERSONALIZED | UNCLEAR pentru produsele selectate (calculat
   * de backend pe fiecare linie). Culoarea/mărimea/opțiunile standard NU fac
   * produsul personalizat.
   */
  const personalization = useMemo(() => {
    const selected = activeItems.filter((it) => selectedItems[it.id] != null);
    return combinePersonalization(selected.map((it) => it.returnPersonalization));
  }, [activeItems, selectedItems]);

  const isPersonalized = personalization === PERSONALIZATION.PERSONALIZED;

  // după termenul de 14 zile rămâne doar neconformitatea
  const reasons = useMemo(
    () => formReasonsFor(personalization).filter((r) => withinWindow || r.kind === "CONFORMITY"),
    [personalization, withinWindow]
  );

  // motivul ales nu mai e disponibil (ex. s-a selectat un produs personalizat)
  useEffect(() => {
    if (!reasons.some((r) => r.code === reasonCode)) {
      setReasonCode(reasons[0]?.code || DEFAULT_REASON);
    }
  }, [reasons, reasonCode]);

  const reason = RETURN_REASONS[reasonCode] || null;
  const needsEvidence = Boolean(reason?.photosRequired);
  const needsReasonText = Boolean(reason?.textRequired);

  const canSubmit = useMemo(() => {
    if (uiStatus !== "DELIVERED") return false;
    if (!selectedShipmentId) return false;
    if (selectedCount === 0) return false;

    // ✅ trebuie acceptată politica de retur a platformei
    if (!acceptPolicy) return false;

    if (!reasons.some((r) => r.code === reasonCode)) return false;
    if (needsReasonText && !reasonText.trim()) return false;
    if (needsEvidence && photoUrls.length === 0) return false;

    // dacă e depășită fereastra standard, permitem doar pentru neconformitate
    if (!withinWindow && !isConformityReason(reasonCode)) return false;

    // retragere fără motiv: nu pentru produse personalizate (art. 16 lit. c)
    if (isPersonalized && isWithdrawalReason(reasonCode)) return false;

    return true;
  }, [
    uiStatus,
    selectedShipmentId,
    selectedCount,
    acceptPolicy,
    reasons,
    reasonCode,
    reasonText,
    needsReasonText,
    needsEvidence,
    photoUrls.length,
    withinWindow,
    isPersonalized,
  ]);

  const uploadEndpoint = isGuest
    ? `/api/guest/orders/${encodeURIComponent(orderId)}/returns/photos?${guestQuery}`
    : "/api/upload";

  async function addPhotos(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;

    try {
      setUploading(true);
      setErr("");

      const limited = files.slice(0, Math.max(0, MAX_PHOTOS - photoUrls.length));
      for (const f of limited) {
        if (!/^image\/(png|jpe?g|webp)$/i.test(f.type)) {
          throw new Error("Acceptăm doar PNG / JPG / WebP.");
        }
        if (f.size > 3 * 1024 * 1024) {
          throw new Error("Maxim 3 MB per poză.");
        }

        const url = await uploadPhoto(f, uploadEndpoint);
        setPhotoUrls((prev) => [...prev, url].slice(0, MAX_PHOTOS));
      }
    } catch (e2) {
      setErr(e2?.message || "Nu am putut încărca pozele.");
    } finally {
      setUploading(false);
    }
  }

  function onPickPhotos(e) {
    const files = e.target.files;
    addPhotos(files);
    e.target.value = "";
  }

  function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    if (uploading || photoUrls.length >= MAX_PHOTOS) return;
    addPhotos(e.dataTransfer?.files);
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
        items: itemsPayload,
        reasonCode,
        reasonText: needsReasonText ? reasonText.trim() : null,
        faultParty: "UNKNOWN",
        resolutionWanted,
        notesUser: notesUser.trim() || null,
        photos: photoUrls,

        // audit: politica ACTIVĂ confirmată de client (versiunea nu e afișată)
        policyAck: {
          accepted: true,
          key: policy.key,
          version: policy.version,
          acceptedAt: new Date().toISOString(),
          url: policyUrl,
        },
      };

      const res = isGuest
        ? await api(`/api/guest/orders/${encodeURIComponent(orderId)}/returns?${guestQuery}`, { method: "POST", body })
        : await api("/api/user/returns", { method: "POST", body });

      setCreatedRequest(res || { ok: true });
      setSubmitted(true);
      onSubmitted?.(res);
    } catch (e) {
      setErr(e?.data?.message || e?.message || "Nu am putut trimite cererea de retur.");
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  const orderLabel = details?.orderNumber || details?.id || orderId;

  return (
    <div
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      aria-labelledby="return-modal-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div className={styles.modal}>
        <header className={styles.head}>
          <div>
            <h2 id="return-modal-title" className={styles.title}>
              Solicită retur
            </h2>
            <div className={styles.subtle}>Comanda #{orderLabel}</div>
          </div>
          <button type="button" className={styles.iconBtn} onClick={onClose} aria-label="Închide">
            ×
          </button>
        </header>

        {loading && !details ? (
          <div className={styles.body}>
            <div className={styles.loading}>Se încarcă…</div>
          </div>
        ) : err && !details ? (
          <div className={styles.body}>
            <div className={styles.error}>{err}</div>
            <div className={styles.footer}>
              <button type="button" className={styles.btnGhost} onClick={onClose}>
                Închide
              </button>
            </div>
          </div>
        ) : uiStatus !== "DELIVERED" ? (
          <div className={styles.body}>
            <div className={styles.notice}>
              Returul este disponibil doar pentru comenzile <b>livrate</b>.
            </div>
            <div className={styles.footer}>
              <button type="button" className={styles.btnGhost} onClick={onClose}>
                Am înțeles
              </button>
            </div>
          </div>
        ) : submitted ? (
          <div className={styles.body}>
            <div className={styles.success}>
              <div className={styles.successIcon} aria-hidden="true">
                ✓
              </div>
              <h3 className={styles.successTitle}>Cererea ta a fost trimisă</h3>
              <p className={styles.successText}>
                Așteaptă răspunsul vânzătorului înainte să expediezi produsul. Te anunțăm imediat ce cererea este
                acceptată, împreună cu instrucțiunile de retur.
              </p>
              {createdRequest?.review && (
                <p className={styles.successText}>
                  Cererea este verificată de vânzător și de echipa Artfest, pentru a stabili dacă produsul a fost
                  realizat după specificațiile tale.
                </p>
              )}
            </div>

            <ol className={styles.steps}>
              <li>Vânzătorul analizează cererea (poate cere informații suplimentare).</li>
              <li>Dacă returul este acceptat, primești instrucțiunile și adresa de retur.</li>
              <li>Abia după acceptare pregătești și expediezi produsul.</li>
            </ol>

            <div className={styles.footer}>
              <button type="button" className={styles.btnPrimary} onClick={onClose}>
                Închide
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className={styles.body}>
              {!withinWindow && (
                <div className={`${styles.notice} ${styles.noticeWarning}`}>
                  Termenul de {returnWindowDays} zile pentru retragere pare depășit pentru acest colet. Dacă produsul
                  are o problemă (defect, greșit, neconform), poți trimite în continuare o solicitare.
                </div>
              )}

              {/* Colet */}
              {shipments.length > 1 && (
                <section className={styles.section}>
                  <label className={styles.label} htmlFor="return-shipment">
                    Colet
                  </label>
                  <select
                    id="return-shipment"
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
                        {s.vendorName || "Artizan"}
                      </option>
                    ))}
                  </select>
                  <div className={styles.hint}>Returul se solicită separat pentru fiecare colet.</div>
                </section>
              )}

              {/* Produse */}
              <section className={styles.section}>
                <div className={styles.sectionHead}>
                  <h3 className={styles.sectionTitle}>Ce produse returnezi?</h3>
                  {activeItems.length > 1 && (
                    <div className={styles.inlineActions}>
                      <button
                        type="button"
                        className={styles.linkBtn}
                        onClick={() => {
                          const next = {};
                          for (const it of activeItems) next[it.id] = Math.max(1, Number(it.qty || 1));
                          setSelectedItems(next);
                        }}
                      >
                        Selectează toate
                      </button>
                      {selectedCount > 0 && (
                        <button type="button" className={styles.linkBtn} onClick={() => setSelectedItems({})}>
                          Deselectează
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {activeItems.length === 0 ? (
                  <div className={styles.notice}>Nu am găsit produse pentru acest colet.</div>
                ) : (
                  <div className={styles.items}>
                    {activeItems.map((it) => {
                      const checked = selectedItems[it.id] != null;
                      const maxQty = Number(it.qty || 1);
                      const personalized = it.returnPersonalization === PERSONALIZATION.PERSONALIZED;

                      return (
                        <div key={it.id} className={`${styles.itemRow} ${checked ? styles.itemRowChecked : ""}`}>
                          <label className={styles.itemLeft}>
                            <input
                              type="checkbox"
                              className={styles.checkbox}
                              checked={checked}
                              onChange={(e) => toggleItem(it, e.target.checked)}
                            />
                            <img
                              src={it.image || "/placeholder.png"}
                              alt=""
                              className={styles.thumb}
                              loading="lazy"
                            />
                            <span className={styles.itemText}>
                              <span className={styles.itemTitle}>{it.title}</span>
                              <span className={styles.subtle}>Cumpărat: {maxQty} buc.</span>
                              {personalized && <span className={styles.tag}>Personalizat pentru tine</span>}
                            </span>
                          </label>

                          {maxQty > 1 && (
                            <label className={styles.qtyWrap}>
                              <span className={styles.subtle}>Cantitate</span>
                              <input
                                className={styles.qty}
                                type="number"
                                min={1}
                                max={maxQty}
                                value={checked ? selectedItems[it.id] : 1}
                                disabled={!checked}
                                onChange={(e) => changeQty(it.id, e.target.value, maxQty)}
                              />
                            </label>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              {isPersonalized && (
                <div className={`${styles.notice} ${styles.noticePersonalized}`}>
                  <strong className={styles.noticeTitle}>Produs realizat după specificațiile tale</strong>
                  {PERSONALIZED_WITHDRAWAL_MESSAGE}
                </div>
              )}

              {/* Motiv + soluție */}
              <section className={styles.section}>
                <h3 className={styles.sectionTitle}>Detalii</h3>

                <div className={styles.grid2}>
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor="return-reason">
                      Motiv
                    </label>
                    <select
                      id="return-reason"
                      className={styles.select}
                      value={reasonCode}
                      onChange={(e) => setReasonCode(e.target.value)}
                    >
                      {[
                        {
                          kind: "WITHDRAWAL",
                          label: `Retragere fără motiv (${returnWindowDays} zile de la livrare)`,
                        },
                        { kind: "CONFORMITY", label: "Problemă cu produsul / neconformitate" },
                      ].map((group) => {
                        const list = reasons.filter((r) => r.kind === group.kind);
                        if (!list.length) return null;

                        return (
                          <optgroup key={group.kind} label={group.label}>
                            {list.map((r) => (
                              <option key={r.code} value={r.code}>
                                {r.label}
                              </option>
                            ))}
                          </optgroup>
                        );
                      })}
                    </select>
                  </div>

                  <div className={styles.field}>
                    <label className={styles.label} htmlFor="return-resolution">
                      Soluție dorită
                    </label>
                    <select
                      id="return-resolution"
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

                {personalization === PERSONALIZATION.UNCLEAR && isWithdrawalReason(reasonCode) && (
                  <div className={styles.hint}>
                    Pentru unul dintre produse nu putem stabili automat dacă a fost realizat după specificațiile tale.
                    Cererea ta nu este respinsă: o verificăm împreună cu vânzătorul.
                  </div>
                )}

                {needsReasonText && (
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor="return-reason-text">
                      Descrie motivul
                    </label>
                    <input
                      id="return-reason-text"
                      className={styles.input}
                      value={reasonText}
                      onChange={(e) => setReasonText(e.target.value)}
                      placeholder="Scrie pe scurt motivul…"
                      maxLength={2000}
                    />
                  </div>
                )}

                <div className={styles.field}>
                  <label className={styles.label} htmlFor="return-notes">
                    Observații <span className={styles.optional}>(opțional)</span>
                  </label>
                  <textarea
                    id="return-notes"
                    className={styles.textarea}
                    rows={4}
                    value={notesUser}
                    onChange={(e) => setNotesUser(e.target.value)}
                    placeholder="Ex: are o zgârietură pe lateral, lipsește un accesoriu…"
                    maxLength={2000}
                  />
                </div>
              </section>

              {/* Poze */}
              <section className={styles.section}>
                <div className={styles.sectionHead}>
                  <h3 className={styles.sectionTitle}>
                    Fotografii{" "}
                    <span className={styles.optional}>{needsEvidence ? "(obligatoriu pentru acest motiv)" : "(recomandat)"}</span>
                  </h3>
                  <span className={styles.subtle}>
                    {photoUrls.length}/{MAX_PHOTOS}
                  </span>
                </div>

                {photoUrls.length < MAX_PHOTOS && (
                  <div
                    className={`${styles.dropzone} ${dragOver ? styles.dropzoneActive : ""} ${
                      uploading ? styles.dropzoneBusy : ""
                    }`}
                    role="button"
                    tabIndex={0}
                    onClick={() => !uploading && fileInputRef.current?.click()}
                    onKeyDown={(e) => {
                      if ((e.key === "Enter" || e.key === " ") && !uploading) {
                        e.preventDefault();
                        fileInputRef.current?.click();
                      }
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOver(true);
                    }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={onDrop}
                  >
                    <span className={styles.dropIcon} aria-hidden="true">
                      ⤒
                    </span>
                    <span className={styles.dropTitle}>
                      {uploading ? "Se încarcă…" : "Adaugă fotografii"}
                    </span>
                    <span className={styles.subtle}>Trage aici sau apasă pentru a alege · PNG, JPG, WebP · max 3 MB</span>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      multiple
                      onChange={onPickPhotos}
                      disabled={uploading}
                      className={styles.fileInput}
                      tabIndex={-1}
                    />
                  </div>
                )}

                {needsEvidence && photoUrls.length === 0 && (
                  <div className={styles.hint}>Pentru acest motiv adaugă cel puțin o fotografie.</div>
                )}

                {photoUrls.length > 0 && (
                  <div className={styles.photos}>
                    {photoUrls.map((u) => (
                      <div key={u} className={styles.photo}>
                        <img src={u} alt="Fotografie retur" />
                        <button
                          type="button"
                          className={styles.photoRemove}
                          onClick={() => removePhoto(u)}
                          aria-label="Șterge fotografia"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Politica de retur (documentul legal activ) */}
              <label className={styles.policy}>
                <input
                  type="checkbox"
                  className={styles.checkbox}
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
                    Politica de retur Artfest
                  </a>
                  .
                </span>
              </label>

              {err && <div className={styles.error}>{err}</div>}
            </div>

            <footer className={styles.footer}>
              <button type="button" className={styles.btnGhost} onClick={onClose} disabled={loading}>
                Anulează
              </button>
              <button
                type="button"
                className={styles.btnPrimary}
                onClick={submit}
                disabled={!canSubmit || loading || uploading}
                title={
                  !canSubmit
                    ? needsEvidence && photoUrls.length === 0
                      ? "Adaugă cel puțin o fotografie și acceptă Politica de retur"
                      : "Selectează produsele și acceptă Politica de retur"
                    : undefined
                }
              >
                {loading ? "Se trimite…" : "Trimite cererea de retur"}
              </button>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
