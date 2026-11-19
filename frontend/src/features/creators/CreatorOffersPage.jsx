// src/features/creators/CreatorOffersPage.jsx
//
// Artfest Creators - „Ofertele mele”: pachete de promovare (produse / plătit /
// mixt). Editarea creează o versiune nouă pe server (colaborările viitoare
// păstrează versiunea acceptată). Remunerația e cea DORITĂ de influencer; marja
// Artfest și plățile vin într-o etapă ulterioară și nu sunt afișate aici.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Pencil, Plus, Trash2 } from "lucide-react";

import { api } from "../../lib/api";
import { CREATORS_API, CREATOR_ROUTES, centsToInput, fieldErrors, formatLei, friendlyError, isValidLeiInput } from "./creatorsLogic.js";
import { ConfirmDialog, SkeletonBlock } from "./creatorsShared.jsx";
import { cx, labelOf, useCreatorState } from "./creatorsClient.js";
import styles from "./Creators.module.css";

const EMPTY = {
  title: "",
  description: "",
  platform: "INSTAGRAM",
  contentType: "REEL",
  deliverables: [{ type: "REEL", count: 1 }],
  turnaroundDays: "7",
  type: "BARTER",
  creatorFee: "",
  acceptsProduct: true,
  conditions: "",
};

function toForm(offer) {
  return {
    title: offer.title,
    description: offer.description || "",
    platform: offer.platform,
    contentType: offer.contentType,
    deliverables: offer.deliverables?.length ? offer.deliverables : [{ type: offer.contentType, count: 1 }],
    turnaroundDays: String(offer.turnaroundDays || ""),
    type: offer.type,
    creatorFee: centsToInput(offer.creatorFeeCents),
    acceptsProduct: offer.acceptsProduct,
    conditions: offer.conditions || "",
    expectedVersion: offer.version,
  };
}

function OfferForm({ initial, options, onCancel, onSaved, offerId }) {
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const paid = form.type === "PAID" || form.type === "MIXED";
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  async function save(event) {
    event.preventDefault();
    setErrors({});
    setError("");
    if (!form.title.trim()) return setErrors({ title: "Dă un titlu pachetului." });
    if (paid && !isValidLeiInput(form.creatorFee)) return setErrors({ creatorFee: "Completează remunerația dorită, în lei (ex. 200 sau 199,50)." });
    setSaving(true);
    try {
      const body = { ...form, turnaroundDays: Number(form.turnaroundDays), creatorFee: paid ? form.creatorFee : null };
      const res = await api(offerId ? `${CREATORS_API}/offers/${encodeURIComponent(offerId)}` : `${CREATORS_API}/offers`, {
        method: offerId ? "PUT" : "POST",
        body,
      });
      onSaved(res.item);
    } catch (e) {
      setErrors(fieldErrors(e));
      setError(friendlyError(e));
    } finally {
      setSaving(false);
    }
  }

  const deliverableTypes = options?.contentTypes || [];

  return (
    <form className={styles.card} onSubmit={save} noValidate aria-labelledby="offer-form-title">
      <h2 id="offer-form-title" className={styles.cardTitle} style={{ marginBottom: 14 }}>
        {offerId ? "Editează oferta" : "Ofertă nouă"}
      </h2>
      {error && (
        <p className={styles.alert} role="alert">
          {error}
        </p>
      )}

      <label className={styles.field}>
        <span className={styles.label}>Titlu</span>
        <input className={cx(styles.input, errors.title && styles.inputInvalid)} value={form.title} maxLength={120} placeholder="Ex: Reel + 3 Story-uri" onChange={(e) => set({ title: e.target.value })} />
        {errors.title && <p className={styles.fieldError}>{errors.title}</p>}
      </label>

      <fieldset className={styles.field} style={{ border: 0, padding: 0 }}>
        <legend className={styles.label}>Tipul ofertei</legend>
        <div className={styles.choices} role="radiogroup">
          {(options?.offerTypes || []).map((t) => (
            <button key={t.value} type="button" role="radio" aria-checked={form.type === t.value} className={cx(styles.choice, form.type === t.value && styles.choiceActive)} onClick={() => set({ type: t.value, acceptsProduct: t.value !== "PAID" ? true : form.acceptsProduct })}>
              <strong>{t.label}</strong>
            </button>
          ))}
        </div>
      </fieldset>

      <div className={cx(styles.grid, styles.grid2)}>
        <label className={styles.field}>
          <span className={styles.label}>Platformă</span>
          <select className={styles.select} value={form.platform} onChange={(e) => set({ platform: e.target.value })}>
            {(options?.platforms || []).map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Tipul principal de conținut</span>
          <select className={styles.select} value={form.contentType} onChange={(e) => set({ contentType: e.target.value })}>
            {deliverableTypes.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <fieldset className={styles.field} style={{ border: 0, padding: 0 }}>
        <legend className={styles.label}>Livrabile</legend>
        {form.deliverables.map((d, index) => (
          <div key={index} className={styles.deliverableRow}>
            <select className={styles.select} aria-label="Tip livrabil" value={d.type} onChange={(e) => set({ deliverables: form.deliverables.map((x, i) => (i === index ? { ...x, type: e.target.value } : x)) })}>
              {deliverableTypes.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <input className={styles.input} aria-label="Număr" inputMode="numeric" value={d.count} onChange={(e) => set({ deliverables: form.deliverables.map((x, i) => (i === index ? { ...x, count: Number(e.target.value.replace(/\D/g, "")) || "" } : x)) })} />
            <button type="button" className={styles.btnGhost} aria-label="Elimină livrabilul" onClick={() => set({ deliverables: form.deliverables.filter((_, i) => i !== index) })} disabled={form.deliverables.length === 1}>
              <Trash2 size={16} aria-hidden="true" />
            </button>
          </div>
        ))}
        {form.deliverables.length < 6 && (
          <div>
            <button type="button" className={styles.btn} onClick={() => set({ deliverables: [...form.deliverables, { type: "STORY", count: 1 }] })}>
              <Plus size={16} aria-hidden="true" /> Adaugă livrabil
            </button>
          </div>
        )}
        {errors.deliverables && <p className={styles.fieldError}>{errors.deliverables}</p>}
      </fieldset>

      <div className={cx(styles.grid, styles.grid2)}>
        <label className={styles.field}>
          <span className={styles.label}>Termen (zile)</span>
          <input className={cx(styles.input, errors.turnaroundDays && styles.inputInvalid)} inputMode="numeric" value={form.turnaroundDays} onChange={(e) => set({ turnaroundDays: e.target.value.replace(/\D/g, "") })} />
          <p className={styles.hint}>De la primirea produsului sau a materialelor necesare.</p>
          {errors.turnaroundDays && <p className={styles.fieldError}>{errors.turnaroundDays}</p>}
        </label>
        {paid && (
          <label className={styles.field}>
            <span className={styles.label}>Remunerația dorită (lei)</span>
            <input className={cx(styles.input, errors.creatorFee && styles.inputInvalid)} inputMode="decimal" value={form.creatorFee} placeholder="200" onChange={(e) => set({ creatorFee: e.target.value })} />
            <p className={styles.hint}>Suma pe care dorești să o primești. Condițiile platformei pentru promovările plătite vor fi afișate înainte de activarea plăților.</p>
            {errors.creatorFee && <p className={styles.fieldError}>{errors.creatorFee}</p>}
          </label>
        )}
      </div>

      {form.type === "PAID" && (
        <label className={styles.small} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16 }}>
          <input type="checkbox" checked={form.acceptsProduct} onChange={(e) => set({ acceptsProduct: e.target.checked })} />
          Accept și produsul promovat, pe lângă plată
        </label>
      )}

      <label className={styles.field}>
        <span className={styles.label}>
          Descriere <span className={styles.muted}>(opțional)</span>
        </span>
        <textarea className={styles.textarea} value={form.description} maxLength={2000} onChange={(e) => set({ description: e.target.value })} />
      </label>
      <label className={styles.field}>
        <span className={styles.label}>
          Condiții suplimentare <span className={styles.muted}>(opțional)</span>
        </span>
        <textarea className={styles.textarea} value={form.conditions} maxLength={2000} onChange={(e) => set({ conditions: e.target.value })} />
      </label>

      <div className={styles.actions} style={{ justifyContent: "flex-end" }}>
        <button type="button" className={styles.btnGhost} onClick={onCancel} disabled={saving}>
          Renunță
        </button>
        <button type="submit" className={styles.btnPrimary} disabled={saving}>
          {saving ? "Se salvează…" : "Salvează oferta"}
        </button>
      </div>
    </form>
  );
}

export default function CreatorOffersPage() {
  const { state, options, error: loadError, loading } = useCreatorState();
  const [offers, setOffers] = useState(null);
  const [editing, setEditing] = useState(null); // null | "new" | offer
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmOff, setConfirmOff] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!state?.profile) return;
    api(`${CREATORS_API}/offers`)
      .then((res) => setOffers(res.items || []))
      .catch((e) => setError(friendlyError(e, "Nu am putut încărca ofertele.")));
  }, [state?.profile]);

  function onSaved(item) {
    setOffers((list) => (list.some((o) => o.id === item.id) ? list.map((o) => (o.id === item.id ? item : o)) : [...list, item]));
    setEditing(null);
    setNotice("Oferta a fost salvată.");
  }

  async function setActive(offer, active) {
    setBusy(true);
    setError("");
    try {
      const res = await api(`${CREATORS_API}/offers/${encodeURIComponent(offer.id)}/active`, { method: "POST", body: { active } });
      setOffers((list) => list.map((o) => (o.id === offer.id ? res.item : o)));
      setConfirmOff(null);
      setNotice(active ? "Oferta este din nou activă." : "Oferta a fost dezactivată.");
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading || (state?.profile && !offers && !error)) {
    return (
      <main className={styles.page} aria-busy="true">
        <SkeletonBlock height={28} />
        <div style={{ height: 16 }} />
        <SkeletonBlock height={160} />
      </main>
    );
  }

  if (loadError || !state?.profile) {
    return (
      <main className={styles.page}>
        <p className={styles.alert} role="alert">
          {loadError || "Configurează mai întâi profilul Artfest Creators."}
        </p>
        <Link className={styles.btnPrimary} to={CREATOR_ROUTES.onboarding}>
          Configurează profilul
        </Link>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <div className={styles.topBar}>
        <Link to={CREATOR_ROUTES.home} className={styles.backLink}>
          <ArrowLeft size={16} aria-hidden="true" /> Artfest Creators
        </Link>
      </div>
      <p className={styles.eyebrow}>Artfest Creators</p>
      <h1 className={styles.title}>Ofertele mele</h1>
      <p className={styles.lead}>Pachetele tale de promovare. O modificare nu schimbă condițiile colaborărilor deja acceptate.</p>

      {notice && (
        <p className={styles.success} role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className={styles.alert} role="alert">
          {error}
        </p>
      )}

      {editing ? (
        <OfferForm
          key={editing === "new" ? "new" : editing.id}
          initial={editing === "new" ? EMPTY : toForm(editing)}
          offerId={editing === "new" ? null : editing.id}
          options={options}
          onCancel={() => setEditing(null)}
          onSaved={onSaved}
        />
      ) : (
        <div className={styles.actions} style={{ margin: "16px 0" }}>
          <button type="button" className={styles.btnPrimary} onClick={() => { setNotice(""); setEditing("new"); }} disabled={offers.length >= (options?.limits?.offersMax || 20)}>
            <Plus size={18} aria-hidden="true" /> Ofertă nouă
          </button>
        </div>
      )}

      {!editing && offers.length === 0 && (
        <div className={cx(styles.card, styles.empty)}>
          <p style={{ margin: 0 }}>Încă nu ai oferte. Creează un pachet, de exemplu „1 Reel + 3 Story-uri în schimbul produsului”.</p>
        </div>
      )}

      {!editing && (
        <div className={cx(styles.grid, styles.grid2)}>
          {offers.map((offer) => (
            <article key={offer.id} className={cx(styles.offerCard, !offer.isActive && styles.offerInactive)}>
              <div className={styles.cardHead} style={{ marginBottom: 0 }}>
                <h2 className={styles.cardTitle} style={{ fontSize: 16 }}>
                  {offer.title}
                </h2>
                <span className={cx(styles.badge, offer.isActive ? styles.tone_success : styles.tone_muted)}>{offer.disabledByAdmin ? "Dezactivată de Artfest" : offer.isActive ? "Activă" : "Inactivă"}</span>
              </div>
              <div className={styles.offerMeta}>
                <span>{labelOf(options?.offerTypes, offer.type)}</span>·<span>{labelOf(options?.platforms, offer.platform)}</span>·<span>{offer.turnaroundDays} zile</span>
              </div>
              <p className={styles.small} style={{ margin: 0 }}>
                {offer.deliverables.map((d) => `${d.count} × ${labelOf(options?.contentTypes, d.type)}`).join(", ")}
              </p>
              {offer.creatorFeeCents != null && (
                <p className={styles.price} style={{ margin: 0 }}>
                  {formatLei(offer.creatorFeeCents)} <span className={cx(styles.muted, styles.small)}>remunerația dorită</span>
                </p>
              )}
              <div className={styles.actions}>
                {!offer.disabledByAdmin && (
                  <button type="button" className={styles.btn} onClick={() => { setNotice(""); setEditing(offer); }}>
                    <Pencil size={16} aria-hidden="true" /> Editează
                  </button>
                )}
                {offer.isActive ? (
                  <button type="button" className={styles.btnGhost} onClick={() => setConfirmOff(offer)} disabled={busy}>
                    Dezactivează
                  </button>
                ) : (
                  !offer.disabledByAdmin && (
                    <button type="button" className={styles.btnGhost} onClick={() => setActive(offer, true)} disabled={busy}>
                      Reactivează
                    </button>
                  )
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      {confirmOff && (
        <ConfirmDialog title="Dezactivezi oferta?" confirmLabel="Dezactivează" onConfirm={() => setActive(confirmOff, false)} onCancel={() => setConfirmOff(null)} busy={busy} danger>
          „{confirmOff.title}” nu va mai fi disponibilă pentru colaborări noi. O poți reactiva oricând.
        </ConfirmDialog>
      )}
    </main>
  );
}
