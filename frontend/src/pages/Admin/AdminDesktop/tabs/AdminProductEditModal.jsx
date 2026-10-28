import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { api } from "../../../../lib/api";
import { CATEGORIES_DETAILED } from "../../../../constants/productscategories.js";
import ProductDetailsSection from "../../../Vendor/ProfilMagazin/modals/ProductModal/components/ProductDetailsSection.jsx";
import ProductOrderModeSection from "../../../Vendor/ProfilMagazin/modals/ProductModal/components/ProductOrderModeSection.jsx";
import ProductGpsrSection from "../../../Vendor/ProfilMagazin/modals/ProductModal/components/ProductGpsrSection.jsx";
import {
  useProductFieldOptions,
  useQuoteSchemaEditor,
} from "../../../Vendor/ProfilMagazin/modals/productEditorShared.js";
import {
  buildAdminProductPatch,
  getAdminPublicProductLink,
  productToAdminForm,
  validateAdminProductForm,
} from "./adminProductEditForm.js";

/*
 * Editorul de produs din Admin - REUTILIZEAZĂ secțiunile editorului de
 * Vendor (detalii/atribute, mod de comandă + variante/personalizare/
 * ofertă, GPSR). Separat rămân doar câmpurile strict Admin: statusurile
 * de disponibilitate pe care editorul Vendor nu le are (Precomandă /
 * Epuizat), activ / ascuns. Moderarea are acțiunile ei separate.
 *
 * Siguranță (audit 2026-10-23): produsul din listă NU conține modul de
 * comandă și schemele - îl încărcăm COMPLET (GET /api/admin/products/:id)
 * și trimitem la salvare DOAR câmpurile schimbate.
 */
export default function AdminProductEditForm({
  product,
  onSaved,
  onCancel,
}) {
  const productId = product?.id || null;

  const [loaded, setLoaded] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [form, setForm] = useState(null);
  const initialRef = useRef(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const fieldOptions = useProductFieldOptions(CATEGORIES_DETAILED);
  const quoteEditor = useQuoteSchemaEditor(setForm);

  useEffect(() => {
    let alive = true;

    setLoaded(null);
    setForm(null);
    setLoadError("");
    initialRef.current = null;

    if (!productId) return undefined;

    api(`/api/admin/products/${encodeURIComponent(productId)}`)
      .then((full) => {
        if (!alive) return;
        const initial = productToAdminForm(full);
        initialRef.current = initial;
        setLoaded(full);
        setForm(initial);
      })
      .catch((e) => {
        if (!alive) return;
        setLoadError(
          e?.data?.message || e?.message || "Produsul nu a putut fi încărcat."
        );
      });

    return () => {
      alive = false;
    };
  }, [productId]);

  const updateField = useCallback(
    (field) => (eventOrValue) => {
      const value = eventOrValue?.target?.value ?? eventOrValue;
      setForm((current) => ({ ...current, [field]: value }));
    },
    []
  );

  const patch = (values) =>
    setForm((current) => ({ ...current, ...values }));

  async function save() {
    if (!form || !initialRef.current) return;

    const payload = buildAdminProductPatch(initialRef.current, form);

    setError("");
    setNotice("");

    if (!Object.keys(payload).length) {
      setNotice("Nu există modificări de salvat.");
      return;
    }

    const validationError = validateAdminProductForm(form, payload);
    if (validationError) {
      setError(validationError);
      return;
    }

    try {
      setSaving(true);

      const data = await api(
        `/api/admin/products/${encodeURIComponent(productId)}`,
        { method: "PATCH", body: payload }
      );

      onSaved?.(data?.product || { ...product, ...payload });
    } catch (e) {
      setError(
        e?.data?.message || e?.message || "Produsul nu a putut fi salvat."
      );
    } finally {
      setSaving(false);
    }
  }

  if (loadError) {
    return (
      <div style={{ display: "grid", gap: 12 }}>
        <div style={errorBox}>{loadError}</div>
        {onCancel && (
          <div>
            <button type="button" onClick={onCancel} style={secondaryBtn}>
              Înapoi
            </button>
          </div>
        )}
      </div>
    );
  }

  if (!form) {
    return <div style={{ padding: 12, color: "#6b7280" }}>Se încarcă produsul...</div>;
  }

  const publicLink = getAdminPublicProductLink(loaded);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {error && <div style={errorBox}>{error}</div>}

      {/* Titlu, categorie, descriere, material, tehnică, culoare,
          stil, ocazii, dimensiuni, îngrijire, note - secțiunea Vendor */}
      <section style={{ display: "grid", gap: 12 }}>
        <ProductDetailsSection
          form={form}
          setForm={setForm}
          updateField={updateField}
          materialOptions={fieldOptions.materialOptions}
          techniqueOptions={fieldOptions.techniqueOptions}
          styleOptions={fieldOptions.styleOptions}
          occasionOptions={fieldOptions.occasionOptions}
          careOptions={fieldOptions.careOptions}
          colorOptions={fieldOptions.colorOptions}
          categoryProps={{ options: fieldOptions.options }}
          isExistingProduct
        />
      </section>

      {/* Mod de comandă, preț, stoc / timp de execuție, variante,
          personalizare, grupuri repetate, cerere ofertă - secțiunea Vendor */}
      <section style={{ display: "grid", gap: 12 }}>
        <ProductOrderModeSection
          form={form}
          setForm={setForm}
          quoteSchema={form.quoteSchema}
          {...quoteEditor}
          priceReadOnly
          // peste .modalBackdrop din AdminProductsTab (z-index 9999)
          nestedModalZIndex={10000}
        />
      </section>

      {/* Doar Admin: statusurile pe care editorul Vendor nu le are */}
      <section style={adminBox}>
        <h4 style={{ margin: 0 }}>Disponibilitate (Admin)</h4>
        <label>
          <div>Status disponibilitate</div>
          <select
            value={form.availability}
            onChange={(e) => patch({ availability: e.target.value })}
            style={inputStyle}
          >
            <option value="READY">Disponibil (stoc)</option>
            <option value="MADE_TO_ORDER">La comandă</option>
            <option value="PREORDER">Precomandă</option>
            <option value="SOLD_OUT">Epuizat</option>
          </select>
        </label>

        {form.availability === "PREORDER" && (
          <label>
            <div>Data estimată de livrare</div>
            <input
              type="date"
              value={form.nextShipDate || ""}
              onChange={(e) => patch({ nextShipDate: e.target.value })}
              style={inputStyle}
            />
          </label>
        )}
      </section>

      {/* GPSR (Reg. UE 2023/988) - adminul poate corecta, nu completează automat */}
      <section style={{ display: "grid", gap: 12 }}>
        <ProductGpsrSection
          form={form}
          setForm={setForm}
          // aceleași date publice ca pagina produsului: sursa centrală a vendorului
          manufacturerProfile={
            loaded?.gpsrManufacturer || { name: "", address: "", email: "", complete: false }
          }
        />
      </section>

      <section style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
        <label style={checkboxLabel}>
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(e) => patch({ isActive: e.target.checked })}
          />
          Produs activ
        </label>

        <label style={checkboxLabel}>
          <input
            type="checkbox"
            checked={form.isHidden}
            onChange={(e) => patch({ isHidden: e.target.checked })}
          />
          Produs ascuns
        </label>
      </section>

      {notice && <div style={{ fontSize: 13, color: "#374151" }}>{notice}</div>}

      <div style={actionsRow}>
        {/* Doar deschide pagina publică - nu schimbă statusul / moderarea */}
        <div style={previewWrap}>
          {publicLink.href ? (
            <a
              href={publicLink.href}
              target="_blank"
              rel="noopener noreferrer"
              style={previewLink}
              title="Pagina publică arată varianta salvată a produsului"
            >
              Vezi cum vede clientul ↗
            </a>
          ) : (
            <>
              <button
                type="button"
                disabled
                aria-describedby="admin-public-preview-reason"
                style={previewDisabled}
              >
                Vezi cum vede clientul
              </button>
              <span id="admin-public-preview-reason" style={previewReason}>
                {publicLink.reason}
              </span>
            </>
          )}
        </div>

        {onCancel && (
          <button type="button" onClick={onCancel} disabled={saving} style={secondaryBtn}>
            Anulează
          </button>
        )}

        <button type="button" onClick={save} disabled={saving} style={primaryBtn(saving)}>
          {saving ? "Se salvează..." : "Salvează modificările"}
        </button>
      </div>
    </div>
  );
}

const inputStyle = {
  width: "100%",
  marginTop: 5,
  padding: "10px 11px",
  border: "1px solid #d1d5db",
  borderRadius: 9,
  boxSizing: "border-box",
};

const errorBox = {
  padding: "10px 12px",
  border: "1px solid #fecaca",
  background: "#fef2f2",
  color: "#991b1b",
  borderRadius: 10,
};

const adminBox = {
  display: "grid",
  gap: 12,
  padding: 16,
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  background: "#fff",
};

const checkboxLabel = {
  display: "flex",
  gap: 7,
  alignItems: "center",
};

const actionsRow = {
  display: "flex",
  justifyContent: "flex-end",
  alignItems: "center",
  flexWrap: "wrap",
  gap: 10,
  paddingTop: 10,
  borderTop: "1px solid #e5e7eb",
};

const previewWrap = {
  marginRight: "auto",
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  gap: 4,
  minWidth: 0,
  maxWidth: "100%",
};

const previewLink = {
  padding: "10px 14px",
  border: "1px solid #c4b5fd",
  background: "#f5f3ff",
  color: "#5b21b6",
  borderRadius: 9,
  fontWeight: 600,
  textDecoration: "none",
  whiteSpace: "nowrap",
};

const previewDisabled = {
  padding: "10px 14px",
  border: "1px solid #e5e7eb",
  background: "#f9fafb",
  color: "#9ca3af",
  borderRadius: 9,
  cursor: "not-allowed",
};

const previewReason = {
  fontSize: 12,
  color: "#6b7280",
};

const secondaryBtn = {
  padding: "10px 14px",
  border: "1px solid #d1d5db",
  background: "#fff",
  borderRadius: 9,
  cursor: "pointer",
};

const primaryBtn = (saving) => ({
  padding: "10px 16px",
  border: 0,
  background: "#111827",
  color: "#fff",
  borderRadius: 9,
  cursor: saving ? "default" : "pointer",
  fontWeight: 700,
});
