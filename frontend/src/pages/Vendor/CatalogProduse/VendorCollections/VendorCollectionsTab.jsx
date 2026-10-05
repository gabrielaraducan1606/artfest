import { useCallback, useEffect, useRef, useState } from "react";
import { HandCoins, Package, Plus, Sparkles, Store } from "lucide-react";
import { api } from "../../../../lib/api.js";
import { uploadFile } from "../../../../lib/uploadFile.js";
import { CATEGORIES_DETAILED } from "../../../../constants/productscategories.js";
import { getCanonicalLabel } from "../../../../utils/optionLabels.js";
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
 * 1. Date generale  2. Perioadă și reducere (accordion)  3. Produse  4. Căutare.
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

function money(priceCents, currency = "RON") {
  const value = Number(priceCents || 0) / 100;
  return `${new Intl.NumberFormat("ro-RO", { maximumFractionDigits: 2 }).format(value)} ${currency}`;
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

export default function VendorCollectionsTab() {
  const [myVendorId, setMyVendorId] = useState(null);
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
  const [busyProductId, setBusyProductId] = useState(null);
  const [copied, setCopied] = useState(false);

  const [search, setSearch] = useState({ q: "", store: "", category: "" });
  const [results, setResults] = useState([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");

  const isCreating = !selectedId;

  // mobil: lista se scurtează la primele colecții (pe desktop e completă, cu scroll propriu)
  const [showAllCollections, setShowAllCollections] = useState(false);
  const [showAllItems, setShowAllItems] = useState(false);
  const COMPACT_LIST_COUNT = 4;

  const searchSectionRef = useRef(null);
  const editorFormRef = useRef(null);
  const titleInputRef = useRef(null);
  const searchInputRef = useRef(null);

  /*
   * CTA „+ Adaugă produse în colecție” / „Explorează produsele Artfest”:
   * duce la căutarea din marketplace și o pornește (aceeași căutare existentă,
   * fără filtre) dacă nu există încă rezultate.
   */
  function openProductSearch() {
    searchSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => searchInputRef.current?.focus({ preventScroll: true }), 250);
    if (!results.length && !searching) runSearch(1);
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
        const [me] = await Promise.all([api("/api/vendors/me"), loadCollections()]);
        if (alive) setMyVendorId(me?.vendor?.id || null);
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
    setResults([]);
    setPage(1);
    setHasMore(false);
    setSearchError("");
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

  async function copyPublicLink(slug) {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/colectie-vendor/${slug}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Nu am putut copia linkul.");
    }
  }

  /* ---------- căutare produse (tot marketplace-ul) ---------- */

  async function runSearch(nextPage = 1) {
    if (!selectedId) return;

    setSearching(true);
    setSearchError("");

    try {
      const params = new URLSearchParams({ page: String(nextPage), limit: String(PAGE_SIZE) });
      if (search.q.trim()) params.set("q", search.q.trim());
      if (search.store.trim()) params.set("store", search.store.trim());
      if (search.category) params.set("category", search.category);

      const data = await api(
        `/api/vendor/collections/${encodeURIComponent(selectedId)}/product-search?${params}`
      );
      const products = Array.isArray(data?.products) ? data.products : [];

      setResults((current) => (nextPage === 1 ? products : [...current, ...products]));
      setPage(nextPage);
      setHasMore(Boolean(data?.hasMore));
    } catch (err) {
      setSearchError(errorMessage(err, "Căutarea nu a reușit."));
    } finally {
      setSearching(false);
    }
  }

  function markInCollection(productId, inCollection) {
    setResults((current) =>
      current.map((p) => (p.id === productId ? { ...p, inCollection } : p))
    );
  }

  async function addProduct(productId) {
    setBusyProductId(productId);
    setSearchError("");

    try {
      await api(`/api/vendor/collections/${encodeURIComponent(selectedId)}/products`, {
        method: "POST",
        body: { productIds: [productId] },
      });
      markInCollection(productId, true);
      await Promise.all([loadSelected(selectedId), loadCollections()]);
    } catch (err) {
      setSearchError(errorMessage(err, "Produsul nu a putut fi adăugat."));
    } finally {
      setBusyProductId(null);
    }
  }

  async function removeProduct(productId) {
    setBusyProductId(productId);

    try {
      await api(
        `/api/vendor/collections/${encodeURIComponent(selectedId)}/products/${encodeURIComponent(productId)}`,
        { method: "DELETE" }
      );
      markInCollection(productId, false);
      await Promise.all([loadSelected(selectedId), loadCollections()]);
    } catch (err) {
      setError(errorMessage(err, "Produsul nu a putut fi scos din colecție."));
    } finally {
      setBusyProductId(null);
    }
  }

  /* ---------- render ---------- */

  if (loading) {
    return <div className={styles.state}>Se încarcă colecțiile…</div>;
  }

  const items = Array.isArray(selected?.items) ? selected.items : [];
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
      <div className={styles.layout} data-mode={isCreating ? "create" : "edit"}>
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
            <ul className={styles.list}>
              {collections.map((c, index) => (
                <li
                  key={c.id}
                  className={[
                    c.id === selectedId ? styles.listItemActive : styles.listItem,
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
                </li>
              ))}
            </ul>
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
                  <button type="button" className={styles.secondary} onClick={() => copyPublicLink(selected.slug)}>
                    {copied ? "Copiat" : "Copiază linkul"}
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

                  <label className={styles.check}>
                    <input
                      type="checkbox"
                      checked={settings.allOwnProducts}
                      onChange={(e) => setSettings((s) => ({ ...s, allOwnProducts: e.target.checked }))}
                    />
                    Include automat toate produsele mele
                  </label>
                </div>
                <p className={styles.hint}>
                  Toate produsele tale publice intră automat în colecție, inclusiv cele pe care le
                  publici de acum înainte. Produsele altor magazine le adaugi manual, la „Produse”.
                </p>
              </fieldset>

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

          {!isCreating && selected ? (
            <>
              {/* ---------- 3. Adaugă produse: avantajul + CTA principal ---------- */}
              <section className={`${styles.card} ${styles.promo}`} aria-label="Adaugă produse în colecție">
                <div className={styles.promoHead}>
                  <span className={styles.promoIcon} aria-hidden="true">
                    <HandCoins size={20} strokeWidth={1.75} />
                  </span>
                  <p className={styles.promoShort}>
                    Poți adăuga produse de la alte magazine și poți primi remunerație din
                    recomandările eligibile.
                  </p>
                </div>

                <button type="button" className={`${styles.primary} ${styles.ctaAdd}`} onClick={openProductSearch}>
                  <Plus size={18} strokeWidth={2.25} aria-hidden="true" />
                  Adaugă produse în colecție
                </button>

                <div className={styles.options}>
                  <div className={styles.option}>
                    <span className={styles.optionIcon} aria-hidden="true">
                      <Package size={18} strokeWidth={1.75} />
                    </span>
                    <div>
                      <strong>Produsele tale</strong>
                      <p>
                        {allOwnActive
                          ? "Incluse automat în colecție (opțiunea „Include automat toate produsele mele” este activă)."
                          : "Le poți adăuga din căutare sau poți activa „Include automat toate produsele mele”."}
                      </p>
                      <p className={styles.optionBenefit}>Beneficiu: comision Artfest redus, conform regulii colecției.</p>
                    </div>
                  </div>

                  <div className={styles.option}>
                    <span className={styles.optionIcon} aria-hidden="true">
                      <Store size={18} strokeWidth={1.75} />
                    </span>
                    <div>
                      <strong>Produse de la alte magazine</strong>
                      <p>Le poți căuta în marketplace și le adaugi în colecție.</p>
                      <p className={styles.optionBenefit}>
                        Dacă generează o comandă eligibilă din colecția ta, poți primi remunerație de recomandare.
                      </p>
                    </div>
                  </div>
                </div>
              </section>

              {/* ---------- 4. Produse din colecție ---------- */}
              <section className={styles.card}>
                <h3>Produse din colecție</h3>
                {allOwnActive ? (
                  <p className={styles.notice}>
                    Toate produsele tale publice sunt incluse automat. Mai jos sunt doar produsele
                    adăugate manual (de obicei de la alte magazine).
                  </p>
                ) : null}
                {items.length ? (
                  <div className={styles.grid}>
                    {items.map(({ productId, product }, index) => {
                      const sellerId = product?.service?.vendor?.id;
                      const isOwn = myVendorId && String(sellerId) === String(myVendorId);
                      return (
                        <ProductRow
                          key={productId}
                          className={!showAllItems && index >= COMPACT_LIST_COUNT ? styles.listItemExtra : ""}
                          image={Array.isArray(product?.images) ? product.images[0] : null}
                          title={product?.title}
                          price={money(product?.priceCents, product?.currency)}
                          storeName={product?.service?.title || product?.service?.vendor?.displayName}
                          isOwn={isOwn}
                          badgeLabel={isOwn ? "Produs propriu" : "Recomandare"}
                          unavailable={
                            product &&
                            (!product.isActive || product.isHidden || product.moderationStatus !== "APPROVED")
                          }
                          action={
                            <button
                              type="button"
                              className={styles.danger}
                              disabled={busyProductId === productId}
                              onClick={() => removeProduct(productId)}
                            >
                              Scoate din colecție
                            </button>
                          }
                        />
                      );
                    })}
                  </div>
                ) : null}
                {items.length > COMPACT_LIST_COUNT ? (
                  <button
                    type="button"
                    className={styles.listToggle}
                    aria-expanded={showAllItems}
                    onClick={() => setShowAllItems((v) => !v)}
                  >
                    {showAllItems ? "Arată mai puține" : `Vezi toate produsele (${items.length})`}
                  </button>
                ) : null}
                {items.length ? null : (
                  <div className={styles.emptyState}>
                    <p>
                      Adaugă produse de la alte magazine pentru a transforma colecția într-o selecție
                      completă și pentru a putea primi remunerație din recomandările eligibile.
                    </p>
                    <button type="button" className={styles.secondary} onClick={openProductSearch}>
                      Explorează produsele Artfest
                    </button>
                  </div>
                )}
              </section>

              {/* ---------- 5. Căutare marketplace ---------- */}
              <section className={styles.card} ref={searchSectionRef}>
                <h3>Adaugă produse din tot Artfest</h3>
                <form
                  className={styles.row}
                  onSubmit={(e) => {
                    e.preventDefault();
                    runSearch(1);
                  }}
                >
                  <input
                    ref={searchInputRef}
                    value={search.q}
                    onChange={(e) => setSearch((s) => ({ ...s, q: e.target.value }))}
                    placeholder="Caută după titlu"
                  />
                  <input
                    value={search.store}
                    onChange={(e) => setSearch((s) => ({ ...s, store: e.target.value }))}
                    placeholder="Magazin / vendor"
                  />
                  <select
                    value={search.category}
                    onChange={(e) => setSearch((s) => ({ ...s, category: e.target.value }))}
                  >
                    <option value="">Toate categoriile</option>
                    {CATEGORIES_DETAILED.map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.groupLabel} · {c.label}
                      </option>
                    ))}
                  </select>
                  <button type="submit" className={styles.primary} disabled={searching}>
                    {searching && page === 1 ? "Se caută…" : "Caută"}
                  </button>
                </form>

                {searchError ? <div className={styles.error}>{searchError}</div> : null}

                {results.length ? (
                  <div className={`${styles.grid} ${styles.resultsGrid}`}>
                    {results.map((p) => (
                      <ProductRow
                        key={p.id}
                        image={p.image}
                        title={p.title}
                        price={money(p.priceCents, p.currency)}
                        storeName={p.storeName}
                        category={p.category ? getCanonicalLabel("category", p.category) : null}
                        isOwn={p.isOwn}
                        hint={p.isOwn ? null : "Poate genera remunerație din recomandare"}
                        action={
                          p.isOwn && allOwnActive ? (
                            <button type="button" className={styles.stateAuto} disabled>
                              Inclus automat
                            </button>
                          ) : p.inCollection ? (
                            <button type="button" className={styles.stateAdded} disabled>
                              Adăugat în colecție ✓
                            </button>
                          ) : (
                            <button
                              type="button"
                              className={styles.primary}
                              disabled={busyProductId === p.id}
                              onClick={() => addProduct(p.id)}
                            >
                              Adaugă în colecție
                            </button>
                          )
                        }
                      />
                    ))}
                  </div>
                ) : !searching ? (
                  <p className={styles.muted}>Caută produse după titlu, magazin sau categorie.</p>
                ) : null}

                {hasMore ? (
                  <button type="button" className={styles.loadMore} disabled={searching} onClick={() => runSearch(page + 1)}>
                    {searching ? "Se încarcă…" : "Încarcă mai multe"}
                  </button>
                ) : null}
              </section>
            </>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function ProductRow({ image, title, price, storeName, category, isOwn, badgeLabel, hint, unavailable, action, className = "" }) {
  return (
    <div className={className ? `${styles.product} ${className}` : styles.product}>
      {image ? (
        <img src={image} alt={title || ""} className={styles.thumb} loading="lazy" />
      ) : (
        <div className={styles.thumb} aria-hidden="true" />
      )}
      <div className={styles.productBody}>
        <strong>{title || "Produs"}</strong>
        <span>{price}</span>
        <span className={styles.muted}>
          {storeName || "Magazin"}
          {category ? ` · ${category}` : ""}
        </span>
        <span className={isOwn ? styles.badgeOwn : styles.badgeOther}>
          {badgeLabel || (isOwn ? "Produsul tău" : "Alt magazin")}
        </span>
        {hint ? <span className={styles.badgeHint}>{hint}</span> : null}
        {unavailable ? <span className={styles.error}>Indisponibil public</span> : null}
      </div>
      <div>{action}</div>
    </div>
  );
}
