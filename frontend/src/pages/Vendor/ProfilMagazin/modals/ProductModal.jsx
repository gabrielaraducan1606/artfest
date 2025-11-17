/**
 * ProductModal cu secțiuni în acordeon
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

// Sugestie de descriere din câmpurile structurate
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

  // când se deschide modalul, poți reseta secțiunile dacă vrei
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

  // ===== Combobox state =====
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

  // închidere la click în afara combobox-ului
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

  // Pornește cu labelul categoriei curente
  useEffect(() => {
    if (!form?.category) {
      setQuery("");
      return;
    }
    setQuery(getLabelFor(form.category));
  }, [form?.category, getLabelFor]);

  // Filtrare tolerantă la diacritice
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

  // Grupare pentru afișare
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

  // Select
  const selectOption = useCallback(
    (opt) => {
      if (!opt) return;
      setForm((s) => ({ ...s, category: opt.key }));
      setQuery(opt.label);
      setOpenList(false);
    },
    [setForm]
  );

  // Keyboard pe input
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
      }
    },
    [openList, activeIndex, flatWithHeaders, selectOption]
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
    // dacă nu e setată deloc disponibilitatea în form,
    // nu mai băgăm noi "READY" din burtă
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


  const generatedDescription = useMemo(
    () => generateDescriptionFromForm(form),
    [form]
  );

  const handleUseGeneratedDescription = () => {
    if (!generatedDescription) return;
    if (form.description?.trim()) {
      const ok = window.confirm(
        "Înlocuiești descrierea existentă cu cea generată?"
      );
      if (!ok) return;
    }
    setForm((s) => ({
      ...s,
      description: generatedDescription,
    }));
  };

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
                    setForm((s) => ({
                      ...s,
                      isActive: e.target.checked,
                    }))
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
                    setForm((s) => ({
                      ...s,
                      isHidden: e.target.checked,
                    }))
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

            <label className={styles.label} htmlFor="product-material">
              Material principal
            </label>
            <input
              id="product-material"
              className={styles.input}
              value={form.materialMain || ""}
              onChange={updateField("materialMain")}
              placeholder="ex: lemn de pin, ceramică, bumbac organic"
            />

            <label className={styles.label} htmlFor="product-technique">
              Tehnică / cum este lucrat
            </label>
            <input
              id="product-technique"
              className={styles.input}
              value={form.technique || ""}
              onChange={updateField("technique")}
              placeholder="ex: pictat manual, croșetat, turnat în matriță"
            />

            <label className={styles.label} htmlFor="product-style-tags">
              Stil (tag-uri separate prin virgulă)
            </label>
            <input
              id="product-style-tags"
              className={styles.input}
              value={form.styleTags || ""}
              onChange={updateField("styleTags")}
              placeholder="ex: rustic, boho, minimalist"
            />

            <label className={styles.label} htmlFor="product-occasion-tags">
              Ocazii (tag-uri separate prin virgulă)
            </label>
            <input
              id="product-occasion-tags"
              className={styles.input}
              value={form.occasionTags || ""}
              onChange={updateField("occasionTags")}
              placeholder="ex: cadou casă nouă, zi de naștere"
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

            <label
              className={styles.label}
              htmlFor="product-care-instructions"
            >
              Instrucțiuni de îngrijire
            </label>
            <input
              id="product-care-instructions"
              className={styles.input}
              value={form.careInstructions || ""}
              onChange={updateField("careInstructions")}
              placeholder="ex: șterge ușor cu o cârpă umedă"
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
                    border:
                      "1px dashed rgba(0,0,0,0.12)",
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
                    Poți copia textul de mai sus în câmpul
                    „Descriere” și să îl ajustezi.
                  </span>
                  <button
                    type="button"
                    onClick={handleUseGeneratedDescription}
                    className={styles.smallBtn}
                    style={{ padding: "4px 8px" }}
                  >
                    Folosește această descriere
                  </button>
                </div>
              </div>
            )}

            <label className={styles.label} htmlFor="product-color">
              Culoare principală
            </label>
            <input
              id="product-color"
              className={styles.input}
              value={form.color || ""}
              onChange={updateField("color")}
              placeholder="Ex: alb, verde salvie, roz pudră"
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
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={async (e) => {
                  const files = Array.from(e.target.files || []);
                  e.target.value = "";
                  await onFilesPicked(files);
                }}
              />
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
