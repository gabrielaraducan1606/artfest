/**
 * ProductEditModal
 *
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
import styles from "../components/css/ProductModal.module.css";

// IMPORTURI CONSTANTE – la fel ca în ProductModal
import {
  COLORS_DETAILED,
} from "../../../../../../backend/src/constants/colors.js";
import {
  MATERIALS_DETAILED,
} from "../../../../../../backend/src/constants/materials.js";
import {
  TECHNIQUES_DETAILED,
} from "../../../../../../backend/src/constants/tehniques.js";

import {
  STYLE_TAGS_DETAILED,
} from "../../../../../../backend/src/constants/stylesTags.js";
import {
  OCCASION_TAGS_DETAILED,
} from "../../../../../../backend/src/constants/occasinsTags.js";
import {
  CARE_TAGS_DETAILED,
} from "../../../../../../backend/src/constants/careInstructions.js";

/* ===== Helpers ===== */
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

/* ====== Mic component de acordeon (la fel ca în ProductModal) ====== */
function AccordionSection({ id, title, open, onToggle, children }) {
  return (
    <section className={styles.section} aria-labelledby={`${id}-header`}>
      <button
        type="button"
        className={styles.sectionHeader}
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={`${id}-body`}
        id={`${id}-header`}
      >
        <span className={styles.sectionTitle}>{title}</span>
        <span className={styles.sectionToggleIcon}>{open ? "−" : "+"}</span>
      </button>
      <div
        id={`${id}-body`}
        className={open ? styles.sectionBody : styles.sectionBodyCollapsed}
      >
        {children}
      </div>
    </section>
  );
}

/* ====== TagComboField: multi-tag (stil / ocazii / îngrijire) ====== */
function TagComboField({
  id,
  label,
  value, // CSV: "a, b, c"
  onChange, // primește CSV
  options, // array de string (labeluri)
  placeholder,
  note,
}) {
  const [inputValue, setInputValue] = useState("");
  const [openList, setOpenList] = useState(false);
  const wrapRef = useRef(null);

  const tags = useMemo(
    () =>
      String(value || "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    [value]
  );

  useEffect(() => {
    if (!openList) return;
    const handleClickOutside = (e) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target)) {
        setOpenList(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [openList]);

  const normalize = (s) =>
    String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();

  const addTag = (token) => {
    const norm = String(token || "").trim();
    if (!norm) return;
    const existing = new Set(tags);
    if (existing.has(norm)) {
      setInputValue("");
      return;
    }
    const next = [...tags, norm];
    onChange(next.join(", "));
    setInputValue("");
  };

  const removeTag = (tag) => {
    const next = tags.filter((t) => t !== tag);
    onChange(next.join(", "));
  };

  const suggestions = useMemo(() => {
    const q = normalize(inputValue);
    const existing = new Set(tags.map((t) => normalize(t)));
    return options
      .filter((opt) => !existing.has(normalize(opt)))
      .filter((opt) => !q || normalize(opt).includes(q))
      .slice(0, 20);
  }, [options, tags, inputValue]);

  const onKeyDown = (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(inputValue);
      return;
    }
    if (e.key === "Backspace" && !inputValue && tags.length > 0) {
      e.preventDefault();
      removeTag(tags[tags.length - 1]);
    }
  };

  return (
    <div ref={wrapRef} style={{ marginBottom: 12 }}>
      {label && (
        <label className={styles.label} htmlFor={id}>
          {label}
        </label>
      )}
      <div
        className={styles.input}
        style={{
          minHeight: 40,
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 6,
          paddingTop: 6,
          paddingBottom: 6,
        }}
        onClick={() => {
          setOpenList(true);
          const el = document.getElementById(id);
          if (el) el.focus();
        }}
      >
        {tags.map((tag) => (
          <span
            key={tag}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "2px 8px",
              borderRadius: 999,
              fontSize: "0.75rem",
              background: "rgba(0,0,0,0.06)",
            }}
          >
            {tag}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                removeTag(tag);
              }}
              style={{
                border: "none",
                background: "transparent",
                cursor: "pointer",
                fontSize: "0.8rem",
                lineHeight: 1,
                padding: 0,
              }}
              aria-label={`Șterge tag ${tag}`}
            >
              ×
            </button>
          </span>
        ))}

        <input
          id={id}
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value);
            setOpenList(true);
          }}
          onKeyDown={onKeyDown}
          placeholder={tags.length ? "" : placeholder}
          style={{
            flex: 1,
            minWidth: 80,
            border: "none",
            outline: "none",
            fontSize: "0.85rem",
            background: "transparent",
          }}
        />
      </div>
      {note && (
        <div
          style={{
            fontSize: "0.7rem",
            opacity: 0.7,
            marginTop: 4,
          }}
        >
          {note}
        </div>
      )}
      {tags.length > 0 && (
        <button
          type="button"
          onClick={() => onChange("")}
          style={{
            marginTop: 4,
            fontSize: "0.7rem",
            textDecoration: "underline",
            background: "none",
            border: "none",
            padding: 0,
            cursor: "pointer",
            opacity: 0.7,
          }}
        >
          Șterge toate valorile
        </button>
      )}

      {openList && (
        <div className={styles.tagsList}>
          <div className={styles.tagsListHeader}>
            <span className={styles.tagsListHeaderTitle}>
              {label || "Sugestii"}
            </span>
            <button
              type="button"
              className={styles.tagsListCloseBtn}
              onClick={() => setOpenList(false)}
              aria-label="Închide lista de sugestii"
            >
              ×
            </button>
          </div>

          {suggestions.length > 0 ? (
            suggestions.map((opt) => (
              <div
                key={opt}
                className={styles.tagsListItem}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => addTag(opt)}
              >
                {opt}
              </div>
            ))
          ) : (
            inputValue && (
              <div className={styles.tagsListEmpty}>
                Nicio sugestie – poți folosi varianta tastată de tine.
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}

/* ====== SingleTagComboField: un singur chip (material / tehnică / culoare) ====== */
function SingleTagComboField({
  id,
  label,
  value, // string simplu
  onChange, // primește string simplu
  options, // [{ key, label }]
  placeholder,
  note,
}) {
  const [inputValue, setInputValue] = useState("");
  const [openList, setOpenList] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    setInputValue("");
  }, [value]);

  useEffect(() => {
    if (!openList) return;
    const handleClickOutside = (e) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target)) {
        setOpenList(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [openList]);

  const normalize = (s) =>
    String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();

  const suggestions = useMemo(() => {
    const q = normalize(inputValue);
    return options
      .filter((opt) => normalize(opt.label) !== normalize(value))
      .filter((opt) => !q || normalize(opt.label).includes(q))
      .slice(0, 50);
  }, [options, inputValue, value]);

  const setChip = (token) => {
    const norm = String(token || "").trim();
    onChange(norm);
    setInputValue("");
    setOpenList(false);
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      setChip(inputValue);
      return;
    }
    if (e.key === "Backspace" && !inputValue && value) {
      e.preventDefault();
      onChange("");
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setOpenList(false);
    }
  };

  return (
    <div ref={wrapRef} style={{ marginBottom: 12 }}>
      {label && (
        <label className={styles.label} htmlFor={id}>
          {label}
        </label>
      )}

      <div
        className={styles.input}
        style={{
          minHeight: 40,
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 6,
          paddingTop: 6,
          paddingBottom: 6,
        }}
        onClick={() => {
          setOpenList(true);
          const el = document.getElementById(id);
          if (el) el.focus();
        }}
      >
        {value && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "2px 8px",
              borderRadius: 999,
              fontSize: "0.75rem",
              background: "rgba(0,0,0,0.06)",
            }}
          >
            {value}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onChange("");
              }}
              style={{
                border: "none",
                background: "transparent",
                cursor: "pointer",
                fontSize: "0.8rem",
                lineHeight: 1,
                padding: 0,
              }}
              aria-label={`Șterge valoarea ${value}`}
            >
              ×
            </button>
          </span>
        )}

        <input
          id={id}
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value);
            setOpenList(true);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => {
            setTimeout(() => setOpenList(false), 120);
          }}
          placeholder={value ? "" : placeholder}
          style={{
            flex: 1,
            minWidth: 80,
            border: "none",
            outline: "none",
            fontSize: "0.85rem",
            background: "transparent",
          }}
        />
      </div>

      {note && (
        <div
          style={{
            fontSize: "0.7rem",
            opacity: 0.7,
            marginTop: 4,
          }}
        >
          {note}
        </div>
      )}

      {openList && suggestions.length > 0 && (
        <div
          style={{
            marginTop: 4,
            borderRadius: 6,
            border: "1px solid rgba(0,0,0,0.08)",
            background: "#fff",
            maxHeight: 200,
            overflowY: "auto",
            boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
            zIndex: 20,
            position: "relative",
          }}
        >
          {suggestions.map((opt) => (
            <div
              key={opt.key || opt.label}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setChip(opt.label)}
              style={{
                padding: "6px 10px",
                fontSize: "0.85rem",
                cursor: "pointer",
              }}
            >
              {opt.label}
            </div>
          ))}
        </div>
      )}

      {openList && suggestions.length === 0 && inputValue && (
        <div
          style={{
            marginTop: 4,
            padding: "6px 10px",
            fontSize: "0.8rem",
            borderRadius: 6,
            border: "1px solid rgba(0,0,0,0.08)",
            background: "#fff",
            color: "rgba(0,0,0,0.6)",
          }}
        >
          Nicio sugestie – poți folosi varianta tastată de tine.
        </div>
      )}
    </div>
  );
}

/* ====== Component principal: ProductEditModal ====== */
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
    availability: "READY", // READY | MADE_TO_ORDER | PREORDER | SOLD_OUT
    leadTimeDays: "",
    readyQty: "",
    nextShipDate: "",
    acceptsCustom: false,

    // detalii structurate
    materialMain: "",
    technique: "",
    styleTags: "", // CSV
    occasionTags: "", // CSV
    dimensions: "",
    careInstructions: "",
    specialNotes: "",
  });

  // === state pentru acordeoane – aliniat cu ProductModal ===
  const [sectionsOpen, setSectionsOpen] = useState({
    basic: false,
    details: false,
    availability: false,
    images: false,
  });

  const toggleSection = useCallback((key) => {
    setSectionsOpen((s) => ({ ...s, [key]: !s[key] }));
  }, []);

  // ===== DnD state =====
  const dragIndexRef = useRef(-1);

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

  const onDragOver = useCallback((e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

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
        basic: false,
        details: false,
        availability: false,
        images: false,
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

          availability: p?.availability || "READY",
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

  // Normalize availability (similar cu ProductModal)
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

  // SAVE
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
  const onPaste = useCallback((e) => {
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

  // Opțiuni constante pentru câmpuri structurate (ca în ProductModal)
  const materialOptions = useMemo(
    () => MATERIALS_DETAILED.map((m) => ({ key: m.key, label: m.label })),
    []
  );
  const techniqueOptions = useMemo(
    () => TECHNIQUES_DETAILED.map((t) => ({ key: t.key, label: t.label })),
    []
  );
  const colorOptions = useMemo(
    () => COLORS_DETAILED.map((c) => ({ key: c.key, label: c.label })),
    []
  );
  const styleOptions = useMemo(
    () => STYLE_TAGS_DETAILED.map((t) => t.label),
    []
  );
  const occasionOptions = useMemo(
    () => OCCASION_TAGS_DETAILED.map((t) => t.label),
    []
  );
  const careOptions = useMemo(
    () => CARE_TAGS_DETAILED.map((t) => t.label),
    []
  );

  return (
    <Modal
      open={open}
      onClose={() => (!saving ? onClose?.() : null)}
      maxWidth={700}
    >
      <div className={styles.modalHeader}>
        <h3 className={styles.modalTitle}>Editează produs</h3>
        <button
          className={styles.modalClose}
          onClick={() => (!saving ? onClose?.() : null)}
          disabled={saving}
          type="button"
          aria-label="Închide"
        >
          ×
        </button>
      </div>

      <div className={styles.modalBody}>
        {loading ? (
          <div>Se încarcă…</div>
        ) : error ? (
          <div style={{ color: "red", marginBottom: 8 }}>{error}</div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
            className={styles.formGrid}
          >
            {/* ===== Secțiunea 1: Informații de bază ===== */}
            <AccordionSection
              id="basic"
              title="Informații de bază"
              open={sectionsOpen.basic}
              onToggle={() => toggleSection("basic")}
            >
              <label className={styles.label} htmlFor="edit-title">
                Titlu
              </label>
              <input
                id="edit-title"
                className={styles.input}
                value={form.title}
                onChange={onField("title")}
                maxLength={120}
                required
              />

              <label className={styles.label} htmlFor="edit-price">
                Preț (RON)
              </label>
              <input
                id="edit-price"
                className={styles.input}
                type="number"
                min="0"
                step="0.01"
                value={form.price}
                onChange={onField("price")}
                required
              />

              <label className={styles.label} htmlFor="edit-currency">
                Monedă
              </label>
              <select
                id="edit-currency"
                className={styles.input}
                value={form.currency}
                onChange={onField("currency")}
              >
                <option value="RON">RON</option>
                <option value="EUR">EUR</option>
              </select>

              <label className={styles.label} htmlFor="edit-category">
                Categorie
              </label>
              <select
                id="edit-category"
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

              <label className={styles.label} htmlFor="edit-color">
                Culoare principală
              </label>
              <SingleTagComboField
                id="edit-color"
                label=""
                value={form.color || ""}
                onChange={(val) =>
                  setForm((s) => ({
                    ...s,
                    color: val,
                  }))
                }
                options={colorOptions}
                placeholder="ex: alb, verde salvie, roz pudră"
                note="Poți alege o culoare din sugestii sau poți scrie exact nuanța pe care o folosești."
              />

              <label className={styles.label}>Status vizibilitate</label>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  marginBottom: 8,
                }}
              >
                <label className={styles.checkbox}>
                  <input
                    type="checkbox"
                    checked={!!form.isActive}
                    onChange={onField("isActive")}
                  />
                  Activ
                  <small style={{ marginLeft: 8, opacity: 0.7 }}>
                    Produsul poate fi cumpărat (dacă este vizibil).
                  </small>
                </label>

                <label className={styles.checkbox}>
                  <input
                    type="checkbox"
                    checked={!!form.isHidden}
                    onChange={onField("isHidden")}
                  />
                  Ascuns
                  <small style={{ marginLeft: 8, opacity: 0.7 }}>
                    Nu apare public în magazin, chiar dacă este activ.
                  </small>
                </label>
              </div>
            </AccordionSection>

            {/* ===== Secțiunea 2: Detalii produs ===== */}
            <AccordionSection
              id="details"
              title="Detalii produs"
              open={sectionsOpen.details}
              onToggle={() => toggleSection("details")}
            >
              <label className={styles.label} htmlFor="edit-description">
                Descriere
              </label>
              <textarea
                id="edit-description"
                className={styles.textarea}
                value={form.description}
                onChange={onField("description")}
                rows={5}
              />

              {/* MATERIAL (single chip) */}
              <SingleTagComboField
                id="edit-material"
                label="Material principal"
                value={form.materialMain || ""}
                onChange={(val) =>
                  setForm((s) => ({ ...s, materialMain: val }))
                }
                options={materialOptions}
                placeholder="ex: lemn de pin, ceramică, bumbac organic"
                note="Poți alege un material din sugestii sau poți scrie exact materialul folosit, dacă nu se regăsește în listă."
              />

              {/* TEHNICĂ (single chip) */}
              <SingleTagComboField
                id="edit-technique"
                label="Tehnică / cum este lucrat"
                value={form.technique || ""}
                onChange={(val) =>
                  setForm((s) => ({ ...s, technique: val }))
                }
                options={techniqueOptions}
                placeholder="ex: pictat manual, croșetat, turnat în matriță"
                note="Poți selecta o tehnică din sugestii sau poți descrie liber metoda ta."
              />

              {/* STIL (multi-tag) */}
              <TagComboField
                id="edit-style-tags"
                label="Stil (tag-uri separate prin virgulă)"
                value={form.styleTags || ""}
                onChange={(val) =>
                  setForm((s) => ({ ...s, styleTags: val }))
                }
                options={styleOptions}
                placeholder="ex: rustic, boho, minimalist"
                note="Poți adăuga unul sau mai multe stiluri. Alege din sugestii sau scrie propriile variante; apasă Enter pentru a crea un tag."
              />

              {/* OCAZII (multi-tag) */}
              <TagComboField
                id="edit-occasion-tags"
                label="Ocazii (tag-uri separate prin virgulă)"
                value={form.occasionTags || ""}
                onChange={(val) =>
                  setForm((s) => ({ ...s, occasionTags: val }))
                }
                options={occasionOptions}
                placeholder="ex: cadou casă nouă, zi de naștere"
                note="Poți combina ocazii din sugestii sau poți adăuga altele noi scriindu-le și apăsând Enter."
              />

              <label className={styles.label} htmlFor="edit-dimensions">
                Dimensiuni
              </label>
              <input
                id="edit-dimensions"
                className={styles.input}
                value={form.dimensions || ""}
                onChange={onField("dimensions")}
                placeholder="ex: 20 x 30 cm"
              />

              {/* ÎNGRIJIRE (multi-tag) */}
              <TagComboField
                id="edit-care-instructions"
                label="Instrucțiuni de îngrijire"
                value={form.careInstructions || ""}
                onChange={(val) =>
                  setForm((s) => ({ ...s, careInstructions: val }))
                }
                options={careOptions}
                placeholder="ex: șterge ușor cu o cârpă umedă"
                note="Poți alege una sau mai multe instrucțiuni din sugestii sau poți scrie propriile recomandări (Enter pentru a crea un tag)."
              />

              <label className={styles.label} htmlFor="edit-notes">
                Note speciale
              </label>
              <textarea
                id="edit-notes"
                className={styles.textarea}
                value={form.specialNotes || ""}
                onChange={onField("specialNotes")}
                rows={3}
                placeholder="ex: fiecare piesă este unică, pot apărea mici variații față de fotografie"
              />

              {generatedDescription && (
                <div className={styles.generatedWrap}>
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
                      marginBottom: 6,
                    }}
                  >
                    {generatedDescription}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      fontSize: "0.75rem",
                      opacity: 0.85,
                    }}
                  >
                    <span>
                      Poți copia textul de mai sus în câmpul „Descriere” și să
                      îl ajustezi.
                    </span>
                  </div>
                </div>
              )}

              <label className={styles.checkbox}>
                <input
                  type="checkbox"
                  checked={!!form.acceptsCustom}
                  onChange={onField("acceptsCustom")}
                />
                Acceptă personalizare
              </label>
            </AccordionSection>

            {/* ===== Secțiunea 3: Disponibilitate & stoc ===== */}
            <AccordionSection
              id="availability"
              title="Disponibilitate & stoc"
              open={sectionsOpen.availability}
              onToggle={() => toggleSection("availability")}
            >
              <label className={styles.label} htmlFor="edit-availability">
                Disponibilitate
              </label>
              <select
                id="edit-availability"
                className={styles.input}
                value={form.availability}
                onChange={onField("availability")}
              >
                <option value="READY">Gata de livrare</option>
                <option value="MADE_TO_ORDER">La comandă</option>
                <option value="PREORDER">Precomandă</option>
                <option value="SOLD_OUT">Epuizat</option>
              </select>

              {form.availability === "READY" && (
                <>
                  <label className={styles.label} htmlFor="edit-ready-qty">
                    Bucăți gata de livrare
                  </label>
                  <input
                    id="edit-ready-qty"
                    className={styles.input}
                    type="number"
                    min={0}
                    step={1}
                    value={form.readyQty}
                    onChange={onField("readyQty")}
                    placeholder="(lăsat gol = necunoscut)"
                  />
                </>
              )}

              {form.availability === "MADE_TO_ORDER" && (
                <>
                  <label className={styles.label} htmlFor="edit-lead-time">
                    Timp de execuție (zile)
                  </label>
                  <input
                    id="edit-lead-time"
                    className={styles.input}
                    type="number"
                    min={1}
                    step={1}
                    value={form.leadTimeDays}
                    onChange={onField("leadTimeDays")}
                    placeholder="ex: 5"
                  />
                </>
              )}

              {form.availability === "PREORDER" && (
                <>
                  <label
                    className={styles.label}
                    htmlFor="edit-next-ship-date"
                  >
                    Data estimată de expediere
                  </label>
                  <input
                    id="edit-next-ship-date"
                    className={styles.input}
                    type="date"
                    value={form.nextShipDate || ""}
                    onChange={onField("nextShipDate")}
                  />
                </>
              )}
            </AccordionSection>

            {/* ===== Secțiunea 4: Imagini ===== */}
            <AccordionSection
              id="images"
              title="Imagini"
              open={sectionsOpen.images}
              onToggle={() => toggleSection("images")}
            >
              <label className={styles.label}>Imagini produs (max 12)</label>
              <div className={styles.imagesRow} onPaste={onPaste}>
                <button
                  type="button"
                  className={styles.smallBtn}
                  onClick={addImage}
                >
                  + Adaugă URL imagine
                </button>

                {!!form.images?.length && (
                  <div className={styles.thumbGrid}>
                    {form.images.map((img, idx) => (
                      <div
                        key={`${img}-${idx}`}
                        className={styles.thumbItem}
                        draggable
                        onDragStart={onDragStart(idx)}
                        onDragOver={onDragOver}
                        onDrop={onDrop(idx)}
                        title={
                          idx === 0
                            ? "Imagine principală"
                            : "Trage pentru a reordona"
                        }
                      >
                        <img
                          src={img}
                          alt={`Imagine produs ${idx + 1}`}
                          className={styles.thumbImg}
                        />
                        <div
                          style={{
                            display: "flex",
                            gap: 6,
                            marginTop: 6,
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => setMainImage(idx)}
                            title={
                              idx === 0
                                ? "Deja principală"
                                : "Setează ca principală"
                            }
                            className={styles.smallBtn}
                            style={{
                              fontWeight: idx === 0 ? 800 : 500,
                            }}
                          >
                            {idx === 0 ? "★ Cover" : "☆ Cover"}
                          </button>
                          <button
                            type="button"
                            onClick={() => removeImage(idx)}
                            title="Șterge imagine"
                            className={styles.smallBtn}
                          >
                            Șterge
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className={styles.tip}>
                  • Poți lipi (paste) un URL de imagine direct aici.<br />
                  • Reordonează cu drag &amp; drop. ★ marchează imaginea
                  principală (prima în listă).
                </div>
              </div>
            </AccordionSection>

            {/* ===== Footer ===== */}
            <div className={styles.modalFooter}>
              <button
                type="button"
                className={styles.linkBtn}
                onClick={() => (!saving ? onClose?.() : null)}
                disabled={saving}
              >
                Anulează
              </button>
              <button
                className={styles.primaryBtn}
                type="submit"
                disabled={saving || loading || !changed}
                title={!changed ? "Nicio modificare" : "Salvează"}
              >
                {saving ? "Se salvează…" : "Salvează"}
              </button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
}
