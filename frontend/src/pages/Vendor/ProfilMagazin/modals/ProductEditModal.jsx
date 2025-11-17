/**
 * Dependențe externe (alte fișiere/rute):
 *  - API wrapper:        client/src/lib/api.js  (funcția `api`)
 *  - Modal UI:           client/src/pages/Store/ProfilMagazin/ui/Modal.jsx
 *  - Categorii (GET):    GET /api/public/categories/detailed
 *  - Produs (GET):       GET /api/vendors/products/:id
 *  - Produs (PUT):       PUT /api/vendors/products/:id
 *
 * Notă UX: la salvare emite `window.dispatchEvent(new CustomEvent("vendor:productUpdated", {detail:{product}}))`
 *          pentru update instant al cardurilor fără refresh.
 */
import React, {
  useEffect,
  useMemo,
  useState,
  useCallback,
  useRef,
} from "react";
import Modal from "../ui/Modal";
import { api } from "../../../../lib/api";
import styles from "../components/css/ProductEditModal.module.css";

const toNum = (v) => {
  const n =
    typeof v === "number" ? v : Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

// serializează o dată yyyy-mm-dd într-un ISO stabil (evită off-by-one pe fusuri)
const dateOnlyToISO = (yyyyMmDd) => {
  if (!yyyyMmDd) return null;
  const [y, m, d] = String(yyyyMmDd).split("-").map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d, 12, 0, 0);
  return dt.toISOString();
};

// Sugestie de descriere pe baza câmpurilor structurate
const generateDescriptionFromForm = (f) => {
  if (!f) return "";
  const parts = [];

  if (f.materialMain?.trim()) {
    parts.push(`Acest produs este realizat din ${f.materialMain.trim()}.`);
  }
  if (f.technique?.trim()) {
    parts.push(`Fiecare piesă este ${f.technique.trim()}.`);
  }
  if (f.dimensions?.trim()) {
    parts.push(`Dimensiuni aproximative: ${f.dimensions.trim()}.`);
  }
  const occ = f.occasionTags?.trim();
  if (occ) {
    parts.push(`Potrivit ca ${occ}.`);
  }
  const style = f.styleTags?.trim();
  if (style) {
    parts.push(`Stil: ${style}.`);
  }
  if (f.careInstructions?.trim()) {
    parts.push(`Îngrijire: ${f.careInstructions.trim()}.`);
  }
  if (f.specialNotes?.trim()) {
    const note = f.specialNotes.trim();
    parts.push(note.endsWith(".") ? note : `${note}.`);
  }

  return parts.join(" ");
};

export default function ProductEditModal({ open, onClose, productId, onSaved }) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [cats, setCats] = useState([]);

  const [initial, setInitial] = useState(null);
  const [form, setForm] = useState({
    title: "",
    description: "",
    price: "",
    currency: "RON",
    images: [],
    isActive: true,
    isHidden: false,
    category: "",
    color: "",

    // handmade fields
    availability: "", // READY | MADE_TO_ORDER | PREORDER | SOLD_OUT
    leadTimeDays: "",
    readyQty: "",
    nextShipDate: "",
    acceptsCustom: false,

    // detalii structurate
    materialMain: "",
    technique: "",
    styleTags: "", // comma-separated
    occasionTags: "", // comma-separated
    dimensions: "",
    careInstructions: "",
    specialNotes: "",
  });

  // === state pentru acordeoane (toate închise la deschidere) ===
  const [sectionsOpen, setSectionsOpen] = useState({
    base: false, // Informații de bază
    details: false, // Detalii produs
    availability: false, // Disponibilitate & livrare
    media: false, // Imagini & vizibilitate
  });

  const toggleSection = useCallback((key) => {
    setSectionsOpen((s) => ({ ...s, [key]: !s[key] }));
  }, []);

  // ===== DnD state =====
  const dragIndexRef = useRef(-1);

  // ===== Helpers (stable) =====
  const setMainImage = useCallback((idx) => {
    setForm((s) => {
      if (!Array.isArray(s.images) || idx < 0 || idx >= s.images.length)
        return s;
      if (idx === 0) return s;
      const arr = [...s.images];
      const [it] = arr.splice(idx, 1);
      arr.unshift(it);
      return { ...s, images: arr };
    });
  }, []);

  const removeImage = useCallback((idx) => {
    setForm((f) => ({ ...f, images: f.images.filter((_, i) => i !== idx) }));
  }, []);

  const moveImage = useCallback((from, to) => {
    setForm((f) => {
      const arr = [...f.images];
      if (from === to || to < 0 || to >= arr.length) return f;
      const [it] = arr.splice(from, 1);
      arr.splice(to, 0, it);
      return { ...f, images: arr };
    });
  }, []);

  const onDragStart = useCallback(
    (idx) => (e) => {
      dragIndexRef.current = idx;
      e.dataTransfer.effectAllowed = "move";
      try {
        e.dataTransfer.setData("text/plain", String(idx));
      } catch {
        /* noop */
      }
    },
    []
  );

  const onDragOver = useCallback(
    () => (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    },
    []
  );

  const onDrop = useCallback(
    (idx) => (e) => {
      e.preventDefault();
      const from =
        dragIndexRef.current >= 0
          ? dragIndexRef.current
          : Number(e.dataTransfer.getData("text/plain"));
      dragIndexRef.current = -1;
      if (!Number.isFinite(from)) return;
      moveImage(from, idx);
    },
    [moveImage]
  );

  // Reset local state când închizi modalul
  useEffect(() => {
    if (!open) {
      setError(null);
      setInitial(null);
      setForm({
        title: "",
        description: "",
        price: "",
        currency: "RON",
        images: [],
        isActive: true,
        isHidden: false,
        category: "",
        color: "",

        availability: "READY",
        leadTimeDays: "",
        readyQty: "",
        nextShipDate: "",
        acceptsCustom: false,

        materialMain: "",
        technique: "",
        styleTags: "",
        occasionTags: "",
        dimensions: "",
        careInstructions: "",
        specialNotes: "",
      });
      setSectionsOpen({
        base: false,
        details: false,
        availability: false,
        media: false,
      });
    }
  }, [open]);

  // Load produs + categorii
  useEffect(() => {
    if (!open || !productId) return;
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [p, c] = await Promise.all([
          api(`/api/vendors/products/${encodeURIComponent(productId)}`),
          api(`/api/public/categories/detailed`).catch(() => []),
        ]);
        if (!alive) return;

        const price =
          typeof p?.price === "number"
            ? p.price
            : Number.isFinite(p?.priceCents)
            ? p.priceCents / 100
            : 0;

        setInitial(p);
        setForm({
          title: p?.title || "",
          description: p?.description || "",
          price: String(price),
          currency: p?.currency || "RON",
          images: Array.isArray(p?.images) ? p.images : [],
          isActive: !!p?.isActive,
          isHidden: !!p?.isHidden,
          category: p?.category || "",
          color: p?.color || "",

          availability: p?.availability,
          leadTimeDays: Number.isFinite(Number(p?.leadTimeDays))
            ? String(Number(p.leadTimeDays))
            : "",
          readyQty:
            p?.readyQty === null || p?.readyQty === undefined
              ? ""
              : Number.isFinite(Number(p?.readyQty))
              ? String(Number(p.readyQty))
              : "",
          nextShipDate: p?.nextShipDate
            ? String(p.nextShipDate).slice(0, 10)
            : "",
          acceptsCustom: !!p?.acceptsCustom,

          materialMain: p?.materialMain || "",
          technique: p?.technique || "",
          styleTags: Array.isArray(p?.styleTags) ? p.styleTags.join(", ") : "",
          occasionTags: Array.isArray(p?.occasionTags)
            ? p.occasionTags.join(", ")
            : "",
          dimensions: p?.dimensions || "",
          careInstructions: p?.careInstructions || "",
          specialNotes: p?.specialNotes || "",
        });

        setCats(
          Array.isArray(c)
            ? c.map((x) => ({
                key: x.key || x.code || x,
                label: x.label || x.name || x,
              }))
            : []
        );
      } catch (e) {
        if (!alive) return;
        setError(e?.message || "Nu am putut încărca produsul.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [open, productId]);

  // 🔁 Normalizează câmpurile în funcție de availability (similar cu ProductModal)
  useEffect(() => {
    setForm((s) => {
      const av = s.availability || "READY";
      const next = { ...s };

      if (av === "READY") {
        next.leadTimeDays = "";
        next.nextShipDate = "";
        next.readyQty =
          next.readyQty === "" || !Number.isFinite(Number(next.readyQty))
            ? ""
            : String(Math.max(0, Number(next.readyQty)));
      } else if (av === "MADE_TO_ORDER") {
        next.readyQty = "";
        next.nextShipDate = "";
        if (
          !Number.isFinite(Number(next.leadTimeDays)) ||
          Number(next.leadTimeDays) < 1
        ) {
          next.leadTimeDays = "";
        } else {
          next.leadTimeDays = String(
            Math.max(1, Math.floor(Number(next.leadTimeDays)))
          );
        }
      } else if (av === "PREORDER") {
        next.readyQty = "";
        next.leadTimeDays = "";
      } else if (av === "SOLD_OUT") {
        next.readyQty = "";
        next.leadTimeDays = "";
        next.nextShipDate = "";
      }

      return JSON.stringify(next) === JSON.stringify(s) ? s : next;
    });
  }, [form.availability]);

  const changed = useMemo(() => {
    if (!initial) return false;
    const normalize = (o) => JSON.stringify(o);

    const curr = {
      title: form.title,
      description: form.description,
      price: toNum(form.price),
      currency: form.currency,
      images: form.images,
      isActive: !!form.isActive,
      isHidden: !!form.isHidden,
      category: form.category || null,
      color: form.color || null,

      availability: form.availability || "READY",
      leadTimeDays:
        form.availability === "MADE_TO_ORDER"
          ? Number(form.leadTimeDays || 0) || null
          : null,
      readyQty:
        form.availability === "READY"
          ? form.readyQty === ""
            ? null
            : Math.max(0, Number(form.readyQty || 0))
          : null,
      nextShipDate:
        form.availability === "PREORDER" && form.nextShipDate
          ? dateOnlyToISO(form.nextShipDate)
          : null,
      acceptsCustom: !!form.acceptsCustom,

      materialMain: form.materialMain || null,
      technique: form.technique || null,
      styleTags: (form.styleTags || "").trim(),
      occasionTags: (form.occasionTags || "").trim(),
      dimensions: form.dimensions || null,
      careInstructions: form.careInstructions || null,
      specialNotes: form.specialNotes || null,
    };

    const orig = {
      title: initial?.title || "",
      description: initial?.description || "",
      price:
        typeof initial?.price === "number"
          ? initial.price
          : Number.isFinite(initial?.priceCents)
          ? initial.priceCents / 100
          : 0,
      currency: initial?.currency || "RON",
      images: Array.isArray(initial?.images) ? initial.images : [],
      isActive: !!initial?.isActive,
      isHidden: !!initial?.isHidden,
      category: initial?.category || null,
      color: initial?.color || null,

      availability: initial?.availability || "READY",
      leadTimeDays: Number.isFinite(Number(initial?.leadTimeDays))
        ? Number(initial.leadTimeDays)
        : null,
      readyQty:
        initial?.readyQty === null || initial?.readyQty === undefined
          ? null
          : Number.isFinite(Number(initial?.readyQty))
          ? Number(initial.readyQty)
          : null,
      nextShipDate: initial?.nextShipDate
        ? new Date(initial.nextShipDate).toISOString()
        : null,
      acceptsCustom: !!initial?.acceptsCustom,

      materialMain: initial?.materialMain || null,
      technique: initial?.technique || null,
      styleTags: Array.isArray(initial?.styleTags)
        ? initial.styleTags.join(", ")
        : initial?.styleTags || "",
      occasionTags: Array.isArray(initial?.occasionTags)
        ? initial.occasionTags.join(", ")
        : initial?.occasionTags || "",
      dimensions: initial?.dimensions || null,
      careInstructions: initial?.careInstructions || null,
      specialNotes: initial?.specialNotes || null,
    };

    return normalize(curr) !== normalize(orig);
  }, [form, initial]);

  const onField = useCallback(
    (name) => (e) => {
      const value =
        e?.target?.type === "checkbox"
          ? e.target.checked
          : e?.target?.value ?? e;
      setForm((f) => ({ ...f, [name]: value }));
    },
    []
  );

  // Adăugare imagine prin URL (prompt)
  const addImage = useCallback(() => {
    const url = prompt("Adaugă URL imagine (https://… sau /uploads/…):");
    if (!url) return;
    setForm((f) => ({ ...f, images: [...(f.images || []), url.trim()] }));
  }, []);

  // VALIDARE
  const validate = useCallback(() => {
    const errs = [];
    if (!form.title.trim()) errs.push("Titlul este obligatoriu.");
    const price = toNum(form.price);
    if (!Number.isFinite(price) || price < 0) errs.push("Preț invalid.");

    if (form.availability === "MADE_TO_ORDER") {
      const lt = Number(form.leadTimeDays || 0);
      if (!Number.isFinite(lt) || lt <= 0)
        errs.push("Timpul de execuție trebuie să fie un număr pozitiv.");
    }
    if (form.availability === "READY") {
      if (form.readyQty !== "") {
        const rq = Number(form.readyQty || 0);
        if (!Number.isFinite(rq) || rq < 0)
          errs.push(
            "Cantitatea gata de livrare trebuie să fie ≥ 0 sau lăsată necompletată."
          );
      }
    }
    if (form.availability === "PREORDER" && form.nextShipDate) {
      const d = new Date(form.nextShipDate);
      if (Number.isNaN(d.getTime()))
        errs.push("Data de expediere este invalidă.");
    }

    if (form.images.length > 12) errs.push("Maxim 12 imagini.");
    if (errs.length) {
      alert(errs.join("\n"));
      return false;
    }
    return true;
  }, [form]);

  // SAVE (emit event pt. update instant)
  const save = useCallback(async () => {
    if (saving) return;
    if (!validate()) return;
    try {
      setSaving(true);

      const body = {
        title: form.title.trim(),
        description: form.description,
        price: toNum(form.price),
        images: form.images,
        isActive: !!form.isActive,
        isHidden: !!form.isHidden,
        category: form.category || null,
        color: form.color || null,
        currency: form.currency || "RON",
        availability: form.availability,
        acceptsCustom: !!form.acceptsCustom,

        materialMain: form.materialMain || null,
        technique: form.technique || null,
        styleTags: form.styleTags,
        occasionTags: form.occasionTags,
        dimensions: form.dimensions || null,
        careInstructions: form.careInstructions || null,
        specialNotes: form.specialNotes || null,
      };

      if (form.availability === "MADE_TO_ORDER") {
        body.leadTimeDays = Math.max(1, Number(form.leadTimeDays || 1));
      } else if (form.availability === "READY") {
        body.readyQty =
          form.readyQty === ""
            ? null
            : Math.max(0, Number(form.readyQty || 0));
        body.leadTimeDays = null;
        body.nextShipDate = null;
      } else if (form.availability === "PREORDER") {
        body.nextShipDate = form.nextShipDate
          ? dateOnlyToISO(form.nextShipDate)
          : null;
      } else if (form.availability === "SOLD_OUT") {
        body.leadTimeDays = null;
        body.readyQty = 0;
        body.nextShipDate = null;
      }

     const updated = await api(
   `/api/vendors/products/${encodeURIComponent(productId)}`,
  {
     method: "PUT",
     body,
  }
);

      try {
        window.dispatchEvent(
          new CustomEvent("vendor:productUpdated", {
            detail: {
              product: {
                id: productId,
                ...updated,
                title: updated?.title ?? body.title,
                description: updated?.description ?? body.description,
                price: updated?.price ?? body.price,
                images: Array.isArray(updated?.images)
                  ? updated.images
                  : body.images,
                isActive: updated?.isActive ?? body.isActive,
                isHidden: updated?.isHidden ?? body.isHidden,
                category: updated?.category ?? body.category,
                color: updated?.color ?? body.color,
                currency: updated?.currency ?? body.currency,
                availability: updated?.availability ?? body.availability,
                leadTimeDays:
                  updated?.leadTimeDays ?? body.leadTimeDays ?? null,
                readyQty: updated?.readyQty ?? body.readyQty ?? null,
                nextShipDate:
                  updated?.nextShipDate ?? body.nextShipDate ?? null,
                acceptsCustom:
                  updated?.acceptsCustom ?? body.acceptsCustom ?? false,

                materialMain:
                  updated?.materialMain ?? body.materialMain ?? null,
                technique: updated?.technique ?? body.technique ?? null,
                styleTags: updated?.styleTags ?? body.styleTags ?? [],
                occasionTags:
                  updated?.occasionTags ?? body.occasionTags ?? [],
                dimensions: updated?.dimensions ?? body.dimensions ?? null,
                careInstructions:
                  updated?.careInstructions ?? body.careInstructions ?? null,
                specialNotes:
                  updated?.specialNotes ?? body.specialNotes ?? null,
              },
            },
          })
        );
      } catch {
        /* noop */
      }

      onSaved?.(updated);
    } catch (e) {
      const msg =
        e?.message === "forbidden"
          ? "Nu ai drepturi pe acest produs."
          : e?.message || "Nu am putut salva.";
      alert(msg);
    } finally {
      setSaving(false);
    }
  }, [saving, validate, productId, form, onSaved]);

  // PASTE (URL text)
  const onPaste = useCallback(async (e) => {
    const text = e.clipboardData?.getData("text")?.trim();
    if (text && /^(https?:\/\/|\/)/i.test(text)) {
      setForm((s) => ({ ...s, images: [...(s.images || []), text] }));
      return;
    }
  }, []);

  const generatedDescription = useMemo(
    () => generateDescriptionFromForm(form),
    [form]
  );

  return (
    <Modal open={open} onClose={saving ? undefined : onClose} maxWidth={720}>
      <div className={styles.header}>
        <h3 className={styles.title}>Editează produsul</h3>
        <div className={styles.spacer} />
        <button className={styles.btn} onClick={onClose} disabled={saving}>
          Închide
        </button>
        <button
          className={styles.btnPrimary}
          onClick={save}
          disabled={saving || loading || !changed}
          title={!changed ? "Nicio modificare" : "Salvează"}
        >
          {saving ? "Se salvează…" : "Salvează"}
        </button>
      </div>

      {loading ? (
        <div className={styles.loading}>Se încarcă…</div>
      ) : error ? (
        <div className={styles.error}>{error}</div>
      ) : (
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          {/* === Secțiunea 1: Informații de bază === */}
          <section className={styles.section}>
            <button
              type="button"
              className={styles.sectionHeader}
              onClick={() => toggleSection("base")}
              aria-expanded={sectionsOpen.base}
            >
              <span className={styles.sectionTitle}>Informații de bază</span>
              <span className={styles.sectionChevron}>
                {sectionsOpen.base ? "▾" : "▸"}
              </span>
            </button>
            {sectionsOpen.base && (
              <div className={styles.sectionBody}>
                <div className={styles.row}>
                  <label className={styles.label}>Titlu *</label>
                  <input
                    className={styles.input}
                    value={form.title}
                    onChange={onField("title")}
                    maxLength={120}
                  />
                </div>

                <div className={styles.row}>
                  <label className={styles.label}>Descriere</label>
                  <textarea
                    className={styles.textarea}
                    value={form.description}
                    onChange={onField("description")}
                    rows={5}
                  />
                </div>

                <div className={styles.grid}>
                  <div className={styles.row}>
                    <label className={styles.label}>Preț *</label>
                    <input
                      className={styles.input}
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.price}
                      onChange={onField("price")}
                    />
                  </div>
                  <div className={styles.row}>
                    <label className={styles.label}>Monedă</label>
                    <select
                      className={styles.input}
                      value={form.currency}
                      onChange={onField("currency")}
                    >
                      <option value="RON">RON</option>
                      <option value="EUR">EUR</option>
                    </select>
                  </div>
                  <div className={styles.row}>
                    <label className={styles.label}>Categorie</label>
                    <select
                      className={styles.input}
                      value={form.category}
                      onChange={onField("category")}
                    >
                      <option value="">(fără)</option>
                      {cats.map((c) => (
                        <option key={c.key} value={c.key}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className={styles.row}>
                    <label className={styles.label}>
                      Culoare principală
                    </label>
                    <input
                      className={styles.input}
                      value={form.color}
                      onChange={onField("color")}
                      placeholder="ex: alb, crem, multicolor"
                      maxLength={40}
                    />
                  </div>
                  <div className={styles.rowCheck}>
                    <label className={styles.checkbox}>
                      <input
                        type="checkbox"
                        checked={!!form.isActive}
                        onChange={onField("isActive")}
                      />{" "}
                      Activ
                    </label>
                  </div>
                  <div className={styles.rowCheck}>
                    <label className={styles.checkbox}>
                      <input
                        type="checkbox"
                        checked={!!form.isHidden}
                        onChange={onField("isHidden")}
                      />{" "}
                      Ascuns (nu apare public)
                    </label>
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* === Secțiunea 2: Detalii produs === */}
          <section className={styles.section}>
            <button
              type="button"
              className={styles.sectionHeader}
              onClick={() => toggleSection("details")}
              aria-expanded={sectionsOpen.details}
            >
              <span className={styles.sectionTitle}>Detalii produs</span>
              <span className={styles.sectionChevron}>
                {sectionsOpen.details ? "▾" : "▸"}
              </span>
            </button>
            {sectionsOpen.details && (
              <div className={styles.sectionBody}>
                <div className={styles.row}>
                  <label className={styles.label}>Material principal</label>
                  <input
                    className={styles.input}
                    value={form.materialMain}
                    onChange={onField("materialMain")}
                    placeholder="ex: lemn de pin, ceramică, bumbac organic"
                    maxLength={120}
                  />
                </div>

                <div className={styles.row}>
                  <label className={styles.label}>
                    Tehnică / cum este lucrat
                  </label>
                  <input
                    className={styles.input}
                    value={form.technique}
                    onChange={onField("technique")}
                    placeholder="ex: pictat manual, croșetat, turnat în matriță"
                    maxLength={160}
                  />
                </div>

                <div className={styles.grid}>
                  <div className={styles.row}>
                    <label className={styles.label}>
                      Stil (tag-uri separate prin virgulă)
                    </label>
                    <input
                      className={styles.input}
                      value={form.styleTags}
                      onChange={onField("styleTags")}
                      placeholder="ex: rustic, boho, minimalist"
                    />
                  </div>
                  <div className={styles.row}>
                    <label className={styles.label}>
                      Ocazii (tag-uri separate prin virgulă)
                    </label>
                    <input
                      className={styles.input}
                      value={form.occasionTags}
                      onChange={onField("occasionTags")}
                      placeholder="ex: cadou casă nouă, zi de naștere"
                    />
                  </div>
                </div>

                <div className={styles.grid}>
                  <div className={styles.row}>
                    <label className={styles.label}>Dimensiuni</label>
                    <input
                      className={styles.input}
                      value={form.dimensions}
                      onChange={onField("dimensions")}
                      placeholder="ex: 20 x 30 cm"
                      maxLength={120}
                    />
                  </div>
                  <div className={styles.row}>
                    <label className={styles.label}>
                      Instrucțiuni de îngrijire
                    </label>
                    <input
                      className={styles.input}
                      value={form.careInstructions}
                      onChange={onField("careInstructions")}
                      placeholder="ex: șterge ușor cu o cârpă umedă"
                    />
                  </div>
                </div>

                <div className={styles.row}>
                  <label className={styles.label}>Note speciale</label>
                  <textarea
                    className={styles.textarea}
                    value={form.specialNotes}
                    onChange={onField("specialNotes")}
                    rows={3}
                    placeholder="ex: fiecare piesă este unică, pot apărea mici variații față de fotografie"
                  />
                </div>

                {generatedDescription && (
                  <div className={styles.row}>
                    <label className={styles.label}>
                      Sugestie de descriere (generată din câmpurile de mai sus)
                    </label>
                    <div
                      style={{
                        fontSize: "0.85rem",
                        padding: "10px 12px",
                        borderRadius: 8,
                        border: "1px dashed rgba(0,0,0,0.12)",
                        background: "rgba(0,0,0,0.02)",
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      {generatedDescription}
                    </div>
                    <div
                      style={{
                        marginTop: 4,
                        fontSize: "0.75rem",
                        opacity: 0.7,
                      }}
                    >
                      Poți copia textul de mai sus în câmpul „Descriere” și să
                      îl ajustezi, dacă îți place cum sună.
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* === Secțiunea 3: Disponibilitate & livrare === */}
          <section className={styles.section}>
            <button
              type="button"
              className={styles.sectionHeader}
              onClick={() => toggleSection("availability")}
              aria-expanded={sectionsOpen.availability}
            >
              <span className={styles.sectionTitle}>
                Disponibilitate & livrare
              </span>
              <span className={styles.sectionChevron}>
                {sectionsOpen.availability ? "▾" : "▸"}
              </span>
            </button>
            {sectionsOpen.availability && (
              <div className={styles.sectionBody}>
                <div className={styles.row}>
                  <label className={styles.label}>Disponibilitate</label>
                  <select
                    className={styles.input}
                    value={form.availability}
                    onChange={onField("availability")}
                  >
                    <option value="READY">Gata de livrare</option>
                    <option value="MADE_TO_ORDER">La comandă</option>
                    <option value="PREORDER">Precomandă</option>
                    <option value="SOLD_OUT">Epuizat</option>
                  </select>
                </div>

                {form.availability === "READY" && (
                  <div className={styles.row}>
                    <label className={styles.label}>
                      Bucăți gata de livrare
                    </label>
                    <input
                      className={styles.input}
                      type="number"
                      min={0}
                      step={1}
                      value={form.readyQty}
                      onChange={onField("readyQty")}
                      placeholder="(lăsat gol = necunoscut)"
                    />
                  </div>
                )}

                {form.availability === "MADE_TO_ORDER" && (
                  <div className={styles.row}>
                    <label className={styles.label}>
                      Timp de execuție (zile)
                    </label>
                    <input
                      className={styles.input}
                      type="number"
                      min={1}
                      step={1}
                      value={form.leadTimeDays}
                      onChange={onField("leadTimeDays")}
                      placeholder="ex: 5"
                    />
                  </div>
                )}

                {form.availability === "PREORDER" && (
                  <div className={styles.row}>
                    <label className={styles.label}>
                      Data estimată de expediere
                    </label>
                    <input
                      className={styles.input}
                      type="date"
                      value={form.nextShipDate || ""}
                      onChange={onField("nextShipDate")}
                    />
                  </div>
                )}

                <div className={styles.rowCheck}>
                  <label className={styles.checkbox}>
                    <input
                      type="checkbox"
                      checked={!!form.acceptsCustom}
                      onChange={onField("acceptsCustom")}
                    />
                    Acceptă personalizare
                  </label>
                </div>
              </div>
            )}
          </section>

          {/* === Secțiunea 4: Imagini & vizibilitate === */}
          <section className={styles.section}>
            <button
              type="button"
              className={styles.sectionHeader}
              onClick={() => toggleSection("media")}
              aria-expanded={sectionsOpen.media}
            >
              <span className={styles.sectionTitle}>
                Imagini & vizibilitate
              </span>
              <span className={styles.sectionChevron}>
                {sectionsOpen.media ? "▾" : "▸"}
              </span>
            </button>
            {sectionsOpen.media && (
              <div className={styles.sectionBody} onPaste={onPaste}>
                <div className={styles.rowHead}>
                  <label className={styles.label}>Imagini (max 12)</label>
                  <div style={{ display: "inline-flex", gap: 8 }}>
                    <button
                      type="button"
                      className={styles.smallBtn}
                      onClick={addImage}
                    >
                      + Adaugă URL
                    </button>
                  </div>
                </div>

                {form.images.length === 0 ? (
                  <div className={styles.empty}>Nu există imagini.</div>
                ) : (
                  <ul className={styles.images}>
                    {form.images.map((u, i) => (
                      <li
                        key={`${u}-${i}`}
                        className={styles.imageItem}
                        draggable
                        onDragStart={onDragStart(i)}
                        onDragOver={onDragOver(i)}
                        onDrop={onDrop(i)}
                        title={
                          i === 0
                            ? "Imagine principală"
                            : "Trage pentru a reordona"
                        }
                      >
                        <img
                          src={u}
                          alt={`img-${i}`}
                          className={styles.image}
                        />
                        <div
                          className={styles.imageBtns}
                          style={{ display: "flex", gap: 6 }}
                        >
                          <button
                            type="button"
                            onClick={() => moveImage(i, i - 1)}
                            disabled={i === 0}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            onClick={() => moveImage(i, i + 1)}
                            disabled={i === form.images.length - 1}
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            onClick={() => removeImage(i)}
                          >
                            Șterge
                          </button>
                          <button
                            type="button"
                            onClick={() => setMainImage(i)}
                            title={
                              i === 0
                                ? "Deja principală"
                                : "Setează ca principală"
                            }
                            style={{ fontWeight: i === 0 ? 800 : 500 }}
                          >
                            {i === 0 ? "★" : "☆"}
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                <div className={styles.tip}>
                  • Poți lipi (paste) un URL de imagine direct aici. <br />
                  • Reordonează cu drag &amp; drop. ★ marchează imaginea
                  principală (prima în listă).
                </div>
              </div>
            )}
          </section>
        </form>
      )}
    </Modal>
  );
}
