import { useCallback, useEffect, useRef, useState } from "react";
import { Check, HandCoins, Link2, Sparkles } from "lucide-react";
import { api } from "../../../../lib/api.js";
import { uploadFile } from "../../../../lib/uploadFile.js";
import CollectionItemsManager from "./CollectionItemsManager.jsx";
import CollectionProductPicker from "./CollectionProductPicker.jsx";
import styles from "./VendorCollectionsTab.module.css";

/*
 * „Colecții” - conceptul UNIC pentru vendor (VendorCollection; înlocuiește
 * VendorCampaign în UI):
 *  - titlu, descriere, cover, activ/inactiv, perioadă opțională;
 *  - reducere opțională DOAR pe produsele proprii, finanțată de vendor;
 *  - „Include automat toate produsele mele” (allOwnProducts);
 *  - produse ale altor magazine, adăugate manual din tot marketplace-ul
 *    (remunerație din recomandare pentru comenzile eligibile, fără reducere pe ele);
 *  - link public /colectie-vendor/:slug.
 *
 * Layout: [ lista colecțiilor ] [ editorul colecției ] pe desktop; pe mobil
 * lista sus, editorul dedesubt. Același formular pentru creare și editare:
 * 1. Date generale  2. Perioadă și reducere (accordion)  3. Produse din colecție
 * (CollectionItemsManager: selecție fixă, eliminare în masă, stări clare)
 * 4. Adaugă produse (CollectionProductPicker: magazinul meu / tot Artfest,
 * filtre, bifare multiplă, „toate rezultatele filtrate”).
 * Backend-ul revalidează tot (eligibilitate, owner, perioadă, plafon reducere).
 */

const PAGE_SIZE = 24;
const MAX_DISCOUNT_PERCENT = 50;

const STATUS_LABELS = {
  LIVE: "Activă",
  SCHEDULED: "Programată",
  EXPIRED: "Expirată",
  INACTIVE: "Inactivă",
};

/*
 * URL-ul public al colecției, sau null dacă pagina publică nu există:
 * GET /api/public/vendor-collections/:slug răspunde 404 pentru
 * isActive=false (status INACTIVE). Programată / expirată se afișează.
 * Calea vine din backend (publicPath = /colectie-vendor/:slug).
 */
function collectionPublicUrl(collection) {
  if (!collection || collection.status === "INACTIVE") return null;

  const slug = String(collection.slug || "").trim();
  if (!slug) return null;

  const path = collection.publicPath || `/colectie-vendor/${encodeURIComponent(slug)}`;
  return `${window.location.origin}${path}`;
}

function errorMessage(err, fallback) {
  return err?.data?.message || err?.message || fallback;
}

// ISO -> valoare pentru <input type="datetime-local"> (ora locală)
function toLocalInput(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// valoare datetime-local (ora locală) -> ISO sau null (fără perioadă)
function fromLocalInput(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// valorile implicite ale unei colecții noi
const NEW_COLLECTION_SETTINGS = {
  title: "",
  description: "",
  coverImage: "",
  isActive: true,
  allOwnProducts: true,
  discountPercent: 0,
  startsAt: "",
  endsAt: "",
};

function settingsFromCollection(collection) {
  if (!collection) return { ...NEW_COLLECTION_SETTINGS };
  return {
    title: collection.title || "",
    description: collection.description || "",
    coverImage: collection.coverImage || "",
    isActive: collection.isActive !== false,
    allOwnProducts: Boolean(collection.allOwnProducts),
    discountPercent: Number(collection.discountPercent || 0),
    startsAt: toLocalInput(collection.startsAt),
    endsAt: toLocalInput(collection.endsAt),
  };
}

// câmpurile trimise la API (aceleași pentru creare și editare)
function settingsPayload(settings) {
  return {
    title: settings.title.trim(),
    description: settings.description.trim() || null,
    coverImage: settings.coverImage || null,
    isActive: settings.isActive,
    allOwnProducts: settings.allOwnProducts,
    discountPercent: Math.max(0, Math.min(MAX_DISCOUNT_PERCENT, Math.round(Number(settings.discountPercent) || 0))),
    startsAt: fromLocalInput(settings.startsAt),
    endsAt: fromLocalInput(settings.endsAt),
  };
}

/* titlu de pas (01 / 02): doar structură vizuală, fără wizard - secțiunile rămân vizibile */
function StepHeading({ number, title, subtitle, id }) {
  return (
    <div className={styles.step}>
      <span className={styles.stepNumber} aria-hidden="true">
        {number}
      </span>
      <div className={styles.stepText}>
        <h3 id={id}>{title}</h3>
        <p>{subtitle}</p>
      </div>
    </div>
  );
}

export default function VendorCollectionsTab() {
  const [collections, setCollections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // null = formular de colecție nouă; altfel colecția editată
  const [selectedId, setSelectedId] = useState(null);
  const [selected, setSelected] = useState(null);
  const [settings, setSettings] = useState({ ...NEW_COLLECTION_SETTINGS });
  // accordion „Perioadă și reducere”: deschis implicit doar dacă există valori
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  // id-ul colecției al cărei link tocmai a fost copiat (feedback „Link copiat”)
  const [copiedId, setCopiedId] = useState(null);

  // CTA „Adaugă produse”: focus pe căutarea din selector (CollectionProductPicker)
  const [pickerFocusSignal, setPickerFocusSignal] = useState(0);

  const isCreating = !selectedId;
  // mobil: formularul „Colecție nouă” urcă deasupra listei doar când l-ai cerut
  // explicit (sau nu ai încă nicio colecție); altfel colecțiile existente rămân primele
  const [createRequested, setCreateRequested] = useState(false);

  // mobil: lista se scurtează la primele colecții (pe desktop e completă, cu scroll propriu)
  const [showAllCollections, setShowAllCollections] = useState(false);
  const COMPACT_LIST_COUNT = 4;

  const searchSectionRef = useRef(null);
  const editorFormRef = useRef(null);
  const titleInputRef = useRef(null);
  const searchInputRef = useRef(null);

  /*
   * CTA „+ Adaugă produse în colecție” / „Adaugă produse”: duce la selectorul
   * de produse (care își face singur prima căutare) și pune focus pe căutare.
   */
  function openProductSearch() {
    searchSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => setPickerFocusSignal((n) => n + 1), 250);
  }

  /* ---------- încărcare ---------- */

  const loadCollections = useCallback(async () => {
    const data = await api("/api/vendor/collections");
    setCollections(Array.isArray(data?.collections) ? data.collections : []);
  }, []);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        await loadCollections();
      } catch (err) {
        if (alive) setError(errorMessage(err, "Nu am putut încărca colecțiile."));
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [loadCollections]);

  const loadSelected = useCallback(async (id) => {
    if (!id) {
      setSelected(null);
      setSettings({ ...NEW_COLLECTION_SETTINGS });
      setAdvancedOpen(false);
      return;
    }
    const data = await api(`/api/vendor/collections/${encodeURIComponent(id)}`);
    const next = settingsFromCollection(data?.collection);
    setSelected(data?.collection || null);
    setSettings(next);
    setAdvancedOpen(Number(next.discountPercent) > 0 || Boolean(next.startsAt) || Boolean(next.endsAt));
  }, []);

  useEffect(() => {
    loadSelected(selectedId).catch((err) =>
      setError(errorMessage(err, "Nu am putut încărca colecția."))
    );
  }, [selectedId, loadSelected]);

  /*
   * CTA-ul din banner: deschide formularul de creare (aceeași pagină),
   * derulează la el și pune focus pe „Titlu”.
   */
  function goToCreateForm() {
    startNewCollection();
    window.setTimeout(() => {
      editorFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      titleInputRef.current?.focus({ preventScroll: true });
    }, 60);
  }

  function startNewCollection() {
    setCreateRequested(true);
    setNotice("");
    setError("");
    setSelectedId(null);
  }

  function openCollection(id) {
    setNotice("");
    setError("");
    setSelectedId(id);

    // mobil (lista e deasupra editorului): coboară direct la editor
    if (window.matchMedia?.("(max-width: 1023px)").matches) {
      window.setTimeout(() => editorFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 120);
    }
  }

  /* ---------- creare / salvare (același formular) ---------- */

  async function submitSettings(event) {
    event.preventDefault();
    if (settings.title.trim().length < 2) return;

    setSaving(true);
    setError("");
    setNotice("");

    try {
      if (isCreating) {
        const data = await api("/api/vendor/collections", {
          method: "POST",
          body: settingsPayload(settings),
        });
        await loadCollections();
        if (data?.collection?.id) setSelectedId(data.collection.id);
        setNotice("Colecția a fost creată. Acum poți adăuga produse de la alte magazine.");
      } else {
        await api(`/api/vendor/collections/${encodeURIComponent(selectedId)}`, {
          method: "PATCH",
          body: settingsPayload(settings),
        });
        await Promise.all([loadSelected(selectedId), loadCollections()]);
        setNotice("Colecția a fost salvată.");
      }
    } catch (err) {
      setError(errorMessage(err, isCreating ? "Nu am putut crea colecția." : "Nu am putut salva colecția."));
    } finally {
      setSaving(false);
    }
  }

  async function uploadCover(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setUploadingCover(true);
    setError("");

    try {
      const url = await uploadFile(file, "/api/upload");
      setSettings((s) => ({ ...s, coverImage: url }));
    } catch (err) {
      setError(errorMessage(err, "Nu am putut încărca imaginea."));
    } finally {
      setUploadingCover(false);
    }
  }

  async function copyPublicLink(collection) {
    const url = collectionPublicUrl(collection);
    if (!url) return; // inactivă / fără slug: fără link mort

    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(collection.id);
      window.setTimeout(
        () => setCopiedId((current) => (current === collection.id ? null : current)),
        1800
      );
    } catch {
      setError("Nu am putut copia linkul.");
    }
  }

  /* ---------- produse: reîncarcă colecția + lista după adăugare / scoatere ---------- */

  const reloadAfterProductsChange = useCallback(
    () => Promise.all([loadSelected(selectedId), loadCollections()]),
    [loadSelected, loadCollections, selectedId]
  );

  /* ---------- render ---------- */

  if (loading) {
    return <div className={styles.state}>Se încarcă colecțiile…</div>;
  }

  const items = Array.isArray(selected?.items) ? selected.items : [];

  /*
   * Opțional: includerea automată a produselor proprii (inclusiv cele viitoare).
   * Aceeași stare din formular (settings.allOwnProducts) și aceeași salvare
   * (submit pe collection-settings-form) - nu e o a doua setare.
   */
  function autoOwnOption() {
    const unsaved = !isCreating && selected && Boolean(selected.allOwnProducts) !== Boolean(settings.allOwnProducts);
    return (
      <details className={styles.autoOwn} open={unsaved || undefined}>
        <summary className={styles.autoOwnSummary}>
          <span className={styles.autoOwnLabel}>
            <span className={styles.optionalTag}>Opțional</span>
            Include automat produsele tale viitoare
          </span>
          <span className={settings.allOwnProducts ? styles.autoOwnOn : styles.autoOwnOff}>
            {settings.allOwnProducts ? "Activă" : "Inactivă"}
          </span>
        </summary>
        <div className={styles.autoOwnBody}>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={settings.allOwnProducts}
              onChange={(e) => setSettings((s) => ({ ...s, allOwnProducts: e.target.checked }))}
            />
            Include automat toate produsele mele
          </label>
          <p className={styles.hint}>
            Toate produsele tale publice intră singure în colecție, inclusiv cele pe care le publici de
            acum înainte. Produsele altor creatori le alegi tu, manual.
          </p>
          {unsaved ? (
            <div className={styles.autoOwnSave}>
              <span>Modificare nesalvată</span>
              <button
                type="submit"
                form="collection-settings-form"
                className={styles.primary}
                disabled={saving || settings.title.trim().length < 2}
              >
                {saving ? "Se salvează…" : "Salvează"}
              </button>
            </div>
          ) : null}
        </div>
      </details>
    );
  }
  const allOwnActive = Boolean(selected?.allOwnProducts);

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <h2>Colecții</h2>
        <p>
          O colecție e o selecție de produse - ale tale și ale altor magazine Artfest - cu un
          link public. Pentru produsele tale plătești comision Artfest redus (5%) și poți oferi
          o reducere; pentru produsele altor magazine poți primi remunerație din recomandare,
          în funcție de comenzile eligibile.
          Vânzătorul rămâne mereu magazinul produsului.
        </p>
      </header>

      {/* ---------- Banner: beneficiu (înaintea formularului de creare) ---------- */}
      <aside className={styles.earnBanner} aria-labelledby="earn-banner-title">
        <span className={styles.earnIcon} aria-hidden="true">
          <Sparkles size={20} strokeWidth={1.75} />
        </span>
        <div className={styles.earnText}>
          <strong id="earn-banner-title">Poți câștiga și din recomandări</strong>
          <p>
            Creează colecții cu produsele tale și cu produse de la alți creatori Artfest. Dacă o
            comandă eligibilă pornește din colecția ta, poți primi remunerație de recomandare.
          </p>
          <p className={styles.earnSecondary}>
            Produsele tale pot beneficia de comision redus, iar produsele altor creatori îți pot
            aduce remunerație din recomandări eligibile.
          </p>
        </div>
        <button type="button" className={`${styles.primary} ${styles.earnCta}`} onClick={goToCreateForm}>
          Creează o colecție
        </button>
      </aside>

      {/* pe mobil, în modul „colecție nouă”, formularul urcă deasupra listei (vezi CSS) */}
      <div
        className={styles.layout}
        data-mode={isCreating && (createRequested || !collections.length) ? "create" : "edit"}
      >
        {/* =============== Lista colecțiilor (sidebar) =============== */}
        <aside className={styles.sidebar} aria-label="Colecțiile tale">
          <div className={styles.sidebarHeader}>
            <h3>Colecțiile tale</h3>
            <button
              type="button"
              className={isCreating ? styles.primary : styles.secondary}
              onClick={startNewCollection}
              aria-pressed={isCreating}
            >
              + Colecție nouă
            </button>
          </div>

          {collections.length ? (
            <>
            <ul className={styles.list}>
              {collections.map((c, index) => {
                const publicUrl = collectionPublicUrl(c);
                const isCopied = copiedId === c.id;

                return (
                <li
                  key={c.id}
                  className={[
                    c.id === selectedId ? styles.listItemActive : styles.listItem,
                    styles.listItemWithCopy,
                    // ascuns doar pe mobil, cât lista e scurtată (colecția deschisă rămâne vizibilă)
                    !showAllCollections && index >= COMPACT_LIST_COUNT && c.id !== selectedId ? styles.listItemExtra : "",
                  ].join(" ")}
                >
                  <button
                    type="button"
                    className={styles.linkButton}
                    onClick={() => openCollection(c.id)}
                    aria-current={c.id === selectedId ? "true" : undefined}
                  >
                    <strong>{c.title}</strong>
                    <span className={styles.listMeta}>
                      {c.allOwnProducts ? "toate produsele tale" : `${c.productsCount} produse`}
                      {c.allOwnProducts && c.productsCount ? ` + ${c.productsCount} selectate` : ""}
                      {c.discountPercent ? ` · -${c.discountPercent}%` : ""}
                    </span>
                    <span className={styles.status} data-status={c.status}>
                      {STATUS_LABELS[c.status] || c.status}
                    </span>
                  </button>

                  {/* linkul public al colecției; dezactivat dacă pagina publică nu există (inactivă) */}
                  <button
                    type="button"
                    className={isCopied ? styles.copyLinkButtonDone : styles.copyLinkButton}
                    onClick={() => copyPublicLink(c)}
                    disabled={!publicUrl}
                    aria-label={
                      publicUrl
                        ? `Copiază linkul public al colecției „${c.title}”`
                        : `Colecția „${c.title}” e inactivă: nu are link public`
                    }
                    title={publicUrl ? "Copiază linkul" : "Colecția e inactivă: pagina publică nu e disponibilă."}
                  >
                    {isCopied ? <Check size={16} aria-hidden="true" /> : <Link2 size={16} aria-hidden="true" />}
                    {isCopied ? <span>Link copiat</span> : null}
                  </button>
                </li>
                );
              })}
            </ul>

            {/* anunț pentru cititoarele de ecran */}
            <span className={styles.srOnly} role="status" aria-live="polite">
              {copiedId ? "Link copiat" : ""}
            </span>
            </>
          ) : (
            <p className={styles.muted}>Nu ai încă nicio colecție.</p>
          )}

          {collections.length > COMPACT_LIST_COUNT ? (
            <button
              type="button"
              className={styles.listToggle}
              aria-expanded={showAllCollections}
              onClick={() => setShowAllCollections((v) => !v)}
            >
              {showAllCollections ? "Arată mai puține" : `Vezi toate colecțiile (${collections.length})`}
            </button>
          ) : null}
        </aside>

        {/* =============== Editorul colecției =============== */}
        <section className={styles.editor} aria-label="Editor colecție">
          {/*
           * Bara editorului: titlu + acțiunile principale. Pe desktop rămâne
           * sticky în scroll-ul editorului; butonul de salvare trimite același
           * formular (atributul form), fără logică nouă.
           */}
          <div className={styles.editorBar}>
            <h3>{isCreating ? "Colecție nouă" : `Editează „${selected?.title || ""}”`}</h3>
            <span className={styles.actions}>
              {!isCreating && selected ? (
                <>
                  <span className={styles.status} data-status={selected.status}>
                    {STATUS_LABELS[selected.status] || selected.status}
                  </span>
                  <a className={styles.linkAction} href={`/colectie-vendor/${selected.slug}`} target="_blank" rel="noreferrer">
                    Vezi public
                  </a>
                  <button
                    type="button"
                    className={styles.secondary}
                    onClick={() => copyPublicLink(selected)}
                    disabled={!collectionPublicUrl(selected)}
                    title={collectionPublicUrl(selected) ? undefined : "Colecția e inactivă: pagina publică nu e disponibilă."}
                  >
                    {copiedId === selected.id ? "Link copiat" : "Copiază linkul"}
                  </button>
                  <button type="button" className={styles.secondary} onClick={openProductSearch}>
                    + Produse
                  </button>
                </>
              ) : null}
              <button
                type="submit"
                form="collection-settings-form"
                className={styles.primary}
                disabled={saving || settings.title.trim().length < 2}
              >
                {saving ? "Se salvează…" : isCreating ? "Creează" : "Salvează"}
              </button>
            </span>
          </div>

          {error ? <div className={styles.error}>{error}</div> : null}
          {notice ? <div className={styles.notice}>{notice}</div> : null}

          <StepHeading
            number="01"
            id="collection-step-1"
            title="Pasul 1 — Creează colecția"
            subtitle="Alege un nume, adaugă o descriere și stabilește detaliile colecției."
          />

          <section className={styles.card} ref={editorFormRef}>
            <form id="collection-settings-form" className={styles.settings} onSubmit={submitSettings}>
              {/* ---------- 1. Date generale ---------- */}
              <fieldset className={styles.group}>
                <legend className={styles.groupTitle}>Date generale</legend>

                <label className={styles.field}>
                  <span>Titlu</span>
                  <input
                    ref={titleInputRef}
                    value={settings.title}
                    maxLength={160}
                    placeholder="ex. Cadouri de toamnă"
                    onChange={(e) => setSettings((s) => ({ ...s, title: e.target.value }))}
                  />
                </label>

                <label className={styles.field}>
                  <span>Descriere</span>
                  <textarea
                    rows={3}
                    value={settings.description}
                    placeholder="Opțional - apare pe pagina publică a colecției"
                    onChange={(e) => setSettings((s) => ({ ...s, description: e.target.value }))}
                  />
                </label>

                <div className={styles.field}>
                  <span>Imagine de copertă</span>
                  {settings.coverImage ? (
                    <img src={settings.coverImage} alt="" className={styles.cover} />
                  ) : null}
                  <span className={styles.row}>
                    <input type="file" accept="image/*" onChange={uploadCover} disabled={uploadingCover} />
                    {settings.coverImage ? (
                      <button type="button" className={styles.secondary} onClick={() => setSettings((s) => ({ ...s, coverImage: "" }))}>
                        Elimină coperta
                      </button>
                    ) : null}
                    {uploadingCover ? <span className={styles.muted}>Se încarcă…</span> : null}
                  </span>
                </div>

                <div className={styles.checks}>
                  <label className={styles.check}>
                    <input
                      type="checkbox"
                      checked={settings.isActive}
                      onChange={(e) => setSettings((s) => ({ ...s, isActive: e.target.checked }))}
                    />
                    Colecție activă (vizibilă public)
                  </label>
                </div>
              </fieldset>

              {/* colecție nouă: opțiunea secundară stă în formular (după creare, în „Produsele din colecție”) */}
              {isCreating ? autoOwnOption() : null}

              {/* ---------- 2. Perioadă și reducere (accordion) ---------- */}
              <details
                className={styles.advanced}
                open={advancedOpen}
                onToggle={(e) => setAdvancedOpen(e.currentTarget.open)}
              >
                <summary className={styles.advancedSummary}>
                  <span>Perioadă și reducere</span>
                  <span className={styles.advancedMeta}>
                    {Number(settings.discountPercent) > 0 ? `-${settings.discountPercent}%` : "fără reducere"}
                    {settings.startsAt || settings.endsAt ? " · cu perioadă" : " · fără perioadă"}
                  </span>
                </summary>

                <div className={styles.advancedBody}>
                  <label className={styles.field}>
                    <span>Reducere pentru produsele tale (opțional, 0–{MAX_DISCOUNT_PERCENT}%)</span>
                    <input
                      type="number"
                      min={0}
                      max={MAX_DISCOUNT_PERCENT}
                      step={1}
                      value={settings.discountPercent}
                      onChange={(e) => setSettings((s) => ({ ...s, discountPercent: e.target.value }))}
                    />
                  </label>
                  <p className={styles.hint}>
                    Reducerea se aplică <strong>doar produselor tale</strong> din colecție și este
                    suportată de tine (nu de Artfest). Produsele altor magazine nu primesc această
                    reducere.
                  </p>

                  <div className={styles.row}>
                    <label className={styles.field}>
                      <span>Începe (opțional)</span>
                      <input
                        type="datetime-local"
                        value={settings.startsAt}
                        onChange={(e) => setSettings((s) => ({ ...s, startsAt: e.target.value }))}
                      />
                    </label>
                    <label className={styles.field}>
                      <span>Se termină (opțional)</span>
                      <input
                        type="datetime-local"
                        value={settings.endsAt}
                        onChange={(e) => setSettings((s) => ({ ...s, endsAt: e.target.value }))}
                      />
                    </label>
                  </div>
                  <p className={styles.hint}>
                    Fără perioadă, colecția e activă cât timp e bifată „activă”. În afara perioadei,
                    pagina rămâne publică, dar fără reducere și fără atribuirea comenzilor.
                  </p>
                </div>
              </details>

              <div className={styles.formActions}>
                <button type="submit" className={styles.primary} disabled={saving || settings.title.trim().length < 2}>
                  {saving
                    ? isCreating ? "Se creează…" : "Se salvează…"
                    : isCreating ? "Creează colecția" : "Salvează colecția"}
                </button>
                {!isCreating && selected ? (
                  <span className={styles.muted}>
                    Link public:{" "}
                    <a href={`/colectie-vendor/${selected.slug}`} target="_blank" rel="noreferrer">
                      /colectie-vendor/{selected.slug}
                    </a>
                  </span>
                ) : (
                  <span className={styles.muted}>După creare poți adăuga produse de la alte magazine.</span>
                )}
              </div>
            </form>
          </section>

          <StepHeading
            number="02"
            id="collection-step-2"
            title="Pasul 2 — Adaugă produsele"
            subtitle="Alege produse din magazinul tău sau din tot Artfest. Poți selecta unul, mai multe sau toate rezultatele dorite."
          />

          {isCreating ? (
            <p className={styles.stepPending}>Salvează mai întâi colecția pentru a putea adăuga produse.</p>
          ) : null}

          {!isCreating && selected ? (
            <>
              {/* ---------- 3. Produsele din colecție: sursa + căutare + selecție (selectorul existent) ---------- */}
              <section
                className={`${styles.card} ${styles.productsSection}`}
                ref={searchSectionRef}
                aria-labelledby="collection-products-title"
              >
                <header className={styles.productsHead}>
                  <h3 id="collection-products-title">Produsele din colecție</h3>
                  <p className={styles.productsMoney}>
                    <HandCoins size={17} strokeWidth={1.75} aria-hidden="true" />
                    <span>
                      Produsele tale au comision Artfest redus. Pentru produsele altor creatori poți primi
                      remunerație din recomandare la comenzile eligibile; prețul, stocul și livrarea rămân ale lor.
                    </span>
                  </p>
                </header>

                <CollectionProductPicker
                  key={`picker-${selectedId}-${allOwnActive ? "auto" : "manual"}`}
                  collectionId={selectedId}
                  allOwnActive={allOwnActive}
                  collectionCount={items.length}
                  maxProducts={selected?.maxProducts || 300}
                  focusSignal={pickerFocusSignal}
                  inputRef={searchInputRef}
                  onChanged={reloadAfterProductsChange}
                />

                {/* secundar, opțional: după alegerea manuală */}
                {autoOwnOption()}
              </section>

              {/* ---------- 4. Deja în colecție (selecție fixă, eliminare în masă) ---------- */}
              <section className={styles.card}>
                <CollectionItemsManager
                  key={`items-${selectedId}`}
                  collectionId={selectedId}
                  items={items}
                  allOwnActive={allOwnActive}
                  maxProducts={selected?.maxProducts || 300}
                  onChanged={reloadAfterProductsChange}
                  onAddClick={openProductSearch}
                />
              </section>
            </>
          ) : null}
        </section>
      </div>
    </div>
  );
}
