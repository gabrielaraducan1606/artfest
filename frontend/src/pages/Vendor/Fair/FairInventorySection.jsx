// src/pages/Vendor/Fair/FairInventorySection.jsx
//
// „Inventarul meu pentru târg” - pentru înscrierile APPROVED.
// Vendorul adaugă produsele (cu variantă), le trimite (stocul online se
// rezervă la trimitere). Etichetele cu cod de bare le generează, imprimă și
// aplică Artfest la recepție (Admin -> Târg -> Etichete); vendorul nu are acțiuni
// pentru etichete. Codul, prețul și cantitățile vin exclusiv de la server.
// După anularea participării (CANCELLED) inventarul rămâne vizibil, DOAR
// pentru citire: situația fiecărui produs și starea rezervării online.

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, BadgeCheck, Package, Pencil, Plus, Send, Tag, Trash2, X } from "lucide-react";
import { api } from "../../../lib/api";
import {
  INVENTORY_API,
  INVENTORY_STATUS_LABEL,
  INVENTORY_STATUS_TONE,
  formatDateTime,
  formatPrice,
} from "./fairInventory.js";
import { SITUATION_LABEL, SITUATION_TONE, onlineStateText } from "./fairReturns.js";
import styles from "./FairInventory.module.css";

const EMPTY_FORM = {
  productId: "",
  selectedOptions: {},
  declaredQty: "1",
  isFragile: false,
  isUnique: false,
  isLimitedEdition: false,
  canBeRemade: false,
  handlingInstructions: "",
  vendorNotes: "",
};

function errorMessage(err, fallback) {
  return err?.data?.message || err?.message || fallback;
}

/* ===================== Mesajele de rezervare online ===================== */

function OnlineReservation({ item }) {
  const { online } = item;

  if (online.forcedUnavailable) {
    return (
      <p className={styles.reserved}>
        Produsul este rezervat pentru Târgul Artfest și nu poate fi cumpărat online momentan.
      </p>
    );
  }

  if (online.mode === "TRANSFERRED") {
    return (
      <p className={styles.reserved}>
        <strong>{online.reservedQty} bucăți rezervate pentru Târgul Artfest</strong>
        {online.onlineAvailableQty !== null && <span> · Stoc online disponibil: {online.onlineAvailableQty}</span>}
      </p>
    );
  }

  if (item.status !== "DRAFT") return null;

  // înainte de trimitere: ce se va întâmpla cu stocul online
  if (item.isUnique) {
    return (
      <p className={styles.hint}>La trimitere, produsul devine indisponibil online cât timp este la târg.</p>
    );
  }
  if (online.productAvailability === "READY" && online.onlineAvailableQty !== null) {
    const short = online.onlineAvailableQty < item.declaredQty;
    return (
      <p className={short ? styles.warning : styles.hint}>
        La trimitere se rezervă {item.declaredQty} bucăți din stocul online (disponibil acum: {online.onlineAvailableQty}).
        {short && " Mărește stocul produsului sau scade cantitatea."}
      </p>
    );
  }
  return null;
}

// după anulare: unde e fiecare bucată și ce s-a întâmplat cu stocul online
function PhysicalState({ item }) {
  const p = item.physical || {};
  const parts = [];
  if (p.availableQty > 0) parts.push(`La Artfest: ${p.availableQty}`);
  if (p.rejectedPendingReturnQty > 0) parts.push(`Refuzate, de returnat: ${p.rejectedPendingReturnQty}`);
  if (p.damagedPendingReturnQty > 0) parts.push(`Deteriorate, de returnat: ${p.damagedPendingReturnQty}`);
  if (p.returnInProgressQty > 0) parts.push(`În retur către tine: ${p.returnInProgressQty}`);
  if (p.returnedQty > 0) parts.push(`Returnate: ${p.returnedQty}`);
  return (
    <>
      {parts.length > 0 && <p className={styles.muted}>{parts.join(" · ")}</p>}
      <p className={item.online?.state === "reserved" ? styles.reserved : styles.hint}>{onlineStateText(item.online)}</p>
    </>
  );
}

// rezultatul recepției Artfest - doar citire pentru vendor
function ReceptionResult({ reception }) {
  if (!reception) return null;
  const photos = [...reception.rejections, ...reception.damages].flatMap((r) => r.photoUrls || []);

  return (
    <div className={styles.reception}>
      <dl className={styles.receptionStats}>
        <div>
          <dt>Declarat</dt>
          <dd>{reception.declaredQty}</dd>
        </div>
        <div>
          <dt>Primit</dt>
          <dd>{reception.receivedQty}</dd>
        </div>
        <div>
          <dt>Refuzat</dt>
          <dd>{reception.rejectedQty}</dd>
        </div>
        <div>
          <dt>Deteriorat</dt>
          <dd>{reception.damagedQty}</dd>
        </div>
        {reception.difference !== 0 && (
          <div>
            <dt>Diferență</dt>
            <dd>{reception.difference > 0 ? `+${reception.difference}` : reception.difference}</dd>
          </div>
        )}
      </dl>
      <ul className={styles.receptionMessages}>
        {reception.messages.map((message) => (
          <li key={message}>{message}</li>
        ))}
      </ul>
      {photos.length > 0 && (
        <div className={styles.receptionPhotos}>
          {photos.map((url) => (
            <a key={url} href={url} target="_blank" rel="noreferrer">
              <img src={url} alt="Fotografie de la recepție" />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

// etichetele sunt ale Artfest; vendorul vede doar dacă prețul de târg trebuie actualizat
function PriceSyncState({ item }) {
  if (!item.priceOutOfSync) return null;
  return (
    <p className={styles.warning}>
      <AlertTriangle size={14} aria-hidden="true" /> Prețul s-a schimbat pe Artfest ({formatPrice(item.currentPriceCents)}).
      {item.canSyncPrice ? " Actualizează prețul pentru târg." : ""}
    </p>
  );
}

function LabelingByArtfest() {
  return (
    <aside className={styles.labelingNote} aria-labelledby="fair-labeling-title">
      <BadgeCheck className={styles.labelingIcon} size={22} aria-hidden="true" />
      <div>
        <h3 id="fair-labeling-title">Etichetarea produselor este asigurată de Artfest.</h3>
        <p>
          Nu trebuie să imprimi sau să aplici etichete cu coduri de bare. Echipa Artfest se ocupă de generarea și
          aplicarea acestora la recepția produselor.
        </p>
        <p>
          Tu trebuie doar să înregistrezi produsele și cantitățile participante. După confirmarea unei vânzări, stocul
          târgului se actualizează automat, iar tu poți urmări produsele vândute și cantitățile rămase.
        </p>
      </div>
    </aside>
  );
}

/* ===================== Modal adăugare / editare ===================== */

function ItemModal({ mode, item, products, onClose, onSaved }) {
  const [form, setForm] = useState(() =>
    item
      ? {
          ...EMPTY_FORM,
          productId: item.productId,
          declaredQty: String(item.declaredQty),
          isFragile: item.isFragile,
          isUnique: item.isUnique,
          isLimitedEdition: item.isLimitedEdition,
          canBeRemade: item.canBeRemade,
          handlingInstructions: item.handlingInstructions || "",
          vendorNotes: item.vendorNotes || "",
        }
      : EMPTY_FORM
  );
  const [query, setQuery] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const product = useMemo(() => products?.find((p) => p.id === form.productId) || null, [products, form.productId]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = products || [];
    return q ? list.filter((p) => p.title.toLowerCase().includes(q)) : list;
  }, [products, query]);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function update(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setFieldErrors((prev) => (prev[field] ? { ...prev, [field]: "" } : prev));
  }

  function chooseProduct(next) {
    setForm((prev) => ({
      ...prev,
      productId: next.id,
      selectedOptions: {},
      isLimitedEdition: next.isLimitedEdition,
    }));
    setFieldErrors({});
  }

  function setUnique(checked) {
    setForm((prev) => ({
      ...prev,
      isUnique: checked,
      declaredQty: checked ? "1" : prev.declaredQty,
      canBeRemade: checked ? false : prev.canBeRemade,
    }));
  }

  async function onSubmit(event) {
    event.preventDefault();
    if (saving) return;
    setError("");

    const body = {
      declaredQty: Number(form.declaredQty),
      isFragile: form.isFragile,
      isUnique: form.isUnique,
      isLimitedEdition: form.isLimitedEdition,
      canBeRemade: form.canBeRemade,
      handlingInstructions: form.handlingInstructions,
      vendorNotes: form.vendorNotes,
    };

    setSaving(true);
    try {
      if (mode === "add") {
        if (!form.productId) {
          setFieldErrors({ productId: "Alege produsul." });
          return;
        }
        await api(INVENTORY_API, {
          method: "POST",
          body: { ...body, productId: form.productId, selectedOptions: form.selectedOptions },
        });
      } else {
        await api(`${INVENTORY_API}/${encodeURIComponent(item.id)}`, { method: "PATCH", body });
      }
      onSaved();
    } catch (err) {
      setFieldErrors(err?.data?.fields || {});
      setError(errorMessage(err, "Nu am putut salva produsul."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.backdrop} onClick={onClose} role="presentation">
      <form
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label={mode === "add" ? "Adaugă produs în inventar" : "Editează produsul"}
        onClick={(e) => e.stopPropagation()}
        onSubmit={onSubmit}
        noValidate
      >
        <div className={styles.modalHead}>
          <h3>{mode === "add" ? "Adaugă produs în inventar" : "Editează produsul"}</h3>
          <button type="button" className={styles.iconBtn} onClick={onClose} aria-label="Închide">
            <X size={18} />
          </button>
        </div>

        <div className={styles.modalBody}>
          {mode === "add" ? (
            <div className={styles.field}>
              <span className={styles.label}>Produs</span>
              {products === null ? (
                <p className={styles.muted}>Se încarcă produsele…</p>
              ) : products.length === 0 ? (
                <p className={styles.muted}>
                  Nu ai produse eligibile. Produsele trebuie să fie active, vizibile, aprobate, cu preț și să nu fie doar
                  la cerere de ofertă.
                </p>
              ) : (
                <>
                  <input
                    className={styles.input}
                    placeholder="Caută după nume"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  <ul className={styles.productList} role="listbox" aria-label="Produse eligibile">
                    {filtered.map((p) => (
                      <li key={p.id}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={form.productId === p.id}
                          className={`${styles.productOption} ${form.productId === p.id ? styles.productOptionActive : ""}`}
                          onClick={() => chooseProduct(p)}
                        >
                          {p.imageUrl ? <img src={p.imageUrl} alt="" /> : <span className={styles.thumbEmpty} />}
                          <span className={styles.productOptionText}>
                            <strong>{p.title}</strong>
                            <small>
                              {formatPrice(p.priceCents)}
                              {p.availability === "READY" && p.readyQty !== null ? ` · stoc online: ${p.readyQty}` : ""}
                            </small>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {fieldErrors.productId && <span className={styles.fieldError}>{fieldErrors.productId}</span>}
            </div>
          ) : (
            <div className={styles.readonlyProduct}>
              <strong>{item.title}</strong>
              {item.variantLabel && <span>{item.variantLabel}</span>}
              <span>{formatPrice(item.priceCents)}</span>
            </div>
          )}

          {mode === "add" &&
            product?.options.map((option) => (
              <label key={option.key} className={styles.field}>
                <span className={styles.label}>
                  {option.label}
                  {option.required ? "" : " (opțional)"}
                </span>
                <select
                  className={styles.input}
                  value={form.selectedOptions[option.key] || ""}
                  onChange={(e) =>
                    update("selectedOptions", { ...form.selectedOptions, [option.key]: e.target.value })
                  }
                  aria-invalid={fieldErrors[option.key] ? "true" : undefined}
                >
                  <option value="">Alege</option>
                  {option.choices.map((choice) => (
                    <option key={choice.value} value={choice.value}>
                      {choice.label}
                    </option>
                  ))}
                </select>
                {fieldErrors[option.key] && <span className={styles.fieldError}>{fieldErrors[option.key]}</span>}
              </label>
            ))}

          <label className={styles.field}>
            <span className={styles.label}>Cantitate trimisă / adusă la târg</span>
            <input
              className={styles.input}
              type="number"
              inputMode="numeric"
              min={1}
              max={1000}
              step={1}
              value={form.declaredQty}
              disabled={form.isUnique}
              onChange={(e) => update("declaredQty", e.target.value)}
              aria-invalid={fieldErrors.declaredQty ? "true" : undefined}
            />
            {fieldErrors.declaredQty && <span className={styles.fieldError}>{fieldErrors.declaredQty}</span>}
          </label>

          <fieldset className={styles.flags}>
            <legend className={styles.label}>Despre produs</legend>
            <label>
              <input type="checkbox" checked={form.isFragile} onChange={(e) => update("isFragile", e.target.checked)} />
              Fragil
            </label>
            <label>
              <input type="checkbox" checked={form.isUnique} onChange={(e) => setUnique(e.target.checked)} />
              Unicat (o singură bucată)
            </label>
            <label>
              <input
                type="checkbox"
                checked={form.isLimitedEdition}
                onChange={(e) => update("isLimitedEdition", e.target.checked)}
              />
              Serie limitată
            </label>
            <label>
              <input
                type="checkbox"
                checked={form.canBeRemade}
                disabled={form.isUnique}
                onChange={(e) => update("canBeRemade", e.target.checked)}
              />
              Poate fi refăcut
            </label>
            {(fieldErrors.canBeRemade || fieldErrors.isUnique) && (
              <span className={styles.fieldError}>{fieldErrors.canBeRemade || fieldErrors.isUnique}</span>
            )}
          </fieldset>

          <label className={styles.field}>
            <span className={styles.label}>Instrucțiuni de manipulare (opțional)</span>
            <textarea
              className={styles.input}
              rows={2}
              maxLength={2000}
              value={form.handlingInstructions}
              onChange={(e) => update("handlingInstructions", e.target.value)}
            />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>Observații pentru echipa Artfest (opțional)</span>
            <textarea
              className={styles.input}
              rows={2}
              maxLength={2000}
              value={form.vendorNotes}
              onChange={(e) => update("vendorNotes", e.target.value)}
            />
          </label>

          {error && (
            <div className={styles.errorBox} role="alert">
              {error}
            </div>
          )}
        </div>

        <div className={styles.modalFoot}>
          <button type="button" className={styles.btnGhost} onClick={onClose} disabled={saving}>
            Renunță
          </button>
          <button type="submit" className={styles.btn} disabled={saving}>
            {saving ? "Se salvează…" : mode === "add" ? "Adaugă în inventar" : "Salvează"}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ===================== Secțiunea ===================== */

export default function FairInventorySection() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [modal, setModal] = useState(null); // { mode: "add" } | { mode: "edit", item }
  const [products, setProducts] = useState(null);
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await api(INVENTORY_API);
      setData(res);
      setError("");
    } catch (err) {
      setError(errorMessage(err, "Nu am putut încărca inventarul."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function openAdd() {
    setModal({ mode: "add" });
    setNotice("");
    if (products === null) {
      try {
        const res = await api(`${INVENTORY_API}/products`);
        setProducts(Array.isArray(res?.items) ? res.items : []);
      } catch (err) {
        setProducts([]);
        setError(errorMessage(err, "Nu am putut încărca produsele."));
      }
    }
  }

  async function run(key, fn, successMessage) {
    if (busy) return;
    setBusy(key);
    setError("");
    setNotice("");
    try {
      await fn();
      if (successMessage) setNotice(successMessage);
      await load();
    } catch (err) {
      setError(errorMessage(err, "Acțiunea nu a reușit."));
      if (err?.status === 409) await load();
    } finally {
      setBusy("");
    }
  }

  const remove = (item) => {
    if (!window.confirm(`Elimini „${item.title}” din inventarul pentru târg?`)) return;
    run(`remove:${item.id}`, () => api(`${INVENTORY_API}/${encodeURIComponent(item.id)}`, { method: "DELETE" }));
  };

  const cancelSubmitted = (item) => {
    const ok = window.confirm(
      `Anulezi „${item.title}” din inventarul trimis pentru târg?\n\n` +
        (item.online.forcedUnavailable
          ? "Produsul redevine disponibil online, ca înainte de trimitere."
          : item.online.reservedQty > 0
            ? `Cele ${item.online.reservedQty} bucăți rezervate revin în stocul tău online.`
            : "Stocul tău online nu se schimbă.") +
        "\nLinia nu mai poate fi recuperată; o poți adăuga din nou ca produs nou."
    );
    if (!ok) return;
    run(
      `cancel:${item.id}`,
      () => api(`${INVENTORY_API}/${encodeURIComponent(item.id)}/cancel`, { method: "POST" }),
      "Produsul a fost anulat din inventar, iar rezervarea online a fost eliberată."
    );
  };

  const syncPrice = (item) =>
    run(
      `sync:${item.id}`,
      () => api(`${INVENTORY_API}/${encodeURIComponent(item.id)}/sync-price`, { method: "POST" }),
      "Prețul pentru târg a fost actualizat."
    );

  const submit = () => {
    const ok = window.confirm(
      "Trimiți inventarul pentru târg?\n\n" +
        "• Bucățile trimise la târg se scad din stocul tău online.\n" +
        "• Produsele unicat devin indisponibile online cât timp sunt la târg.\n" +
        "• După trimitere, cantitățile și variantele nu se mai pot modifica."
    );
    if (!ok) return;
    run("submit", () => api(`${INVENTORY_API}/submit`, { method: "POST" }), "Inventarul a fost trimis.");
  };

  if (loading) {
    return (
      <section className={styles.section}>
        <p className={styles.muted}>Se încarcă inventarul…</p>
      </section>
    );
  }

  if (!data) {
    return (
      <section className={styles.section}>
        <div className={styles.errorBox} role="alert">
          {error || "Nu am putut încărca inventarul."}
        </div>
      </section>
    );
  }

  const items = data.items || [];
  const summary = data.summary || { draftLines: 0, declaredUnits: 0 };
  const deadline = formatDateTime(data.fair?.inventoryDeadlineAt);
  const readOnly = Boolean(data.readOnly);

  return (
    <section className={styles.section} aria-labelledby="fair-inventory-title">
      <div className={styles.head}>
        <div>
          <h2 id="fair-inventory-title" className={styles.title}>
            <Package size={20} aria-hidden="true" /> Inventarul meu pentru târg
          </h2>
          <p className={styles.muted}>
            {readOnly
              ? "Participarea a fost anulată. Inventarul poate fi doar consultat: vezi mai jos unde se află fiecare produs."
              : data.canEdit
                ? deadline
                  ? `Poți adăuga și trimite produse până la ${deadline}.`
                  : "Adaugă produsele pe care le aduci sau le trimiți la târg."
                : "Termenul pentru inventar a trecut. Inventarul poate fi doar consultat."}
          </p>
        </div>
        <div className={styles.headActions}>
          {data.canEdit && (
            <button type="button" className={styles.btnGhost} onClick={openAdd}>
              <Plus size={16} aria-hidden="true" /> Adaugă produs
            </button>
          )}
          {data.canEdit && summary.draftLines > 0 && (
            <button type="button" className={styles.btn} onClick={submit} disabled={Boolean(busy)}>
              <Send size={16} aria-hidden="true" /> {busy === "submit" ? "Se trimite…" : "Trimite inventarul"}
            </button>
          )}
        </div>
      </div>

      {items.length > 0 && (
        <p className={styles.summary}>
          {items.length} produse · {summary.declaredUnits} bucăți
          {summary.draftLines > 0 ? ` · ${summary.draftLines} netrimise` : ""}
        </p>
      )}
      {!readOnly && <LabelingByArtfest />}

      {notice && (
        <div className={styles.successBox} role="status">
          {notice}
        </div>
      )}
      {error && (
        <div className={styles.errorBox} role="alert">
          {error}
        </div>
      )}

      {items.length === 0 ? (
        <p className={styles.empty}>
          {readOnly
            ? "Nu ai produse în inventarul pentru târg."
            : "Nu ai adăugat încă produse. Toate produsele aduse sau trimise la târg trebuie să fie listate pe Artfest."}
        </p>
      ) : (
        <ul className={styles.list}>
          {items.map((item) => (
            <li key={item.id} className={styles.item}>
              {item.imageUrl ? (
                <img className={styles.thumb} src={item.imageUrl} alt="" />
              ) : (
                <span className={`${styles.thumb} ${styles.thumbEmpty}`} />
              )}

              <div className={styles.itemBody}>
                <div className={styles.itemHead}>
                  <div className={styles.itemTitle}>
                    <strong>{item.title}</strong>
                    {item.variantLabel && <span>{item.variantLabel}</span>}
                  </div>
                  {readOnly ? (
                    <span className={`${styles.badge} ${styles[`tone_${SITUATION_TONE[item.situation] || "muted"}`]}`}>
                      {SITUATION_LABEL[item.situation] || item.situation}
                    </span>
                  ) : (
                    <span className={`${styles.badge} ${styles[`tone_${INVENTORY_STATUS_TONE[item.status] || "muted"}`]}`}>
                      {INVENTORY_STATUS_LABEL[item.status] || item.status}
                    </span>
                  )}
                </div>

                <dl className={styles.meta}>
                  <div>
                    <dt>Preț</dt>
                    <dd>{formatPrice(item.priceCents)}</dd>
                  </div>
                  <div>
                    <dt>Cantitate</dt>
                    <dd>{item.declaredQty}</dd>
                  </div>
                  <div>
                    <dt>Cod</dt>
                    <dd className={styles.code}>{item.barcodeDisplay}</dd>
                  </div>
                </dl>

                {(item.isFragile || item.isUnique || item.isLimitedEdition || item.canBeRemade) && (
                  <ul className={styles.chips}>
                    {item.isFragile && <li>Fragil</li>}
                    {item.isUnique && <li>Unicat</li>}
                    {item.isLimitedEdition && <li>Serie limitată</li>}
                    {item.canBeRemade && <li>Poate fi refăcut</li>}
                  </ul>
                )}

                <ReceptionResult reception={item.reception} />
                {readOnly ? (
                  <PhysicalState item={item} />
                ) : (
                  <>
                    <OnlineReservation item={item} />
                    <PriceSyncState item={item} />
                  </>
                )}

                <div className={styles.itemActions}>
                  {item.canSyncPrice && (
                    <button type="button" className={styles.btnSmall} onClick={() => syncPrice(item)} disabled={Boolean(busy)}>
                      <Tag size={14} aria-hidden="true" /> Actualizează prețul
                    </button>
                  )}
                  {item.actions.canEdit && (
                    <button
                      type="button"
                      className={styles.btnSmall}
                      onClick={() => {
                        setNotice("");
                        setModal({ mode: "edit", item });
                      }}
                      disabled={Boolean(busy)}
                    >
                      <Pencil size={14} aria-hidden="true" /> Editează
                    </button>
                  )}
                  {item.actions.canCancel && (
                    <button
                      type="button"
                      className={`${styles.btnSmall} ${styles.btnDanger}`}
                      onClick={() => cancelSubmitted(item)}
                      disabled={Boolean(busy)}
                    >
                      <X size={14} aria-hidden="true" /> Anulează trimiterea
                    </button>
                  )}
                  {item.actions.canRemove && (
                    <button
                      type="button"
                      className={`${styles.btnSmall} ${styles.btnDanger}`}
                      onClick={() => remove(item)}
                      disabled={Boolean(busy)}
                    >
                      <Trash2 size={14} aria-hidden="true" /> Elimină
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {modal && (
        <ItemModal
          mode={modal.mode}
          item={modal.item}
          products={products}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            setNotice(modal.mode === "add" ? "Produsul a fost adăugat în inventar." : "Modificările au fost salvate.");
            load();
          }}
        />
      )}
    </section>
  );
}
