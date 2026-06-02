// src/pages/Admin/AdminDesktop/tabs/AdminCollectionsTab.jsx

import { useEffect, useMemo, useState } from "react";
import { api } from "../../../../lib/api";
import styles from "../AdminDesktop.module.css";
import { CATEGORIES_DETAILED } from "../../../../../../backend/src/constants/categories.js";

const OCCASION_OPTIONS = [
  { value: "cadou-educatoare", label: "Cadou educatoare" },
  { value: "cadou-invatatoare", label: "Cadou învățătoare" },
  { value: "cadou-profesoara", label: "Cadou profesoară" },
  { value: "sfarsit-an-scolar", label: "Sfârșit de an școlar" },
  { value: "absolvire", label: "Absolvire" },
  { value: "multumire-profesor", label: "Mulțumire profesor" },
];

const STYLE_OPTIONS = [
  { value: "personalizat", label: "Personalizat" },
  { value: "handmade", label: "Handmade" },
  { value: "elegant", label: "Elegant" },
  { value: "minimalist", label: "Minimalist" },
  { value: "colorat", label: "Colorat" },
  { value: "premium", label: "Premium" },
];

const EMPTY_FORM = {
  title: "",
  slug: "",
  subtitle: "",
  seoTitle: "",
  seoDescription: "",
  description: "",
  heroImage: "",
  isActive: false,
  showOnHomepage: false,
  showInMenu: false,

  promoEnabled: false,
  promoPercent: "",
  promoLabel: "",
  promoStartsAt: "",
  promoEndsAt: "",
  promoFundingSource: "PLATFORM_COMMISSION",

  rules: {
    categories: [],
    minPriceCents: "",
    maxPriceCents: "",
    acceptsCustom: false,
    occasionTags: [],
    styleTags: [],
  },
};

function toDatetimeLocal(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

export default function AdminCollectionsTab() {
  const [collections, setCollections] = useState([]);
  const [previewProducts, setPreviewProducts] = useState([]);
  const [previewLoading, setPreviewLoading] = useState(false);

  const [pickerProducts, setPickerProducts] = useState([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [collectionItems, setCollectionItems] = useState([]);
  const [itemsLoading, setItemsLoading] = useState(false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [error, setError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const categoriesByGroup = useMemo(() => {
    return CATEGORIES_DETAILED.reduce((acc, category) => {
      const groupKey = category.group || "alte";

      if (!acc[groupKey]) {
        acc[groupKey] = {
          label: category.groupLabel || "Altele",
          items: [],
        };
      }

      acc[groupKey].items.push(category);
      return acc;
    }, {});
  }, []);

  async function loadCollections() {
    setLoading(true);
    setError("");

    try {
      const data = await api("/api/admin/collections");
      setCollections(data.collections || data.items || []);
    } catch (e) {
      setError(e?.message || "Nu am putut încărca colecțiile.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadCollections();
  }, []);

  function updateField(name, value) {
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  function updateRule(name, value) {
    setForm((prev) => ({
      ...prev,
      rules: {
        ...prev.rules,
        [name]: value,
      },
    }));
  }

  function toggleRuleArray(name, value) {
    setForm((prev) => {
      const current = Array.isArray(prev.rules[name]) ? prev.rules[name] : [];
      const exists = current.includes(value);

      return {
        ...prev,
        rules: {
          ...prev.rules,
          [name]: exists
            ? current.filter((item) => item !== value)
            : [...current, value],
        },
      };
    });
  }

  function makeSlug(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function normalizeDateTime(value) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString();
  }

  function buildPayload() {
    const minPrice = Number(form.rules.minPriceCents);
    const maxPrice = Number(form.rules.maxPriceCents);
    const promoPercent = Number(form.promoPercent);

    return {
      title: form.title,
      slug: form.slug || makeSlug(form.title),
      subtitle: form.subtitle,
      seoTitle: form.seoTitle,
      seoDescription: form.seoDescription,
      description: form.description,
      heroImage: form.heroImage,

      isActive: !!form.isActive,
      showOnHomepage: !!form.showOnHomepage,
      showInMenu: !!form.showInMenu,

      promoEnabled: !!form.promoEnabled,
      promoPercent:
        form.promoEnabled && Number.isFinite(promoPercent) && promoPercent > 0
          ? Math.min(Math.max(Math.round(promoPercent), 1), 90)
          : null,
      promoLabel:
        form.promoEnabled && form.promoLabel ? form.promoLabel.trim() : null,
      promoStartsAt:
        form.promoEnabled && form.promoStartsAt
          ? normalizeDateTime(form.promoStartsAt)
          : null,
      promoEndsAt:
        form.promoEnabled && form.promoEndsAt
          ? normalizeDateTime(form.promoEndsAt)
          : null,
      promoFundingSource: form.promoEnabled
        ? form.promoFundingSource || "PLATFORM_COMMISSION"
        : "PLATFORM_COMMISSION",

      rules: {
        categories: form.rules.categories || [],
        acceptsCustom: !!form.rules.acceptsCustom,
        occasionTags: form.rules.occasionTags || [],
        styleTags: form.rules.styleTags || [],
        ...(Number.isFinite(minPrice) && minPrice > 0
          ? { minPriceCents: Math.round(Math.min(minPrice, 100000) * 100) }
          : {}),
        ...(Number.isFinite(maxPrice) && maxPrice > 0
          ? { maxPriceCents: Math.round(Math.min(maxPrice, 100000) * 100) }
          : {}),
      },
      sort: "curated",
    };
  }

  function resetForm() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setPreviewProducts([]);
    setPickerProducts([]);
    setCollectionItems([]);
    setPickerQuery("");
    setFormOpen(false);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError("");

    try {
      const payload = buildPayload();

      if (editingId) {
        await api(`/api/admin/collections/${editingId}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      } else {
        await api("/api/admin/collections", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }

      resetForm();
      await loadCollections();
    } catch (e) {
      setError(e?.message || "Nu am putut salva colecția.");
    } finally {
      setSaving(false);
    }
  }

  async function handlePreviewRules() {
    setPreviewLoading(true);
    setError("");

    try {
      const data = await api("/api/admin/collections/preview-products?take=24", {
        method: "POST",
        body: JSON.stringify({
          rules: buildPayload().rules,
        }),
      });

      setPreviewProducts(data.products || data.items || []);
    } catch (e) {
      setError(e?.message || "Nu am putut genera preview-ul.");
    } finally {
      setPreviewLoading(false);
    }
  }

  async function loadCollectionItems(collectionId) {
    if (!collectionId) return;

    setItemsLoading(true);
    setError("");

    try {
      const data = await api(`/api/admin/collections/${collectionId}/items`);
      setCollectionItems(data.items || []);
    } catch (e) {
      setError(e?.message || "Nu am putut încărca produsele manuale.");
    } finally {
      setItemsLoading(false);
    }
  }

  async function loadPickerProducts() {
    setPickerLoading(true);
    setError("");

    try {
      const qs = new URLSearchParams();
      qs.set("take", "40");
      if (pickerQuery.trim()) qs.set("q", pickerQuery.trim());

      const data = await api(`/api/admin/collections/products-picker?${qs.toString()}`);
      setPickerProducts(data.products || data.items || []);
    } catch (e) {
      setError(e?.message || "Nu am putut căuta produse.");
    } finally {
      setPickerLoading(false);
    }
  }

  async function addProductToCollection(product, opts = {}) {
    if (!editingId || !product?.id) return;

    try {
      await api(`/api/admin/collections/${editingId}/items`, {
        method: "PATCH",
        body: JSON.stringify({
          productId: product.id,
          pinned: !!opts.pinned,
          excluded: !!opts.excluded,
          position: collectionItems.length,
        }),
      });

      await loadCollectionItems(editingId);
      await loadCollections();
    } catch (e) {
      setError(e?.message || "Nu am putut adăuga produsul în colecție.");
    }
  }

  async function updateCollectionItem(item, patch) {
    if (!editingId || !item?.productId) return;

    try {
      await api(`/api/admin/collections/${editingId}/items/${item.productId}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });

      await loadCollectionItems(editingId);
    } catch (e) {
      setError(e?.message || "Nu am putut modifica produsul din colecție.");
    }
  }

  async function removeCollectionItem(item) {
    if (!editingId || !item?.productId) return;

    try {
      await api(`/api/admin/collections/${editingId}/items/${item.productId}`, {
        method: "DELETE",
      });

      await loadCollectionItems(editingId);
      await loadCollections();
    } catch (e) {
      setError(e?.message || "Nu am putut elimina produsul din colecție.");
    }
  }

  async function reorderItems() {
    if (!editingId) return;

    try {
      await api(`/api/admin/collections/${editingId}/items/reorder`, {
        method: "PATCH",
        body: JSON.stringify({
          items: collectionItems.map((item, index) => ({
            productId: item.productId,
            position: index,
          })),
        }),
      });

      await loadCollectionItems(editingId);
    } catch (e) {
      setError(e?.message || "Nu am putut salva ordinea produselor.");
    }
  }

  function moveItem(productId, direction) {
    setCollectionItems((prev) => {
      const copy = [...prev];
      const index = copy.findIndex((item) => item.productId === productId);
      if (index < 0) return prev;

      const nextIndex = direction === "up" ? index - 1 : index + 1;
      if (nextIndex < 0 || nextIndex >= copy.length) return prev;

      [copy[index], copy[nextIndex]] = [copy[nextIndex], copy[index]];
      return copy.map((item, idx) => ({ ...item, position: idx }));
    });
  }

  async function startEdit(collection) {
    setEditingId(collection.id);

    setForm({
      title: collection.title || "",
      slug: collection.slug || "",
      subtitle: collection.subtitle || "",
      seoTitle: collection.seoTitle || "",
      seoDescription: collection.seoDescription || "",
      description: collection.description || "",
      heroImage: collection.heroImage || "",

      isActive: !!collection.isActive,
      showOnHomepage: !!collection.showOnHomepage,
      showInMenu: !!collection.showInMenu,

      promoEnabled: !!collection.promoEnabled,
      promoPercent: collection.promoPercent || "",
      promoLabel: collection.promoLabel || "",
      promoStartsAt: toDatetimeLocal(collection.promoStartsAt),
      promoEndsAt: toDatetimeLocal(collection.promoEndsAt),
      promoFundingSource:
        collection.promoFundingSource || "PLATFORM_COMMISSION",

      rules: {
        categories: collection.rules?.categories || [],
        minPriceCents: collection.rules?.minPriceCents
          ? collection.rules.minPriceCents / 100
          : "",
        maxPriceCents: collection.rules?.maxPriceCents
          ? collection.rules.maxPriceCents / 100
          : "",
        acceptsCustom: !!collection.rules?.acceptsCustom,
        occasionTags: collection.rules?.occasionTags || [],
        styleTags: collection.rules?.styleTags || [],
      },
    });

    setPreviewProducts([]);
    setPickerProducts([]);
    setFormOpen(true);
    await loadCollectionItems(collection.id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function deleteCollection(collection) {
    if (!window.confirm(`Ștergi colecția "${collection.title}"?`)) return;

    try {
      await api(`/api/admin/collections/${collection.id}`, {
        method: "DELETE",
      });

      await loadCollections();
    } catch (e) {
      setError(e?.message || "Nu am putut șterge colecția.");
    }
  }

  async function duplicateCollection(collection) {
    try {
      await api(`/api/admin/collections/${collection.id}/duplicate`, {
        method: "POST",
        body: JSON.stringify({
          title: `${collection.title} - copie`,
        }),
      });

      await loadCollections();
    } catch (e) {
      setError(e?.message || "Nu am putut duplica colecția.");
    }
  }

  async function toggleCollectionStatus(collection) {
    try {
      await api(`/api/admin/collections/${collection.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({
          isActive: !collection.isActive,
        }),
      });

      await loadCollections();
    } catch (e) {
      setError(e?.message || "Nu am putut modifica statusul.");
    }
  }

  async function toggleHomepage(collection) {
    try {
      await api(`/api/admin/collections/${collection.id}/visibility`, {
        method: "PATCH",
        body: JSON.stringify({
          showOnHomepage: !collection.showOnHomepage,
        }),
      });

      await loadCollections();
    } catch (e) {
      setError(e?.message || "Nu am putut modifica homepage.");
    }
  }

  async function toggleMenu(collection) {
    try {
      await api(`/api/admin/collections/${collection.id}/visibility`, {
        method: "PATCH",
        body: JSON.stringify({
          showInMenu: !collection.showInMenu,
        }),
      });

      await loadCollections();
    } catch (e) {
      setError(e?.message || "Nu am putut modifica meniul.");
    }
  }

  const existingProductIds = useMemo(() => {
    return new Set(collectionItems.map((item) => item.productId));
  }, [collectionItems]);

  if (loading) {
    return <p className={styles.subtle}>Se încarcă colecțiile…</p>;
  }

  return (
    <div>
      {error && <div className={styles.error}>{error}</div>}

      <div style={{ marginBottom: 16 }}>
        <button
          type="button"
          className={styles.tab}
          onClick={() => {
            if (formOpen) resetForm();
            else setFormOpen(true);
          }}
        >
          {formOpen ? "Închide formularul" : "Adaugă colecție"}
        </button>
      </div>

      {formOpen && (
        <form
          onSubmit={handleSubmit}
          style={{ display: "grid", gap: 14, marginBottom: 24 }}
        >
          <h3>{editingId ? "Editează colecție" : "Adaugă colecție"}</h3>

          <input
            placeholder="Titlu colecție"
            value={form.title}
            onChange={(e) => {
              updateField("title", e.target.value);
              if (!editingId) updateField("slug", makeSlug(e.target.value));
            }}
          />

          <input
            placeholder="Slug"
            value={form.slug}
            onChange={(e) => updateField("slug", makeSlug(e.target.value))}
          />

          <input
            placeholder="Subtitlu"
            value={form.subtitle}
            onChange={(e) => updateField("subtitle", e.target.value)}
          />

          <input
            placeholder="SEO title"
            value={form.seoTitle}
            onChange={(e) => updateField("seoTitle", e.target.value)}
          />

          <textarea
            placeholder="SEO description"
            value={form.seoDescription}
            onChange={(e) => updateField("seoDescription", e.target.value)}
          />

          <textarea
            placeholder="Descriere pagină"
            value={form.description}
            onChange={(e) => updateField("description", e.target.value)}
          />

          <input
            placeholder="Hero image URL"
            value={form.heroImage}
            onChange={(e) => updateField("heroImage", e.target.value)}
          />

          <hr />

          <h3>Reguli produse automate</h3>

          <div>
            <strong>Categorii incluse</strong>

            <div style={{ display: "grid", gap: 16, marginTop: 10 }}>
              {Object.entries(categoriesByGroup).map(([groupKey, group]) => (
                <div key={groupKey}>
                  <div style={{ fontWeight: 700, marginBottom: 8 }}>
                    {group.label}
                  </div>

                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    {group.items.map((category) => (
                      <label key={category.key}>
                        <input
                          type="checkbox"
                          checked={form.rules.categories.includes(category.key)}
                          onChange={() =>
                            toggleRuleArray("categories", category.key)
                          }
                        />{" "}
                        {category.label}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <input
              type="number"
              min="0"
              placeholder="Preț minim RON"
              value={form.rules.minPriceCents}
              onChange={(e) => updateRule("minPriceCents", e.target.value)}
            />

            <input
              type="number"
              min="0"
              placeholder="Preț maxim RON"
              value={form.rules.maxPriceCents}
              onChange={(e) => updateRule("maxPriceCents", e.target.value)}
            />
          </div>

          <label>
            <input
              type="checkbox"
              checked={form.rules.acceptsCustom}
              onChange={(e) => updateRule("acceptsCustom", e.target.checked)}
            />{" "}
            Include doar produse personalizabile
          </label>

          <div>
            <strong>Ocazii</strong>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
              {OCCASION_OPTIONS.map((option) => (
                <label key={option.value}>
                  <input
                    type="checkbox"
                    checked={form.rules.occasionTags.includes(option.value)}
                    onChange={() => toggleRuleArray("occasionTags", option.value)}
                  />{" "}
                  {option.label}
                </label>
              ))}
            </div>
          </div>

          <div>
            <strong>Stiluri</strong>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
              {STYLE_OPTIONS.map((option) => (
                <label key={option.value}>
                  <input
                    type="checkbox"
                    checked={form.rules.styleTags.includes(option.value)}
                    onChange={() => toggleRuleArray("styleTags", option.value)}
                  />{" "}
                  {option.label}
                </label>
              ))}
            </div>
          </div>

          <hr />

          <h3>Promoție / campanie</h3>

          <label>
            <input
              type="checkbox"
              checked={form.promoEnabled}
              onChange={(e) => updateField("promoEnabled", e.target.checked)}
            />{" "}
            Activează reducere pentru această colecție
          </label>

          {form.promoEnabled && (
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <input
                  type="number"
                  min="1"
                  max="90"
                  placeholder="Reducere %"
                  value={form.promoPercent}
                  onChange={(e) => updateField("promoPercent", e.target.value)}
                />

                <input
                  placeholder="Etichetă promo, ex: Reducere săptămânală"
                  value={form.promoLabel}
                  onChange={(e) => updateField("promoLabel", e.target.value)}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label>
                  Începe la
                  <input
                    type="datetime-local"
                    value={form.promoStartsAt}
                    onChange={(e) => updateField("promoStartsAt", e.target.value)}
                  />
                </label>

                <label>
                  Se termină la
                  <input
                    type="datetime-local"
                    value={form.promoEndsAt}
                    onChange={(e) => updateField("promoEndsAt", e.target.value)}
                  />
                </label>
              </div>

              <label>
                Cine suportă reducerea
                <select
                  value={form.promoFundingSource}
                  onChange={(e) =>
                    updateField("promoFundingSource", e.target.value)
                  }
                >
                  <option value="PLATFORM_COMMISSION">
                    Platforma, din comision
                  </option>
                  <option value="VENDOR">Vendorul</option>
                  <option value="SHARED">Platformă + vendor</option>
                </select>
              </label>

              <p className={styles.subtle}>
                Pentru „Platforma, din comision”, clientul vede reducerea, dar
                vendorul trebuie decontat ca și cum produsul s-a vândut la preț
                întreg. Diferența se scade din comisionul platformei.
              </p>
            </div>
          )}

          <hr />

          <h3>Status și afișare</h3>

          <label>
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => updateField("isActive", e.target.checked)}
            />{" "}
            Activă public
          </label>

          <label>
            <input
              type="checkbox"
              checked={form.showOnHomepage}
              onChange={(e) => updateField("showOnHomepage", e.target.checked)}
            />{" "}
            Afișează pe homepage
          </label>

          <label>
            <input
              type="checkbox"
              checked={form.showInMenu}
              onChange={(e) => updateField("showInMenu", e.target.checked)}
            />{" "}
            Afișează în meniu
          </label>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <button type="submit" className={styles.tab} disabled={saving}>
              {saving
                ? "Se salvează…"
                : editingId
                ? "Actualizează colecția"
                : "Salvează colecția"}
            </button>

            <button
              type="button"
              className={styles.tab}
              onClick={handlePreviewRules}
              disabled={previewLoading}
            >
              {previewLoading ? "Se caută produse…" : "Preview produse automate"}
            </button>

            {editingId && (
              <button type="button" className={styles.tab} onClick={resetForm}>
                Renunță
              </button>
            )}
          </div>

          {!!previewProducts.length && (
            <div>
              <h3>Preview produse automate ({previewProducts.length})</h3>

              <div style={{ display: "grid", gap: 8 }}>
                {previewProducts.map((product) => (
                  <ProductLiteRow key={product.id} product={product} />
                ))}
              </div>
            </div>
          )}

          {editingId && (
            <>
              <hr />

              <h3>Produse manuale / pinned / excluse</h3>

              <p className={styles.subtle}>
                Produsele pinned apar primele. Produsele excluse nu apar în colecție,
                chiar dacă se potrivesc regulilor automate.
              </p>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input
                  placeholder="Caută produse după titlu, categorie sau magazin"
                  value={pickerQuery}
                  onChange={(e) => setPickerQuery(e.target.value)}
                  style={{ flex: "1 1 280px" }}
                />

                <button
                  type="button"
                  className={styles.tab}
                  onClick={loadPickerProducts}
                  disabled={pickerLoading}
                >
                  {pickerLoading ? "Se caută…" : "Caută produse"}
                </button>

                <button
                  type="button"
                  className={styles.tab}
                  onClick={reorderItems}
                  disabled={itemsLoading}
                >
                  Salvează ordinea
                </button>
              </div>

              {!!pickerProducts.length && (
                <div style={{ display: "grid", gap: 8 }}>
                  <h4>Rezultate căutare</h4>

                  {pickerProducts.map((product) => {
                    const alreadyAdded = existingProductIds.has(product.id);

                    return (
                      <div
                        key={product.id}
                        style={{
                          border: "1px solid #eee",
                          borderRadius: 10,
                          padding: 10,
                          display: "grid",
                          gap: 8,
                        }}
                      >
                        <ProductLiteRow product={product} />

                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <button
                            type="button"
                            className={styles.tab}
                            disabled={alreadyAdded}
                            onClick={() =>
                              addProductToCollection(product, { pinned: true })
                            }
                          >
                            {alreadyAdded ? "Adăugat" : "Adaugă pinned"}
                          </button>

                          <button
                            type="button"
                            className={styles.tab}
                            disabled={alreadyAdded}
                            onClick={() =>
                              addProductToCollection(product, { excluded: true })
                            }
                          >
                            Exclude din colecție
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div style={{ display: "grid", gap: 8 }}>
                <h4>
                  Produse setate manual ({collectionItems.length})
                  {itemsLoading ? " — se încarcă…" : ""}
                </h4>

                {!collectionItems.length ? (
                  <p className={styles.subtle}>
                    Nu există produse adăugate manual în această colecție.
                  </p>
                ) : (
                  collectionItems.map((item, index) => (
                    <div
                      key={item.productId}
                      style={{
                        border: "1px solid #eee",
                        borderRadius: 10,
                        padding: 10,
                        display: "grid",
                        gap: 8,
                      }}
                    >
                      {item.product ? (
                        <ProductLiteRow product={item.product} />
                      ) : (
                        <strong>{item.productId}</strong>
                      )}

                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button
                          type="button"
                          className={styles.tab}
                          disabled={index === 0}
                          onClick={() => moveItem(item.productId, "up")}
                        >
                          Sus
                        </button>

                        <button
                          type="button"
                          className={styles.tab}
                          disabled={index === collectionItems.length - 1}
                          onClick={() => moveItem(item.productId, "down")}
                        >
                          Jos
                        </button>

                        <button
                          type="button"
                          className={styles.tab}
                          onClick={() =>
                            updateCollectionItem(item, {
                              pinned: !item.pinned,
                            })
                          }
                        >
                          {item.pinned ? "Scoate pinned" : "Fă pinned"}
                        </button>

                        <button
                          type="button"
                          className={styles.tab}
                          onClick={() =>
                            updateCollectionItem(item, {
                              excluded: !item.excluded,
                            })
                          }
                        >
                          {item.excluded ? "Include" : "Exclude"}
                        </button>

                        <button
                          type="button"
                          className={styles.tab}
                          onClick={() => removeCollectionItem(item)}
                        >
                          Elimină
                        </button>

                        <span className={styles.subtle}>
                          {item.pinned ? "Pinned" : "Auto"} ·{" "}
                          {item.excluded ? "Exclus" : "Inclus"}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </form>
      )}

      {!collections.length ? (
        <p className={styles.emptyState}>Nu există colecții încă.</p>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {collections.map((collection) => (
            <div
              key={collection.id}
              style={{
                border: "1px solid #eee",
                borderRadius: 12,
                padding: 16,
              }}
            >
              <strong>{collection.title}</strong>
              <p className={styles.subtle}>/{collection.slug}</p>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span>{collection.isActive ? "Activă" : "Inactivă"}</span>
                {collection.showOnHomepage && <span>Homepage</span>}
                {collection.showInMenu && <span>Meniu</span>}
                {collection.promoEnabled && (
                  <span>
                    Promo {collection.promoPercent || 0}% ·{" "}
                    {collection.promoFundingSource || "PLATFORM_COMMISSION"}
                  </span>
                )}
                <span>{collection.itemsCount || 0} produse manuale</span>
              </div>

              <div
                style={{
                  marginTop: 12,
                  display: "flex",
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                <a
                  href={`/colectii/${collection.slug}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Vezi pagina publică
                </a>

                <button
                  type="button"
                  className={styles.tab}
                  onClick={() => startEdit(collection)}
                >
                  Editează
                </button>

                <button
                  type="button"
                  className={styles.tab}
                  onClick={() => toggleCollectionStatus(collection)}
                >
                  {collection.isActive ? "Dezactivează" : "Activează"}
                </button>

                <button
                  type="button"
                  className={styles.tab}
                  onClick={() => toggleHomepage(collection)}
                >
                  {collection.showOnHomepage
                    ? "Scoate homepage"
                    : "Pune homepage"}
                </button>

                <button
                  type="button"
                  className={styles.tab}
                  onClick={() => toggleMenu(collection)}
                >
                  {collection.showInMenu ? "Scoate meniu" : "Pune meniu"}
                </button>

                <button
                  type="button"
                  className={styles.tab}
                  onClick={() => duplicateCollection(collection)}
                >
                  Duplică
                </button>

                <button
                  type="button"
                  className={styles.tab}
                  onClick={() => deleteCollection(collection)}
                >
                  Șterge
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ProductLiteRow({ product }) {
  return (
    <div
      style={{
        border: "1px solid #eee",
        borderRadius: 10,
        padding: 10,
        display: "flex",
        gap: 12,
        alignItems: "center",
      }}
    >
      {product.images?.[0] && (
        <img
          src={product.images[0]}
          alt={product.title}
          style={{
            width: 56,
            height: 56,
            objectFit: "cover",
            borderRadius: 8,
          }}
        />
      )}

      <div>
        <strong>{product.title}</strong>
        <div className={styles.subtle}>
          {product.price} {product.currency} ·{" "}
          {product.category || "fără categorie"}
          {product.vendor?.displayName ? ` · ${product.vendor.displayName}` : ""}
        </div>
      </div>
    </div>
  );
}
