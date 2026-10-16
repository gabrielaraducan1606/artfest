// src/pages/Admin/AdminDesktop/tabs/AdminFairReceptionPanel.jsx
//
// Admin -> Târg Artfest -> Recepție produse.
// Scanerul USB 1D se comportă ca o tastatură: tastează codul + Enter în
// câmpul de scanare (focus automat). Recepția e trimisă cu Idempotency-Key,
// deci dublu click / Enter dublu / retry de rețea nu dublează nimic.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../../../lib/api";
import shared from "../AdminDesktop.module.css";
import styles from "./AdminFairReception.module.css";
import FairCameraScanner from "./FairCameraScanner.jsx";
import { downloadLabelsPdf } from "../../../Vendor/Fair/fairInventory.js";

const API = "/api/admin/artfest-fair/inventory";

// linie a unei participări anulate (același text ca pe server)
const RETURN_ONLY_TEXT = "Produs primit doar pentru retur – nu este disponibil pentru vânzare.";

const FILTERS = [
  { id: "all", label: "Toate" },
  { id: "to_receive", label: "De recepționat" },
  { id: "received", label: "Recepționate" },
  { id: "discrepancy", label: "Cu diferențe" },
  { id: "rejected", label: "Refuzate" },
  { id: "blocked", label: "Blocate de la vânzare" },
];

const STATUS_LABEL = {
  DRAFT: "Netrimis",
  SUBMITTED: "De recepționat",
  RECEIVED: "Recepționat",
  REJECTED: "Refuzat",
  CANCELLED: "Anulat",
  CLOSED: "Închis",
};

const MOVEMENT_LABEL = {
  RECEIVED: "Primit",
  REJECTED: "Refuzat la recepție",
  DAMAGED: "Deteriorat în stoc",
  LOST: "Lipsă",
  SOLD: "Vândut",
  SALE_REVERSED: "Vânzare anulată",
  RETURNED_TO_VENDOR: "Returnat vendorului",
  REJECTED_RETURNED_TO_VENDOR: "Refuzat, returnat vendorului",
  DAMAGED_RETURNED_TO_VENDOR: "Deteriorat, returnat vendorului",
  ADJUSTMENT_IN: "Corecție +",
  ADJUSTMENT_OUT: "Corecție −",
};

function newKey() {
  try {
    return crypto.randomUUID();
  } catch {
    return `k-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

function formatPrice(priceCents) {
  const value = Number(priceCents || 0) / 100;
  return `${Number.isInteger(value) ? value : value.toFixed(2).replace(".", ",")} lei`;
}

function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("ro-RO", { timeZone: "Europe/Bucharest" });
}

function differenceText(declared, received, rejected) {
  const delta = (Number(received) || 0) + (Number(rejected) || 0) - (Number(declared) || 0);
  if (!delta) return null;
  const n = Math.abs(delta);
  if (delta < 0) return n === 1 ? "Lipsește 1 bucată" : `Lipsesc ${n} bucăți`;
  return n === 1 ? "+1 bucată față de cantitatea declarată" : `+${n} bucăți față de cantitatea declarată`;
}

function errorMessage(err, fallback) {
  return err?.data?.message || err?.message || fallback;
}

/* ===================== Fotografii ===================== */

function PhotoPicker({ urls, onChange, disabled }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  async function onFiles(event) {
    const files = [...(event.target.files || [])];
    event.target.value = "";
    if (!files.length) return;
    setUploading(true);
    setError("");
    try {
      const form = new FormData();
      for (const file of files.slice(0, 6)) form.append("files", file);
      const res = await api(`${API}/photos`, { method: "POST", body: form });
      onChange([...urls, ...(res?.urls || [])].slice(0, 10));
    } catch (err) {
      setError(errorMessage(err, "Nu am putut încărca fotografiile."));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className={styles.photos}>
      {urls.map((url) => (
        <span key={url} className={styles.photo}>
          <img src={url} alt="" />
          <button type="button" onClick={() => onChange(urls.filter((u) => u !== url))} aria-label="Elimină fotografia" disabled={disabled}>
            ×
          </button>
        </span>
      ))}
      <label className={styles.photoAdd}>
        <input type="file" accept="image/*" multiple onChange={onFiles} disabled={disabled || uploading} />
        {uploading ? "Se încarcă…" : "+ Fotografii"}
      </label>
      {error && <span className={styles.fieldError}>{error}</span>}
    </div>
  );
}

/* ===================== Formular recepție ===================== */

function ReceiveForm({ item, onDone, onError }) {
  const [receivedQty, setReceivedQty] = useState(String(item.declaredQty));
  const [rejectedQty, setRejectedQty] = useState("0");
  const [rejectedReason, setRejectedReason] = useState("");
  const [adminNotes, setAdminNotes] = useState("");
  const [photoUrls, setPhotoUrls] = useState([]);
  const [fieldErrors, setFieldErrors] = useState({});
  const [saving, setSaving] = useState(false);
  // o cheie per operație: retrimiterile (dublu click, retry) folosesc aceeași cheie
  const keyRef = useRef(newKey());

  const diff = differenceText(item.declaredQty, receivedQty, rejectedQty);
  const needsReason = Number(rejectedQty) > 0;

  async function onSubmit(event) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setFieldErrors({});
    try {
      const res = await api(`${API}/${encodeURIComponent(item.id)}/receive`, {
        method: "POST",
        headers: { "Idempotency-Key": keyRef.current },
        body: {
          receivedQty: Number(receivedQty),
          rejectedQty: Number(rejectedQty),
          rejectedReason: needsReason ? rejectedReason : undefined,
          adminNotes,
          photoUrls,
        },
      });
      onDone(
        res.item,
        res.replayed
          ? "Recepția era deja înregistrată."
          : res.returnOnly
            ? `Recepție înregistrată. ${RETURN_ONLY_TEXT}`
            : "Recepție înregistrată."
      );
    } catch (err) {
      setFieldErrors(err?.data?.fields || {});
      onError(errorMessage(err, "Recepția nu a reușit."), err?.data?.item);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate>
      <div className={styles.formGrid}>
        <label className={styles.field}>
          <span>Primite (intră în stoc)</span>
          <input type="number" min={0} step={1} inputMode="numeric" value={receivedQty} onChange={(e) => setReceivedQty(e.target.value)} />
          {fieldErrors.receivedQty && <span className={styles.fieldError}>{fieldErrors.receivedQty}</span>}
        </label>
        <label className={styles.field}>
          <span>Refuzate la recepție</span>
          <input type="number" min={0} step={1} inputMode="numeric" value={rejectedQty} onChange={(e) => setRejectedQty(e.target.value)} />
        </label>
      </div>

      {diff && (
        <p className={styles.diffWarning} role="status">
          ⚠ {diff}. Diferența va fi înregistrată.
        </p>
      )}

      {needsReason && (
        <label className={styles.field}>
          <span>Motivul refuzului (obligatoriu, vizibil vendorului)</span>
          <input value={rejectedReason} onChange={(e) => setRejectedReason(e.target.value)} placeholder="ex.: ambalaj deteriorat" maxLength={500} />
          {fieldErrors.rejectedReason && <span className={styles.fieldError}>{fieldErrors.rejectedReason}</span>}
        </label>
      )}

      <label className={styles.field}>
        <span>Notițe interne (opțional)</span>
        <textarea rows={2} value={adminNotes} onChange={(e) => setAdminNotes(e.target.value)} maxLength={2000} />
      </label>

      <div className={styles.field}>
        <span>Fotografii (deteriorări / neconformități)</span>
        <PhotoPicker urls={photoUrls} onChange={setPhotoUrls} disabled={saving} />
      </div>

      <div className={styles.formActions}>
        <button type="submit" className={styles.primaryBtn} disabled={saving}>
          {saving ? "Se înregistrează…" : item.returnOnly ? "Recepționează doar pentru retur" : "Confirmă recepția"}
        </button>
      </div>
    </form>
  );
}

/* ===================== Acțiuni după recepție ===================== */

function DamageForm({ item, onDone, onError, onCancel }) {
  const [quantity, setQuantity] = useState("1");
  const [reason, setReason] = useState("");
  const [photoUrls, setPhotoUrls] = useState([]);
  const [saving, setSaving] = useState(false);
  const keyRef = useRef(newKey());

  async function onSubmit(event) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const res = await api(`${API}/${encodeURIComponent(item.id)}/damage`, {
        method: "POST",
        headers: { "Idempotency-Key": keyRef.current },
        body: { quantity: Number(quantity), reason, photoUrls },
      });
      onDone(res.item, "Deteriorare înregistrată.");
    } catch (err) {
      onError(errorMessage(err, "Nu am putut înregistra deteriorarea."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className={styles.subForm} onSubmit={onSubmit} noValidate>
      <strong>Marchează bucăți deteriorate (după intrarea în stoc)</strong>
      <div className={styles.formGrid}>
        <label className={styles.field}>
          <span>Cantitate (din {item.availableQty} disponibile)</span>
          <input type="number" min={1} max={item.availableQty} step={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </label>
        <label className={styles.field}>
          <span>Motiv (obligatoriu)</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </label>
      </div>
      <PhotoPicker urls={photoUrls} onChange={setPhotoUrls} disabled={saving} />
      <div className={styles.formActions}>
        <button type="button" className={styles.ghostBtn} onClick={onCancel} disabled={saving}>
          Renunță
        </button>
        <button type="submit" className={styles.dangerBtn} disabled={saving}>
          {saving ? "Se înregistrează…" : "Marchează deteriorat"}
        </button>
      </div>
    </form>
  );
}

function ItemCard({ item, onUpdated, onError }) {
  const [mode, setMode] = useState(null); // "damage" | "block" | "cancel"
  const [reason, setReason] = useState("");
  // anulare linie în tranzit: coletul pierdut => stocul NU revine online
  const [lostInTransit, setLostInTransit] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setMode(null);
    setReason("");
    setLostInTransit(false);
  }, [item.id]);

  async function post(path, body, success) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await api(`${API}/${encodeURIComponent(item.id)}/${path}`, { method: "POST", body });
      onUpdated(res.item, success);
      setMode(null);
      setReason("");
    } catch (err) {
      onError(errorMessage(err, "Acțiunea nu a reușit."));
    } finally {
      setBusy(false);
    }
  }

  // etichete: același generator (PDF) ca la vendor; după generare, starea etichetei se reîncarcă
  async function labelAction(path, filename, success) {
    if (busy) return;
    setBusy(true);
    try {
      await downloadLabelsPdf(path, filename);
      const res = await api(`${API}/${encodeURIComponent(item.id)}`);
      onUpdated(res.item, success);
    } catch (err) {
      onError(errorMessage(err, "Nu am putut genera etichetele."));
    } finally {
      setBusy(false);
    }
  }

  const received = item.status === "RECEIVED" || item.status === "REJECTED";

  return (
    <section className={styles.card} aria-label={`Produs ${item.barcodeDisplay}`}>
      <div className={styles.cardTop}>
        {item.imageUrl ? <img className={styles.image} src={item.imageUrl} alt="" /> : <span className={styles.image} />}
        <div className={styles.cardText}>
          <div className={styles.titleRow}>
            <h3>{item.title}</h3>
            <span className={`${styles.badge} ${styles[`status_${item.status}`] || ""}`}>{STATUS_LABEL[item.status] || item.status}</span>
            {item.returnOnly ? (
              <span className={`${styles.badge} ${styles.status_REJECTED}`}>Doar pentru retur</span>
            ) : (
              item.saleBlocked && <span className={`${styles.badge} ${styles.status_REJECTED}`}>Blocat de la vânzare</span>
            )}
          </div>
          {item.variantLabel && <p className={styles.muted}>{item.variantLabel}</p>}
          <dl className={styles.facts}>
            <div><dt>Vendor</dt><dd>{item.vendor?.name || "—"}{item.storeName ? ` · ${item.storeName}` : ""}</dd></div>
            <div><dt>Declarat</dt><dd>{item.declaredQty}</dd></div>
            <div><dt>Preț</dt><dd>{formatPrice(item.priceCents)}</dd></div>
            <div><dt>Cod</dt><dd className={styles.code}>{item.barcodeDisplay}</dd></div>
            {received && (
              <>
                <div><dt>Primit</dt><dd>{item.receivedQty}</dd></div>
                <div><dt>Refuzat</dt><dd>{item.rejectedQty}</dd></div>
                <div><dt>Deteriorat</dt><dd>{item.damagedQty}{item.damagedReturnedQty ? ` (returnat ${item.damagedReturnedQty})` : ""}</dd></div>
                <div><dt>Disponibil</dt><dd>{item.availableQty}</dd></div>
                <div><dt>Recepționat la</dt><dd>{formatDate(item.receivedAt)}</dd></div>
              </>
            )}
          </dl>
          {item.difference?.text && <p className={styles.diffWarning}>⚠ {item.difference.text}</p>}
          {!item.belongsToActiveFair && <p className={styles.errorText}>Produsul nu aparține târgului activ.</p>}
          {item.returnOnly && (
            <p className={styles.errorText} role="status">
              {item.status === "SUBMITTED"
                ? "Participarea vendorului a fost anulată. La sosire, produsul se recepționează doar pentru retur."
                : RETURN_ONLY_TEXT}
            </p>
          )}
        </div>
      </div>

      {item.warnings?.length > 0 && (
        <ul className={styles.warnings}>
          {item.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      {item.actions?.canReceive && item.belongsToActiveFair && (
        <ReceiveForm key={item.id} item={item} onDone={onUpdated} onError={onError} />
      )}

      {received && (
        <div className={styles.actions}>
          {item.actions.canMarkDamaged && (
            <button type="button" className={styles.ghostBtn} onClick={() => setMode("damage")} disabled={busy}>
              Marchează deteriorat
            </button>
          )}
          {item.actions.canBlock && (
            <button
              type="button"
              className={styles.ghostBtn}
              onClick={() => {
                setMode("block");
                setReason(item.eligibility?.eligible === false ? "Produsul nu mai este eligibil pe Artfest." : "");
              }}
              disabled={busy}
            >
              Blochează de la vânzare
            </button>
          )}
          {item.actions.canUnblock && (
            <button type="button" className={styles.ghostBtn} onClick={() => post("unblock", {}, "Produsul a fost deblocat.")} disabled={busy}>
              Deblochează
            </button>
          )}
        </div>
      )}

      {item.actions?.canPrintLabel && (
        <div className={styles.actions}>
          {item.label?.state === "outdated" && <span className={styles.errorText}>Eticheta are un preț vechi - regenereaz-o.</span>}
          <button
            type="button"
            className={styles.ghostBtn}
            disabled={busy}
            onClick={() =>
              labelAction(
                `${API}/${encodeURIComponent(item.id)}/label.pdf`,
                `eticheta-${item.barcode}.pdf`,
                item.label?.state === "outdated" ? "Eticheta a fost regenerată." : "Eticheta a fost generată."
              )
            }
          >
            Generează eticheta
          </button>
          <button
            type="button"
            className={styles.ghostBtn}
            disabled={busy}
            onClick={() =>
              labelAction(
                `${API}/labels.pdf?vendorId=${encodeURIComponent(item.vendor?.id || "")}`,
                "etichete-vendor-targ-artfest.pdf",
                `Etichetele vendorului ${item.vendor?.name || ""} au fost generate.`
              )
            }
          >
            Etichete vendor
          </button>
        </div>
      )}

      {item.actions?.canCancel && mode !== "cancel" && (
        <div className={styles.actions}>
          <button type="button" className={styles.dangerGhostBtn} onClick={() => setMode("cancel")} disabled={busy}>
            Anulează linia (eliberează stocul online)
          </button>
        </div>
      )}

      {mode === "damage" && (
        <DamageForm item={item} onDone={(next, msg) => { onUpdated(next, msg); setMode(null); }} onError={onError} onCancel={() => setMode(null)} />
      )}

      {(mode === "block" || mode === "cancel") && (
        <form
          className={styles.subForm}
          onSubmit={(e) => {
            e.preventDefault();
            if (mode === "block") post("block", { reason }, "Produsul a fost blocat de la vânzare.");
            else
              post(
                "cancel",
                { reason, releaseOnline: !lostInTransit },
                lostInTransit
                  ? "Linia a fost anulată; stocul online NU a fost readăugat (colet pierdut)."
                  : "Linia a fost anulată, iar stocul online a fost eliberat."
              );
          }}
        >
          <label className={styles.field}>
            <span>{mode === "block" ? "Motivul blocării (obligatoriu)" : "Motivul anulării (opțional)"}</span>
            <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} autoFocus />
          </label>
          {mode === "cancel" && (
            <label className={styles.checkboxRow}>
              <input type="checkbox" checked={lostInTransit} onChange={(e) => setLostInTransit(e.target.checked)} />
              <span>Coletul s-a pierdut pe drum (stocul NU revine online)</span>
            </label>
          )}
          <div className={styles.formActions}>
            <button type="button" className={styles.ghostBtn} onClick={() => setMode(null)} disabled={busy}>
              Renunță
            </button>
            <button type="submit" className={styles.dangerBtn} disabled={busy}>
              {mode === "block" ? "Blochează" : "Anulează linia"}
            </button>
          </div>
        </form>
      )}

      {item.movements?.length > 0 && (
        <div className={styles.history}>
          <strong>Istoric stoc</strong>
          <ul>
            {item.movements.map((m) => (
              <li key={m.id}>
                <span>{formatDate(m.createdAt)}</span> · {MOVEMENT_LABEL[m.type] || m.type}: {m.quantity}
                {m.reason ? ` — ${m.reason}` : ""}
                {m.photoUrls?.length > 0 && (
                  <span className={styles.historyPhotos}>
                    {m.photoUrls.map((url) => (
                      <a key={url} href={url} target="_blank" rel="noreferrer">
                        <img src={url} alt="" />
                      </a>
                    ))}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/* ===================== Panou ===================== */

export default function AdminFairReceptionPanel() {
  const [code, setCode] = useState("");
  const [current, setCurrent] = useState(null);
  const [scanError, setScanError] = useState("");
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState("to_receive");
  const [search, setSearch] = useState("");
  const [list, setList] = useState({ items: [], counts: {} });
  const [loadingList, setLoadingList] = useState(true);
  const scanRef = useRef(null);

  const focusScan = useCallback(() => {
    requestAnimationFrame(() => scanRef.current?.focus());
  }, []);

  const loadList = useCallback(async () => {
    setLoadingList(true);
    try {
      const params = new URLSearchParams({ filter });
      if (search.trim()) params.set("q", search.trim());
      setList(await api(`${API}?${params.toString()}`));
    } catch (err) {
      setScanError(errorMessage(err, "Nu am putut încărca inventarul."));
    } finally {
      setLoadingList(false);
    }
  }, [filter, search]);

  useEffect(() => {
    const t = setTimeout(loadList, 250);
    return () => clearTimeout(t);
  }, [loadList]);

  useEffect(() => {
    focusScan();
  }, [focusScan]);

  async function lookup(raw) {
    const value = String(raw || "").trim();
    if (!value) return;
    setScanError("");
    setNotice("");
    try {
      const res = await api(`${API}/by-barcode/${encodeURIComponent(value)}`);
      setCurrent(res.item);
    } catch (err) {
      setCurrent(err?.data?.item || null);
      setScanError(errorMessage(err, "Codul nu a fost găsit."));
    } finally {
      setCode("");
      focusScan();
    }
  }

  // camera telefonului: QR -> același cod AF -> EXACT același lookup ca scannerul USB
  const [cameraOpen, setCameraOpen] = useState(false);
  const [allLabelsBusy, setAllLabelsBusy] = useState(false);
  const lookupRef = useRef(lookup);
  lookupRef.current = lookup;
  const onCameraCode = useCallback((value) => {
    setCameraOpen(false);
    lookupRef.current(value);
  }, []);
  const cameraSupported = typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);

  async function open(id) {
    setScanError("");
    setNotice("");
    try {
      const res = await api(`${API}/${encodeURIComponent(id)}`);
      setCurrent(res.item);
    } catch (err) {
      setScanError(errorMessage(err, "Nu am putut încărca produsul."));
    }
  }

  function onUpdated(item, message) {
    if (item) setCurrent(item);
    setScanError("");
    setNotice(message || "");
    loadList();
    focusScan();
  }

  function onError(message, item) {
    if (item) setCurrent(item);
    setNotice("");
    setScanError(message);
  }

  const counts = list.counts || {};
  const rows = useMemo(() => list.items || [], [list.items]);

  return (
    <div className={styles.panel}>
      <form
        className={styles.scanBar}
        onSubmit={(e) => {
          e.preventDefault();
          lookup(code);
        }}
      >
        <label htmlFor="fair-scan" className={styles.scanLabel}>
          Scanează codul de bare
        </label>
        <div className={styles.scanRow}>
          <input
            id="fair-scan"
            ref={scanRef}
            className={styles.scanInput}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Scanează sau tastează codul AF și apasă Enter"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="characters"
            spellCheck={false}
            inputMode="text"
          />
          <button type="submit" className={styles.primaryBtn}>
            Caută
          </button>
        </div>
        <button
          type="button"
          className={styles.ghostBtn}
          disabled={allLabelsBusy}
          onClick={async () => {
            setAllLabelsBusy(true);
            setScanError("");
            try {
              await downloadLabelsPdf(`${API}/labels.pdf`, "etichete-targ-artfest.pdf");
              setNotice("Etichetele târgului au fost generate (A4, 3 × 8, câte una pe bucată).");
              loadList();
            } catch (err) {
              setScanError(errorMessage(err, "Nu am putut genera etichetele."));
            } finally {
              setAllLabelsBusy(false);
            }
          }}
        >
          {allLabelsBusy ? "Se generează…" : "Toate etichetele târgului"}
        </button>
        {cameraSupported && (
          <button
            type="button"
            className={styles.cameraBtn}
            onClick={() => {
              setScanError("");
              setNotice("");
              setCameraOpen(true);
            }}
          >
            Scanează cu camera
          </button>
        )}
      </form>
      {cameraOpen && <FairCameraScanner onCode={onCameraCode} onClose={() => { setCameraOpen(false); focusScan(); }} />}

      {notice && (
        <div className={styles.notice} role="status">
          {notice}
        </div>
      )}
      {scanError && (
        <div className={shared.error} role="alert">
          {scanError}
        </div>
      )}

      {current && <ItemCard item={current} onUpdated={onUpdated} onError={onError} />}

      <div className={styles.filters} role="tablist" aria-label="Filtre inventar">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={filter === f.id}
            className={`${styles.filter} ${filter === f.id ? styles.filterActive : ""}`}
            onClick={() => setFilter(f.id)}
          >
            {f.label} <span>{counts[f.id] ?? 0}</span>
          </button>
        ))}
        <input
          className={styles.search}
          placeholder="Caută produs, vendor sau cod"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Caută în inventar"
        />
      </div>

      {rows.length === 0 ? (
        <p className={shared.subtle}>{loadingList ? "Se încarcă…" : "Nu există produse pentru acest filtru."}</p>
      ) : (
        <div className={shared.tableWrapper}>
          <table className={shared.table}>
            <thead>
              <tr>
                <th>Produs</th>
                <th>Vendor</th>
                <th>Cod</th>
                <th>Declarat</th>
                <th>Primit</th>
                <th>Refuzat</th>
                <th>Diferență</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className={styles.row} onClick={() => open(row.id)}>
                  <td>
                    <button
                      type="button"
                      className={styles.linkBtn}
                      onClick={(e) => {
                        e.stopPropagation();
                        open(row.id);
                      }}
                    >
                      {row.title}
                    </button>
                    {row.variantLabel && <div className={styles.muted}>{row.variantLabel}</div>}
                  </td>
                  <td>{row.vendor?.name || "—"}</td>
                  <td className={styles.code}>{row.barcodeDisplay}</td>
                  <td>{row.declaredQty}</td>
                  <td>{row.status === "SUBMITTED" ? "—" : row.receivedQty}</td>
                  <td>{row.status === "SUBMITTED" ? "—" : row.rejectedQty}</td>
                  <td>{row.difference?.text || "—"}</td>
                  <td>
                    {STATUS_LABEL[row.status] || row.status}
                    {row.returnOnly ? " · doar retur" : row.saleBlocked ? " · blocat" : ""}
                    {row.eligibility?.eligible === false ? " · neeligibil" : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
