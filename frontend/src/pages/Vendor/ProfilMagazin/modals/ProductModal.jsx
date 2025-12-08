/**
 * ProductModal cu secțiuni în acordeon + câmpuri cu constante (autocomplete + chips)
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";
import Modal from "../ui/Modal";
import styles from "../components/css/ProductModal.module.css";
import { resolveFileUrl } from "../hooks/useProfilMagazin";
import { uploadFile as uploadFileHelper } from "../../../../lib/uploadFile";
import { api } from "../../../../lib/api"; // 👈 NOU: pentru a citi TVA din billing

// IMPORTURI CONSTANTE (ajustează path-urile dacă e nevoie)
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

// ====== Mic component de acordeon pentru secțiuni ======
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
        <span className={styles.sectionToggleIcon}>
          {open ? "−" : "+"}
        </span>
      </button>
      <div
        id={`${id}-body`}
        className={
          open ? styles.sectionBody : styles.sectionBodyCollapsed
        }
      >
        {children}
      </div>
    </section>
  );
}

// ====== TagComboField: multi-tag (stil / ocazii / îngrijire) ======
function TagComboField({
  id,
  label,
  value,      // CSV: "a, b, c"
  onChange,   // primește CSV
  options,    // array de string (labeluri)
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
          {/* HEADER + BUTON ÎNCHIDE */}
          <div
            style={{
              position: "sticky",
              top: 0,
              zIndex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "6px 10px",
              borderBottom: "1px solid rgba(0,0,0,0.06)",
              background: "#fafafa",
              fontSize: "0.8rem",
            }}
          >
            <span style={{ fontWeight: 600 }}>
              {label || "Sugestii"}
            </span>
            <button
              type="button"
              onClick={() => setOpenList(false)}
              aria-label="Închide lista de sugestii"
              style={{
                border: "none",
                background: "transparent",
                cursor: "pointer",
                fontSize: "1rem",
                lineHeight: 1,
                padding: "0 4px",
                opacity: 0.7,
              }}
            >
              ×
            </button>
          </div>

          {suggestions.length > 0 ? (
            suggestions.map((opt) => (
              <div
                key={opt}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => addTag(opt)}
                style={{
                  padding: "6px 10px",
                  fontSize: "0.85rem",
                  cursor: "pointer",
                }}
              >
                {opt}
              </div>
            ))
          ) : (
            inputValue && (
              <div
                style={{
                  padding: "6px 10px",
                  fontSize: "0.8rem",
                  color: "rgba(0,0,0,0.6)",
                }}
              >
                Nicio sugestie – poți folosi varianta tastată de tine.
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}

// ====== SingleTagComboField: un singur chip (material / tehnică / culoare) ======
function SingleTagComboField({
  id,
  label,
  value,      // string simplu
  onChange,   // primește string simplu
  options,    // [{ key, label }]
  placeholder,
  note,
  useOptionKeyAsValue = false, // 👈 nou: doar pentru câmpuri care trimit key la backend
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

  const labelForValue = useMemo(() => {
    if (!value) return "";
    const match = options.find(
      (opt) =>
        normalize(opt.key) === normalize(value) ||
        normalize(opt.label) === normalize(value)
    );
    return match?.label || value || "";
  }, [options, value]);

  const suggestions = useMemo(() => {
    const q = normalize(inputValue);
    return options
      .filter((opt) => normalize(opt.label) !== normalize(value))
      .filter((opt) => !q || normalize(opt.label).includes(q))
      .slice(0, 50);
  }, [options, inputValue, value]);

  const setChip = (token) => {
    const norm = String(token || "").trim();
    if (!norm) {
      onChange("");
      setInputValue("");
      setOpenList(false);
      return;
    }

    const matched = options.find(
      (opt) =>
        normalize(opt.label) === normalize(norm) ||
        normalize(opt.key) === normalize(norm)
    );

    const valueToSave = matched
      ? useOptionKeyAsValue
        ? matched.key      // 👈 pentru colors: salvăm key
        : matched.label    // pentru material/tehnică: salvăm label
      : norm;              // fallback: free text

    onChange(valueToSave);
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
            {labelForValue}
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
            // mic delay ca să permită click pe sugestie
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
              onClick={() => setChip(opt.key)}
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

export default function ProductModal({
  open,
  onClose,
  saving,
  editingProduct,
  form,
  setForm,
  categories = [],
  onSave,
  uploadFile, // optional override
}) {
  const doUpload = uploadFile || uploadFileHelper;

  // ==== helper general pentru câmpuri simple ====
  const updateField = useCallback(
    (field) => (e) => {
      const value = e?.target?.value ?? e;
      setForm((s) => ({ ...s, [field]: value }));
    },
    [setForm]
  );

  // starea de deschidere pentru secțiunile acordeonului
  const [openSections, setOpenSections] = useState({
    basic: false,
    details: false,
    category: false,
    availability: false,
    images: false,
  });

  const toggleSection = useCallback((key) => {
    setOpenSections((s) => ({ ...s, [key]: !s[key] }));
  }, []);

  // când se deschide modalul, resetăm secțiunile
  useEffect(() => {
    if (open) {
      setOpenSections({
        basic: false,
        details: false,
        category: false,
        availability: false,
        images: false,
      });
    }
  }, [open]);

  // ================= TVA din date de facturare =================
  const [vatState, setVatState] = useState({
    loading: false,
    error: "",
    status: null, // "payer" | "non_payer" | null
    rate: null,   // număr (ex: 19)
  });

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setVatState((s) => ({ ...s, loading: true, error: "" }));

    (async () => {
      try {
        const resp = await api("/api/vendors/me/billing", {
          method: "GET",
        });
        if (!alive) return;
        const billing = resp?.billing;
        if (billing) {
          const r = billing.vatRate ? Number(billing.vatRate) : null;
          setVatState({
            loading: false,
            error: "",
            status: billing.vatStatus || null,
            rate: Number.isFinite(r) ? r : null,
          });
        } else {
          setVatState({
            loading: false,
            error: "",
            status: null,
            rate: null,
          });
        }
      } catch (e) {
        if (!alive) return;
        setVatState({
          loading: false,
          error:
            e?.message ||
            "Nu am putut încărca informațiile de TVA ale magazinului.",
          status: null,
          rate: null,
        });
      }
    })();

    return () => {
      alive = false;
    };
  }, [open]);

  // Calcul TVA plecând de la ideea că prețul introdus este PREȚ FINAL CU TVA
  const vatComputed = useMemo(() => {
    const gross = Number(form.price) || 0;
    const rate =
      vatState.status === "payer" && vatState.rate
        ? vatState.rate
        : 0;

    if (!gross || !rate) {
      return {
        gross,
        rate,
        net: gross,
        vatAmount: 0,
      };
    }

    const factor = 1 + rate / 100;
    const net = +(gross / factor).toFixed(2);
    const vatAmount = +(gross - net).toFixed(2);

    return { gross, rate, net, vatAmount };
  }, [form.price, vatState.status, vatState.rate]);

  const { gross, rate: vatRateNum, net, vatAmount } = vatComputed;

  // ============================================================

  // Detectăm forma categoriilor
  const isDetailed =
    Array.isArray(categories) &&
    categories.length > 0 &&
    typeof categories[0] === "object" &&
    categories[0] !== null &&
    "key" in categories[0];

  // Normalizăm într-o listă de opțiuni { key, label, group, groupLabel }
  const options = useMemo(() => {
    if (isDetailed) {
      return categories.map((c) => ({
        key: c.key,
        label: c.label || c.key,
        group: c.group || "alte",
        groupLabel: c.groupLabel || "Altele",
      }));
    }
    return categories.map((k) => ({
      key: k,
      label: k,
      group: "alte",
      groupLabel: "Altele",
    }));
  }, [categories, isDetailed]);

  const getLabelFor = useCallback(
    (key) => options.find((o) => o.key === key)?.label || key || "",
    [options]
  );

  // ===== Combobox state (categorie) =====
  const [query, setQuery] = useState("");
  const [openList, setOpenList] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // Drop-up calc
  const wrapRef = useRef(null);
  const [openUp, setOpenUp] = useState(false);
  const [listMaxH, setListMaxH] = useState(320);

  const computeComboDirection = useCallback(() => {
    if (!wrapRef.current) return;
    const r = wrapRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom;
    const spaceAbove = r.top;
    const desired = 320;
    const useUp = spaceBelow < 220 && spaceAbove > spaceBelow;
    setOpenUp(useUp);
    const maxH = Math.max(
      160,
      Math.min(desired, (useUp ? spaceAbove : spaceBelow) - 12)
    );
    setListMaxH(maxH);
  }, []);

  useEffect(() => {
    if (!openList) return;
    computeComboDirection();
    const onWin = () => computeComboDirection();
    window.addEventListener("resize", onWin);
    window.addEventListener("scroll", onWin, { passive: true });
    return () => {
      window.removeEventListener("resize", onWin);
      window.removeEventListener("scroll", onWin);
    };
  }, [openList, computeComboDirection]);

  // închidere la click în afara combobox-ului categorie
  useEffect(() => {
    if (!openList) return;
    const handleClickOutside = (e) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target)) {
        setOpenList(false);
        setActiveIndex(-1);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [openList]);

  // Pornește cu labelul categoriei curente
  useEffect(() => {
    if (!form?.category) {
      setQuery("");
      return;
    }
    setQuery(getLabelFor(form.category));
  }, [form?.category, getLabelFor]);

  // Filtrare tolerantă la diacritice pt. categorii
  const normalize = useCallback(
    (s) =>
      String(s || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase(),
    []
  );

  const filtered = useMemo(() => {
    const q = normalize(query);
    if (!q) return options;
    return options.filter(
      (o) =>
        normalize(o.label).includes(q) ||
        normalize(o.key).includes(q) ||
        normalize(o.groupLabel).includes(q)
    );
  }, [options, query, normalize]);

  // Grupare pentru afișare (categorii)
  const grouped = useMemo(() => {
    const by = new Map();
    for (const o of filtered) {
      const g = o.group || "alte";
      const gl = o.groupLabel || "Altele";
      if (!by.has(g)) by.set(g, { group: g, groupLabel: gl, items: [] });
      by.get(g).items.push(o);
    }
    return Array.from(by.values()).sort((a, b) =>
      (a.groupLabel || "").localeCompare(b.groupLabel || "", "ro")
    );
  }, [filtered]);

  // Listă liniară pentru navigare cu tastatura
  const flatWithHeaders = useMemo(() => {
    const arr = [];
    for (const g of grouped) {
      arr.push({ __type: "header", groupLabel: g.groupLabel });
      for (const it of g.items.sort((a, b) =>
        a.label.localeCompare(b.label, "ro")
      )) {
        arr.push({ __type: "item", item: it });
      }
    }
    return arr;
  }, [grouped]);

  // Când deschidem lista, setăm primul "item" ca activ
  useEffect(() => {
    if (openList) {
      setActiveIndex(flatWithHeaders.findIndex((x) => x.__type === "item"));
    }
  }, [openList, flatWithHeaders]);

  // Select categorie
  const selectOption = useCallback(
    (opt) => {
      if (!opt) return;
      setForm((s) => ({ ...s, category: opt.key }));
      setQuery(opt.label);
      setOpenList(false);
      setActiveIndex(-1);
    },
    [setForm]
  );

  // Keyboard pe input (combobox)
  const onInputKeyDown = useCallback(
    (e) => {
      if (!openList && ["ArrowDown", "ArrowUp"].includes(e.key)) {
        setOpenList(true);
        e.preventDefault();
        return;
      }
      if (!openList) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        let next = activeIndex + 1;
        while (
          next < flatWithHeaders.length &&
          flatWithHeaders[next].__type !== "item"
        )
          next++;
        if (next < flatWithHeaders.length) setActiveIndex(next);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        let prev = activeIndex - 1;
        while (prev >= 0 && flatWithHeaders[prev].__type !== "item") prev--;
        if (prev >= 0) setActiveIndex(prev);
      } else if (e.key === "Enter") {
        e.preventDefault();
        const cur = flatWithHeaders[activeIndex];
        if (cur && cur.__type === "item") selectOption(cur.item);
      } else if (e.key === "Escape") {
        e.preventDefault();
        setOpenList(false);
        setActiveIndex(-1);
      }
    },
    [openList, activeIndex, flatWithHeaders, selectOption]
  );

  // Opțiuni pentru câmpurile cu constante (single chip + multi-tag)
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

  // ====== Images: DnD + Paste + Main image ======
  const dragIndexRef = useRef(-1);

  const setMainImage = useCallback(
    (idx) => {
      setForm((s) => {
        if (!Array.isArray(s.images) || idx < 0 || idx >= s.images.length)
          return s;
        if (idx === 0) return s;
        const arr = [...s.images];
        const [it] = arr.splice(idx, 1);
        arr.unshift(it);
        return { ...s, images: arr };
      });
    },
    [setForm]
  );

  const removeImage = useCallback(
    (idx) => {
      setForm((s) => ({
        ...s,
        images: s.images.filter((_, i) => i !== idx),
      }));
    },
    [setForm]
  );

  const moveImage = useCallback(
    (from, to) => {
      setForm((s) => {
        const arr = [...s.images];
        if (from === to || to < 0 || to >= arr.length) return s;
        const [it] = arr.splice(from, 1);
        arr.splice(to, 0, it);
        return { ...s, images: arr };
      });
    },
    [setForm]
  );

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

  // Upload handler stabil
  const onFilesPicked = useCallback(
    async (files) => {
      if (!files?.length) return;
      for (const f of files) {
        if (!/^image\//i.test(f.type)) continue;
        let url;
        try {
          url = await doUpload(f);
        } catch (er) {
          console.error(er);
          alert(er?.message || "Upload eșuat.");
          continue;
        }
        setForm((s) => ({
          ...s,
          images: [...(s.images || []), url],
        }));
      }
    },
    [doUpload, setForm]
  );

  // PASTE: URL sau fișiere image/*
  const onPasteImages = useCallback(
    async (e) => {
      const text = e.clipboardData?.getData("text")?.trim();
      if (text && /^(https?:\/\/|\/)/i.test(text)) {
        setForm((s) => ({
          ...s,
          images: [...(s.images || []), text],
        }));
        return;
      }
      const files = Array.from(e.clipboardData?.files || []).filter((f) =>
        /^image\//i.test(f.type)
      );
      if (!files.length) return;
      e.preventDefault();
      await onFilesPicked(files);
    },
    [onFilesPicked, setForm]
  );

  // normalizează câmpurile când se schimbă availability
  useEffect(() => {
    setForm((s) => {
      const av = s.availability;
      if (!av) return s;

      const next = { ...s };

      if (av === "READY") {
        next.leadTimeDays = "";
        next.nextShipDate = "";
        next.readyQty =
          next.readyQty === "" || !Number.isFinite(Number(next.readyQty))
            ? null
            : Math.max(0, Number(next.readyQty));
      } else if (av === "MADE_TO_ORDER") {
        next.readyQty = 0;
        next.nextShipDate = "";
        if (
          !Number.isFinite(Number(next.leadTimeDays)) ||
          Number(next.leadTimeDays) < 1
        ) {
          next.leadTimeDays = "";
        }
      } else if (av === "PREORDER") {
        next.readyQty = 0;
        next.leadTimeDays = "";
      } else if (av === "SOLD_OUT") {
        next.readyQty = 0;
        next.leadTimeDays = "";
        next.nextShipDate = "";
      }

      return next;
    });
  }, [setForm, form.availability]);

  const [uploadInfo, setUploadInfo] = useState("Niciun fișier ales");

  return (
    <Modal
      open={open}
      onClose={() => (!saving ? onClose() : null)}
      maxWidth={700}
    >
      <div className={styles.modalHeader}>
        <h3 className={styles.modalTitle}>
          {editingProduct ? "Editează produs" : "Adaugă produs"}
        </h3>
        <button
          className={styles.modalClose}
          onClick={() => (!saving ? onClose() : null)}
          disabled={saving}
          type="button"
          aria-label="Închide"
        >
          ×
        </button>
      </div>

      <div className={styles.modalBody}>
        <form onSubmit={onSave} className={styles.formGrid}>
          {/* ===== Secțiunea 1: Informații de bază ===== */}
          <AccordionSection
            id="basic"
            title="Informații de bază"
            open={openSections.basic}
            onToggle={() => toggleSection("basic")}
          >
            <label className={styles.label} htmlFor="product-title">
              Titlu
            </label>
            <input
              id="product-title"
              className={styles.input}
              value={form.title}
              onChange={updateField("title")}
              placeholder="Ex: Coroniță florală din lavandă"
              required
            />

            <label className={styles.label} htmlFor="product-price">
              Preț (RON)
            </label>
            <input
              id="product-price"
              type="number"
              step="0.01"
              min="0"
              className={styles.input}
              value={
                Number.isFinite(Number(form.price))
                  ? String(form.price)
                  : ""
              }
              onChange={(e) => {
                const v = Math.max(0, Number(e.target.value || 0));
                setForm((s) => ({ ...s, price: v }));
              }}
              placeholder="0.00"
              required
            />

            {/* 👇 Aici afișăm clar TVA-ul, pe baza datelor din billing */}
            <div
              style={{
                fontSize: "0.78rem",
                marginTop: 4,
                marginBottom: 8,
                color: "#4B5563",
                lineHeight: 1.4,
              }}
            >
              {vatState.loading ? (
                <span>Se încarcă setările de TVA ale magazinului…</span>
              ) : vatState.status === "payer" && vatRateNum ? (
                <>
                  <div>
                    Conform datelor de facturare, magazinul este{" "}
                    <strong>plătitor de TVA</strong>, cotă{" "}
                    <strong>{vatRateNum}%</strong>.
                  </div>
                  {gross > 0 && (
                    <div style={{ marginTop: 2 }}>
                      Pentru prețul introdus:{" "}
                      <strong>{net.toFixed(2)} RON</strong> (fără TVA) +{" "}
                      <strong>{vatAmount.toFixed(2)} RON</strong> TVA (
                      {vatRateNum}%) ={" "}
                      <strong>{gross.toFixed(2)} RON</strong> (preț
                      final).
                    </div>
                  )}
                </>
              ) : vatState.status === "non_payer" ? (
                <div>
                  Conform datelor de facturare,{" "}
                  <strong>nu ești plătitor de TVA</strong>. Prețul
                  introdus este tratat ca sumă finală (nu se evidențiază
                  TVA separat pe factură).
                </div>
              ) : (
                <div>
                  Nu am găsit informații despre statutul tău de TVA în{" "}
                  <strong>Date facturare</strong>. Completează acea
                  secțiune pentru a vedea detaliat TVA-ul aferent
                  produselor.
                </div>
              )}
              {vatState.error && (
                <div
                  style={{
                    marginTop: 2,
                    color: "#B91C1C",
                  }}
                >
                  {vatState.error}
                </div>
              )}
            </div>

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
                  onChange={(e) =>
                    setForm((s) => {
                      const checked = e.target.checked;
                      return {
                        ...s,
                        isActive: checked,
                        // dacă activ devine true, ascuns devine false
                        isHidden: checked ? false : s.isHidden,
                      };
                    })
                  }
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
                  onChange={(e) =>
                    setForm((s) => {
                      const checked = e.target.checked;
                      return {
                        ...s,
                        isHidden: checked,
                        // dacă ascuns devine true, activ devine false
                        isActive: checked ? false : s.isActive,
                      };
                    })
                  }
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
            open={openSections.details}
            onToggle={() => toggleSection("details")}
          >
            <label className={styles.label} htmlFor="product-description">
              Descriere
            </label>
            <textarea
              id="product-description"
              className={styles.textarea}
              value={form.description}
              onChange={updateField("description")}
              placeholder="Detalii despre material, dimensiuni, personalizare etc."
              rows={5}
            />

            {/* MATERIAL (single chip) */}
            <SingleTagComboField
              id="product-material"
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
              id="product-technique"
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
              id="product-style-tags"
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
              id="product-occasion-tags"
              label="Ocazii (tag-uri separate prin virgulă)"
              value={form.occasionTags || ""}
              onChange={(val) =>
                setForm((s) => ({ ...s, occasionTags: val }))
              }
              options={occasionOptions}
              placeholder="ex: cadou casă nouă, zi de naștere"
              note="Poți combina ocazii din sugestii sau poți adăuga altele noi scriindu-le și apăsând Enter."
            />

            <label className={styles.label} htmlFor="product-dimensions">
              Dimensiuni
            </label>
            <input
              id="product-dimensions"
              className={styles.input}
              value={form.dimensions || ""}
              onChange={updateField("dimensions")}
              placeholder="ex: 20 x 30 cm"
            />

            {/* ÎNGRIJIRE (multi-tag) */}
            <TagComboField
              id="product-care-instructions"
              label="Instrucțiuni de îngrijire"
              value={form.careInstructions || ""}
              onChange={(val) =>
                setForm((s) => ({ ...s, careInstructions: val }))
              }
              options={careOptions}
              placeholder="ex: șterge ușor cu o cârpă umedă"
              note="Poți alege una sau mai multe instrucțiuni din sugestii sau poți scrie propriile recomandări (Enter pentru a crea un tag)."
            />

            <label className={styles.label} htmlFor="product-notes">
              Note speciale
            </label>
            <textarea
              id="product-notes"
              className={styles.textarea}
              value={form.specialNotes || ""}
              onChange={updateField("specialNotes")}
              rows={3}
              placeholder="ex: fiecare piesă este unică, pot apărea mici variații față de fotografie"
            />

            {/* CULOARE (single chip) */}
            <SingleTagComboField
              id="product-color"
              label="Culoare principală"
              value={form.color || ""}
              onChange={(val) =>
                setForm((s) => ({ ...s, color: val }))
              }
              options={colorOptions}
              useOptionKeyAsValue={true}
              placeholder="ex: alb, verde salvie, roz pudră"
              note="Poți alege o culoare din sugestii sau poți scrie exact nuanța pe care o folosești."
            />

            <label className={styles.checkbox}>
              <input
                type="checkbox"
                checked={!!form.acceptsCustom}
                onChange={(e) =>
                  setForm((s) => ({
                    ...s,
                    acceptsCustom: e.target.checked,
                  }))
                }
              />
              Acceptă personalizare
            </label>
          </AccordionSection>

          {/* ===== Secțiunea 3: Categorie ===== */}
          <AccordionSection
            id="category"
            title="Categorie"
            open={openSections.category}
            onToggle={() => toggleSection("category")}
          >
            <label
              className={styles.label}
              htmlFor="category-combobox-input"
            >
              Categorie
            </label>
            <div ref={wrapRef} className={styles.comboWrap}>
              <div
                role="combobox"
                aria-haspopup="listbox"
                aria-expanded={openList}
                aria-owns="category-combobox-list"
                aria-controls="category-combobox-list"
                aria-activedescendant={
                  activeIndex >= 0 &&
                  flatWithHeaders[activeIndex]?.__type === "item"
                    ? `cat-opt-${activeIndex}`
                    : undefined
                }
                aria-label="Alege sau caută o categorie"
                className={styles.comboRow}
              >
                <input
                  id="category-combobox-input"
                  ref={inputRef}
                  className={`${styles.input} ${styles.comboInput}`}
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setOpenList(true);
                  }}
                  onFocus={() => setOpenList(true)}
                  onKeyDown={onInputKeyDown}
                  onBlur={() => {
                    // mic delay ca să nu se închidă înainte de click pe opțiune
                    setTimeout(() => {
                      setOpenList(false);
                      setActiveIndex(-1);
                    }, 120);
                  }}
                  placeholder="Caută categorie (tastează)…"
                  autoComplete="off"
                />

                {query && (
                  <button
                    type="button"
                    onClick={() => {
                      setQuery("");
                      setActiveIndex(-1);
                      setOpenList(true);
                    }}
                    className={styles.comboClearBtn}
                    title="Șterge căutarea"
                    aria-label="Șterge căutarea"
                    disabled={saving}
                  >
                    Șterge
                  </button>
                )}
              </div>

              <div
                style={{
                  fontSize: "0.75rem",
                  opacity: 0.7,
                  marginTop: 4,
                  marginBottom: 4,
                }}
              >
                Alege din listă sau tastează pentru a căuta
                categoria dorită.
              </div>

              {openList && (
                <div
                  ref={listRef}
                  id="category-combobox-list"
                  role="listbox"
                  className={`${styles.comboList} ${
                    openUp ? styles.comboListUp : ""
                  }`}
                  style={{ maxHeight: listMaxH }}
                >
                  {flatWithHeaders.length === 0 && (
                    <div
                      className={`${styles.comboOption} ${styles.comboEmpty}`}
                      aria-disabled="true"
                    >
                      Nicio categorie găsită.
                    </div>
                  )}

                  {flatWithHeaders.map((row, idx) => {
                    if (row.__type === "header") {
                      return (
                        <div
                          key={`h-${idx}-${row.groupLabel}`}
                          aria-hidden
                          className={styles.comboHeader}
                        >
                          {row.groupLabel}
                        </div>
                      );
                    }

                    const opt = row.item;
                    const isActive = idx === activeIndex;
                    const optionId = `cat-opt-${idx}`;

                    return (
                      <div
                        id={optionId}
                        key={`${opt.key}-${idx}`}
                        role="option"
                        aria-selected={isActive}
                        onMouseEnter={() => setActiveIndex(idx)}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => selectOption(opt)}
                        className={`${styles.comboOption} ${
                          isActive ? styles.comboOptionActive : ""
                        }`}
                        title={opt.key}
                      >
                        {opt.label}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* select "invizibil" pentru required + fallback */}
              <select
                tabIndex={-1}
                aria-hidden="true"
                className="sr-only"
                style={{
                  position: "absolute",
                  opacity: 0,
                  pointerEvents: "none",
                  height: 0,
                  width: 0,
                }}
                value={form.category || ""}
                onChange={() => {}}
                required
              >
                <option value="">Alege categorie</option>
                {options.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </AccordionSection>

          {/* ===== Secțiunea 4: Disponibilitate & stoc ===== */}
          <AccordionSection
            id="availability"
            title="Disponibilitate & stoc"
            open={openSections.availability}
            onToggle={() => toggleSection("availability")}
          >
            <label
              className={styles.label}
              htmlFor="product-availability"
            >
              Disponibilitate
            </label>
            <select
              id="product-availability"
              className={styles.input}
              value={form.availability}
              onChange={updateField("availability")}
            >
              <option value="READY">Gata de livrare</option>
              <option value="MADE_TO_ORDER">La comandă</option>
              <option value="PREORDER">Precomandă</option>
              <option value="SOLD_OUT">Epuizat</option>
            </select>

            {form.availability === "READY" && (
              <>
                <label
                  className={styles.label}
                  htmlFor="product-ready-qty"
                >
                  Bucăți gata de livrare
                </label>
                <input
                  id="product-ready-qty"
                  type="number"
                  min={0}
                  step={1}
                  className={styles.input}
                  value={
                    form.readyQty == null ? "" : String(form.readyQty)
                  }
                  onChange={(e) =>
                    setForm((s) => ({
                      ...s,
                      readyQty: Math.max(
                        0,
                        Number(e.target.value || 0)
                      ),
                    }))
                  }
                />
              </>
            )}

            {form.availability === "MADE_TO_ORDER" && (
              <>
                <label
                  className={styles.label}
                  htmlFor="product-lead-time"
                >
                  Timp de execuție (zile)
                </label>
                <input
                  id="product-lead-time"
                  type="number"
                  min={1}
                  step={1}
                  className={styles.input}
                  value={
                    Number.isFinite(Number(form.leadTimeDays))
                      ? String(form.leadTimeDays)
                      : ""
                  }
                  onChange={(e) =>
                    setForm((s) => ({
                      ...s,
                      leadTimeDays: Math.max(
                        1,
                        Number(e.target.value || 1)
                      ),
                    }))
                  }
                  placeholder="ex: 5"
                />
              </>
            )}

            {form.availability === "PREORDER" && (
              <>
                <label
                  className={styles.label}
                  htmlFor="product-next-ship-date"
                >
                  Data estimată de expediere
                </label>
                <input
                  id="product-next-ship-date"
                  type="date"
                  className={styles.input}
                  value={form.nextShipDate || ""}
                  onChange={updateField("nextShipDate")}
                />
              </>
            )}
          </AccordionSection>

          {/* ===== Secțiunea 5: Imagini ===== */}
          <AccordionSection
            id="images"
            title="Imagini"
            open={openSections.images}
            onToggle={() => toggleSection("images")}
          >
            <label className={styles.label}>Imagini produs</label>

            <div className={styles.imagesRow} onPaste={onPasteImages}>
              {/* butonul custom + text separat */}
              <div className={styles.fileUploadWrapper}>
                <input
                  id="product-images-input"
                  type="file"
                  accept="image/*"
                  multiple
                  className={styles.fileInputHidden}
                  onChange={async (e) => {
                    const files = Array.from(e.target.files || []);

                    if (files.length === 0) {
                      setUploadInfo("Niciun fișier ales");
                    } else if (files.length === 1) {
                      setUploadInfo(files[0].name);
                    } else {
                      setUploadInfo(
                        `${files.length} fișiere selectate`
                      );
                    }

                    // resetăm inputul ca să poți alege din nou aceleași fișiere
                    e.target.value = "";
                    await onFilesPicked(files);
                  }}
                />

                <label
                  htmlFor="product-images-input"
                  className={styles.fileUploadButton}
                >
                  Alegeți fișierele
                </label>

                <span className={styles.fileUploadInfo}>
                  {uploadInfo}
                </span>
              </div>

              {/* thumbnails, dacă există imagini */}
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
                        src={resolveFileUrl(img)}
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
                          {idx === 0 ? "★ " : "☆ "}
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
                • Poți încărca imagini (input sau paste din clipboard).
                <br />
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
              onClick={() => (!saving ? onClose() : null)}
              disabled={saving}
            >
              Anulează
            </button>
            <button
              className={styles.primaryBtn}
              type="submit"
              disabled={saving}
            >
              {saving ? "Se salvează…" : "Salvează"}
            </button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
