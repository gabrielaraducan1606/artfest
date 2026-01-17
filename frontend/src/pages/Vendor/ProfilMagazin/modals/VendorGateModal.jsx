// client/src/pages/Store/ProfilMagazin/modals/VendorGateModal.jsx

import { useState } from "react";
import Modal from "../ui/Modal";
import styles from "../ProfilMagazin.module.css";

/**
 * Construiește URL absolut către backend (dacă VITE_API_URL e setat),
 * altfel păstrează link relativ (same-origin).
 */
function absUrl(pathname) {
  const p = pathname || "";
  if (/^https?:\/\//i.test(p)) return p;
  const rel = p.startsWith("/") ? p : `/${p}`;
  const base = (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");
  return base ? `${base}${rel}` : rel;
}

export default function VendorGateModal({ open, onClose, gateDocs, onAccept }) {
  const [gateChecks, setGateChecks] = useState({
    declaration: false,
    vendorTermsRead: false,
  });

  const [localLoading, setLocalLoading] = useState(false);
  const [localErr, setLocalErr] = useState(null);

  const canClose = !localLoading;

  const handleClose = () => {
    if (canClose) onClose?.();
  };

  /**
   * ✅ Declarație PRODUSE – variantă defensivă juridic
   * - legalitate
   * - IP
   * - acuratețe
   * - răspundere + despăgubire
   * - drept de delistare / suspendare
   */
  const declarationText =
    "Declar pe propria răspundere că toate produsele pe care le listez pe platforma Artfest: " +
    "(1) respectă legislația aplicabilă și nu sunt produse interzise sau periculoase; " +
    "(2) nu încalcă drepturi de autor, mărci sau alte drepturi de proprietate intelectuală și dețin toate drepturile/licențele necesare; " +
    "(3) sunt descrise corect și complet (titlu, descriere, imagini, preț, stoc, termene de livrare); " +
    "(4) sunt realizate, ambalate și livrate cu bună-credință, conform Acordului Marketplace pentru Vânzători și Anexei Produse. " +
    "Înțeleg și accept că răspund integral pentru orice prejudiciu, sancțiune, reclamație sau cost rezultat din încălcarea celor declarate și că voi despăgubi Artfest pentru orice sume sau costuri suportate din această cauză. " +
    "Sunt de acord că Artfest poate delista produse și/sau suspenda contul meu în caz de încălcări sau suspiciuni rezonabile, pentru protecția clienților și a platformei.";

  /**
   * ✅ LINK-URI CANONICE (conform backend/src/server/routes/legal.js):
   *  - /acord-vanzatori  -> /legal/vendor_terms.html
   *  - /anexa-produse    -> /legal/products_addendum.html
   */
  const vendorTermsUrl = absUrl("/acord-vanzatori");
  const productsAddendumUrl = absUrl("/anexa-produse");

  // versiuni – doar pentru afișare / audit
  const vendorTermsVersion = gateDocs?.vendor_terms?.version || "";
  const productsAddendumVersion = gateDocs?.products_addendum?.version || "";
  const productDeclVersion = gateDocs?.product_declaration?.version || "1.0.0";

  const handleConfirm = async () => {
    if (!gateChecks.declaration || localLoading) return;

    setLocalErr(null);
    setLocalLoading(true);

    try {
      // 1) Salvează declarația (VendorProductDeclaration)
      const body = {
        version: productDeclVersion,
        textSnapshot: declarationText,
      };

      const res = await fetch("/api/vendor/product-declaration/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || "server_error");
      }

      // 2) ✅ Marchează acceptarea "Anexa Produse" în VendorAcceptance
      // (prin adaptorul legacy care ia automat latest isActive din VendorPolicy)
      const res2 = await fetch("/api/legal/vendor-accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          accept: [{ type: "products_addendum" }],
        }),
      });

      // Nu blocăm flow-ul dacă adaptorul pică, dar logăm și arătăm un mesaj util
      if (!res2.ok) {
        const data2 = await res2.json().catch(() => ({}));
        console.warn("products_addendum accept failed:", data2);
        // dacă vrei STRICT, poți înlocui warn cu throw ca să nu continue
      }

      if (typeof onAccept === "function") {
        await onAccept();
      }

      onClose?.();
    } catch (e) {
      console.error("VendorGateModal accept error:", e);
      setLocalErr(
        "A apărut o eroare la salvare. Te rugăm să încerci din nou."
      );
    } finally {
      setLocalLoading(false);
    }
  };

  return (
    <Modal open={open} onClose={handleClose} maxWidth={720}>
      <div className={styles.modalHeader}>
        <h3 className={styles.modalTitle}>Înainte să adaugi primul produs</h3>
        <button
          className={styles.modalClose}
          onClick={handleClose}
          disabled={localLoading}
          type="button"
          aria-label="Închide"
        >
          ×
        </button>
      </div>

      <div className={styles.modalBody} aria-busy={localLoading}>
        {localLoading ? (
          <p>Se salvează declarația…</p>
        ) : (
          <>
            <p style={{ marginBottom: 12 }}>
              Pentru a adăuga primul produs în magazinul tău, trebuie să confirmi
              că produsele listate respectă legislația și regulile platformei
              Artfest.
            </p>

            <p style={{ marginBottom: 16, fontSize: 14, opacity: 0.85 }}>
              Declarația de mai jos este complementară{" "}
              <a href={vendorTermsUrl} target="_blank" rel="noreferrer">
                Acordului Marketplace pentru Vânzători
                {vendorTermsVersion ? ` (v${vendorTermsVersion})` : ""}
              </a>{" "}
              și{" "}
              <a href={productsAddendumUrl} target="_blank" rel="noreferrer">
                Anexei Produse
                {productsAddendumVersion ? ` (v${productsAddendumVersion})` : ""}
              </a>
              .
            </p>

            {/* Declarație PRODUSE – OBLIGATORIE */}
            <label style={{ display: "block", margin: "10px 0" }}>
              <input
                type="checkbox"
                checked={!!gateChecks.declaration}
                onChange={(e) =>
                  setGateChecks((s) => ({
                    ...s,
                    declaration: e.target.checked,
                  }))
                }
                required
              />{" "}
              Declar că toate produsele pe care le listez pe platforma Artfest:
              <ul style={{ margin: "6px 0 0 24px", fontSize: 14 }}>
                <li>respectă legislația în vigoare;</li>
                <li>
                  nu încalcă drepturi de autor, mărci sau alte drepturi de
                  proprietate intelectuală;
                </li>
                <li>
                  sunt descrise corect (titlu, descriere, imagini, preț, stoc,
                  termene de livrare);
                </li>
                <li>
                  sunt realizate și livrate cu bună-credință, conform Acordului
                  Marketplace și Anexei Produse.
                </li>
              </ul>
            </label>

            {/* Reminder – opțional */}
            <label style={{ display: "block", margin: "14px 0 10px", fontSize: 14 }}>
              <input
                type="checkbox"
                checked={!!gateChecks.vendorTermsRead}
                onChange={(e) =>
                  setGateChecks((s) => ({
                    ...s,
                    vendorTermsRead: e.target.checked,
                  }))
                }
              />{" "}
              Confirm că am citit{" "}
              <a href={vendorTermsUrl} target="_blank" rel="noreferrer">
                Acordul Marketplace pentru Vânzători
              </a>{" "}
              și{" "}
              <a href={productsAddendumUrl} target="_blank" rel="noreferrer">
                Anexa Produse
              </a>
              . <span style={{ opacity: 0.7 }}>(opțional)</span>
            </label>

            {localErr && (
              <div className={styles.error} style={{ marginTop: 8 }}>
                {localErr}
              </div>
            )}

            <div className={styles.modalFooter}>
              <button
                type="button"
                className={styles.linkBtn}
                onClick={handleClose}
                disabled={localLoading}
              >
                Renunță
              </button>
              <button
                className={styles.primaryBtn}
                onClick={handleConfirm}
                disabled={localLoading || !gateChecks.declaration}
              >
                Confirm și continui
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
