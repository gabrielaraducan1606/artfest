// src/pages/Vendor/ProductChanges/ProductChangesPage.jsx

/*
 * „Modificări solicitate pentru produs” - sursa clară de adevăr pentru
 * vendor: ce produs, ce trebuie schimbat, unde editează, când confirmă.
 * Date: GET /api/vendors/products/:id/change-request (doar proprietarul;
 * 403 pentru alt vendor). Confirmare: POST .../changes-done (idempotent).
 */

import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { api } from "../../../lib/api";
import {
  applyContactFixToProductForm,
  dispatchProductSaved,
  fetchVendorProduct,
  handleProductSaveError,
  productFormFromApi,
  showProductSaveReport,
  updateVendorProduct,
  uploadProductFile,
} from "../ProfilMagazin/utils/productEditing.js";
import { fetchDetailedCategories } from "../ProfilMagazin/hooks/useProfilMagazin.js";
import { CONTACT_FIX_APPLY_EVENT } from "../../../components/AIAssistant/contactInfo/contactInfoFixFlow.js";
import styles from "./ProductChangesPage.module.css";
import { useAnnounceCurrentEntity } from "../../../components/AIAssistant/CurrentEntityContext.jsx";
import { openVendorAssistantTask } from "../../../components/AIAssistant/contactInfo/contactInfoFixFlow.js";
import {
  PRODUCT_CHANGES_TASK,
  buildProductChangesPrompt,
  getChangeStageMeta,
} from "../../../features/productChanges/changeRequestReasons.js";

// același editor ca în ProfilMagazin (lazy, ca în StoreModals)
const ProductModal = lazy(() => import("../ProfilMagazin/modals/ProductModal.jsx"));

const HISTORY_LABELS = {
  REQUESTED: "Artfest a solicitat modificări",
  CONFIRMED: "Ai confirmat că ai făcut modificările",
  APPROVED: "Produs aprobat",
  REJECTED: "Produs respins",
};

function formatDay(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";

  return new Intl.DateTimeFormat("ro-RO", { day: "numeric", month: "short" }).format(d);
}

function toneClass(tone) {
  if (tone === "warning") return styles.badgeWarning;
  if (tone === "success") return styles.badgeSuccess;
  if (tone === "danger") return styles.badgeDanger;
  return styles.badgeInfo;
}

export default function ProductChangesPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState("");
  const [notice, setNotice] = useState("");
  // ref, nu state: un al doilea click din aceeași tură nu vede încă state-ul nou
  const confirmingRef = useRef(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      setData(await api(`/api/vendors/products/${encodeURIComponent(id)}/change-request`));
    } catch (e) {
      setData(null);
      setError(
        e?.status === 403
          ? "Nu ai acces la acest produs."
          : e?.status === 404
            ? "Produsul nu a fost găsit."
            : e?.message || "Nu am putut încărca modificările."
      );
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  /*
   * Editorul Vendor existent (ProductModal + useProductEditorController),
   * deschis ÎN această pagină - aceeași încărcare / salvare ca în
   * ProfilMagazin (utils/productEditing.js). GET-ul și PUT-ul verifică
   * proprietarul (403 pentru alt vendor). Salvarea NU confirmă
   * solicitarea - „Am făcut modificările” rămâne o acțiune separată.
   */
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorLoading, setEditorLoading] = useState(false);
  const [editorProduct, setEditorProduct] = useState(null);
  const [editorForm, setEditorForm] = useState(null);
  const [savingProduct, setSavingProduct] = useState(false);
  const [categories, setCategories] = useState([]);
  const saveLockRef = useRef(false);

  async function openEditor() {
    if (editorLoading) return;

    try {
      setEditorLoading(true);
      setNotice("");

      const [full, detailedCategories] = await Promise.all([
        fetchVendorProduct(id),
        categories.length ? categories : fetchDetailedCategories(),
      ]);

      setCategories(detailedCategories);
      setEditorForm(productFormFromApi(full));
      setEditorProduct(full);
      setEditorOpen(true);
    } catch (e) {
      setNotice("");
      alert(
        e?.status === 403
          ? "Nu ai acces la acest produs."
          : "Nu am putut încărca produsul pentru editare."
      );
    } finally {
      setEditorLoading(false);
    }
  }

  function closeEditor() {
    saveLockRef.current = false;
    setEditorOpen(false);
  }

  async function saveEditor(event) {
    event?.preventDefault?.();

    if (saveLockRef.current || !editorProduct) return;
    saveLockRef.current = true;

    try {
      setSavingProduct(true);

      const saved = await updateVendorProduct(editorProduct.id || editorProduct._id, editorForm);

      dispatchProductSaved(saved, { isEdit: true });
      closeEditor();
      showProductSaveReport(saved);

      await load();
      setNotice("Modificările produsului au fost salvate.");
    } catch (e) {
      handleProductSaveError(e, { navigate });
    } finally {
      saveLockRef.current = false;
      setSavingProduct(false);
    }
  }

  // „Aplică varianta propusă” din Asistent (salvare blocată de date de contact)
  const contactFixStateRef = useRef(null);
  contactFixStateRef.current = { open: editorOpen, editingId: editorProduct?.id || null };

  useEffect(() => {
    function onContactFixApply(event) {
      applyContactFixToProductForm(event?.detail || {}, {
        ...contactFixStateRef.current,
        setForm: setEditorForm,
      });
    }

    window.addEventListener(CONTACT_FIX_APPLY_EVENT, onContactFixApply);
    return () => window.removeEventListener(CONTACT_FIX_APPLY_EVENT, onContactFixApply);
  }, []);

  const product = data?.product || null;
  const changeRequest = data?.changeRequest?.open ? data.changeRequest : null;
  const stage = product?.stage || product?.moderationStatus;
  const stageMeta = getChangeStageMeta(stage);
  const history = Array.isArray(data?.history) ? data.history : [];
  const reasonLabels = changeRequest?.reasonLabels || [];
  const note = changeRequest ? changeRequest.note : "";
  const legacyMessage = !changeRequest && stage === "CHANGES_REQUESTED" ? product?.moderationMessage : "";
  const blockedReport =
    product?.moderationReport?.decision === "BLOCK_PUBLICATION" ? product.moderationReport : null;

  useAnnounceCurrentEntity(product ? { type: "PRODUCT", id: product.id, name: product.title || "" } : null);

  async function confirmChanges() {
    if (confirmingRef.current) return;
    confirmingRef.current = true;

    try {
      setConfirming(true);
      setConfirmError("");
      setNotice("");

      const res = await api(`/api/vendors/products/${encodeURIComponent(id)}/changes-done`, {
        method: "POST",
      });

      setData(res);

      if (res?.blocked) {
        setConfirmError("Verificarea automată a găsit o problemă la imagini. Corectează-o și confirmă din nou.");
      }
    } catch (e) {
      setConfirmError(e?.message || "Nu am putut trimite confirmarea. Încearcă din nou.");
    } finally {
      confirmingRef.current = false;
      setConfirming(false);
    }
  }

  function askAssistant() {
    if (!product) return;

    openVendorAssistantTask({
      task: PRODUCT_CHANGES_TASK,
      productId: product.id,
      title: product.title,
      reasons: changeRequest?.reasons || [],
      reasonLabels,
      note,
      prompt: buildProductChangesPrompt({ title: product.title, reasonLabels, note }),
    });
  }

  if (loading && !data) {
    return (
      <main className={styles.page}>
        <p className={styles.muted}>Se încarcă...</p>
      </main>
    );
  }

  if (error || !product) {
    return (
      <main className={styles.page}>
        <h1 className={styles.title}>Modificări solicitate pentru produs</h1>
        <p className={styles.errorBox}>{error || "Nu am putut încărca modificările."}</p>
        <Link to="/vendor/store" className={styles.backLink}>
          ← Înapoi la magazin
        </Link>
      </main>
    );
  }

  const isWaitingVendor = stage === "CHANGES_REQUESTED";
  const isRereview = stage === "REREVIEW";
  const storeLink = product.storeSlug ? `/magazin/${encodeURIComponent(product.storeSlug)}` : "/vendor/store";

  return (
    <main className={styles.page}>
      <Link to={storeLink} className={styles.backLink}>
        ← Înapoi la magazin
      </Link>

      <h1 className={styles.title}>Modificări solicitate pentru produs</h1>

      <section className={styles.productCard}>
        {product.image ? (
          <img src={product.image} alt="" className={styles.productImage} />
        ) : (
          <div className={styles.productImagePlaceholder}>Fără poză</div>
        )}

        <div className={styles.productInfo}>
          <div className={styles.productTitle}>{product.title || "Produs fără titlu"}</div>
          <span className={`${styles.badge} ${toneClass(stageMeta.tone)}`}>{stageMeta.label}</span>

          {changeRequest && isWaitingVendor ? (
            <div className={styles.visibility}>
              {product.moderationStatus === "APPROVED"
                ? "Produsul rămâne vizibil pe site cât timp faci modificările."
                : product.isHidden && changeRequest.hideProduct
                  ? "Produsul este ascuns temporar până la corectare."
                  : "Produsul nu apare pe site până la aprobare."}
            </div>
          ) : null}
        </div>
      </section>

      {notice ? <p className={styles.notice}>{notice}</p> : null}

      {isRereview ? (
        <section className={styles.stateCard}>
          <strong>Mulțumim! Am primit confirmarea ta.</strong>
          <span>Echipa Artfest verifică din nou produsul. Te anunțăm când e gata.</span>
        </section>
      ) : null}

      {stage === "APPROVED" && !changeRequest ? (
        <section className={`${styles.stateCard} ${styles.stateSuccess}`}>
          <strong>Produsul tău a fost aprobat.</strong>
          <span>Nu mai ai nimic de modificat.</span>
        </section>
      ) : null}

      {changeRequest || legacyMessage ? (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Ce trebuie să modifici</h2>

          {reasonLabels.length ? (
            <ul className={styles.checklist}>
              {reasonLabels.map((label) => (
                <li key={label} className={styles.checkItem}>
                  <span className={styles.checkIcon} aria-hidden="true">
                    ✓
                  </span>
                  {label}
                </li>
              ))}
            </ul>
          ) : null}

          {note || legacyMessage ? (
            <div className={styles.noteBox}>
              <div className={styles.noteTitle}>Observația Artfest</div>
              <p className={styles.noteText}>{note || legacyMessage}</p>
            </div>
          ) : null}
        </section>
      ) : null}

      {blockedReport ? (
        <section className={styles.blockedBox} role="alert">
          <strong>{blockedReport.message}</strong>
          <ul>
            {(blockedReport.images || []).map((image) => (
              <li key={`${image.index}-${image.url}`}>
                Imaginea {image.position}: {(image.messages || []).join(" ")}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {isWaitingVendor ? (
        <section className={styles.actions}>
          <ol className={styles.steps}>
            <li>Editează produsul și salvează.</li>
            <li>Revino aici și confirmă.</li>
          </ol>

          <div className={styles.buttons}>
            <button
              type="button"
              className={notice ? styles.secondaryBtn : styles.primaryBtn}
              onClick={openEditor}
              disabled={editorLoading}
            >
              {editorLoading ? "Se deschide..." : "Editează produsul"}
            </button>

            {data?.canConfirm ? (
              <button
                type="button"
                className={notice ? styles.primaryBtn : styles.secondaryBtn}
                onClick={confirmChanges}
                disabled={confirming}
              >
                {confirming ? "Se trimite..." : "Am făcut modificările"}
              </button>
            ) : null}
          </div>

          {confirmError ? <p className={styles.errorText}>{confirmError}</p> : null}

          <button type="button" className={styles.helpLink} onClick={askAssistant}>
            Ai nevoie de ajutor? Întreabă Asistentul Artfest
          </button>
        </section>
      ) : null}

      {history.length ? (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Istoric</h2>

          <ul className={styles.history}>
            {history.map((event, index) => (
              <li key={`${event.type}-${event.at}-${index}`} className={styles.historyItem}>
                <span className={styles.historyDate}>{formatDay(event.at)}</span>
                <span>{HISTORY_LABELS[event.type] || event.type}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {editorOpen && editorForm ? (
        <Suspense fallback={null}>
          <ProductModal
            open={editorOpen}
            onClose={closeEditor}
            saving={savingProduct}
            editingProduct={editorProduct}
            form={editorForm}
            setForm={setEditorForm}
            categories={categories}
            onSave={saveEditor}
            uploadFile={uploadProductFile}
            storeSlug={product.storeSlug}
            initialStep="images"
          />
        </Suspense>
      ) : null}
    </main>
  );
}
