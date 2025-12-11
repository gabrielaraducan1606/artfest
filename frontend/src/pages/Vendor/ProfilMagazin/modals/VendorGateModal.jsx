// client/src/pages/Store/ProfilMagazin/modals/VendorGateModal.jsx

import { useState } from "react";
import Modal from "../ui/Modal";
import styles from "../ProfilMagazin.module.css";

export default function VendorGateModal({
  open,
  onClose,
  gateDocs,
  onAccept, // callback opțional, apelat după ce s-a salvat cu succes în DB
}) {
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

  // textul declarației – îl folosim și ca snapshot către backend
  const declarationText =
    "Declar că toate produsele pe care le listez pe platforma Artfest: " +
    "respectă legislația în vigoare și nu sunt produse interzise sau periculoase; " +
    "nu încalcă drepturi de autor, mărci sau alte drepturi de proprietate intelectuală; " +
    "sunt descrise corect (titlu, descriere, imagini, preț, stoc, termene de livrare); " +
    "sunt realizate, ambalate și livrate cu bună-credință, conform Acordului Marketplace pentru Vânzători.";

  const handleConfirm = async () => {
    if (!gateChecks.declaration || localLoading) return;

    setLocalErr(null);
    setLocalLoading(true);

    try {
      const body = {
        version: gateDocs?.product_declaration?.version || "1.0.0",
        textSnapshot: declarationText,
      };

      const res = await fetch("/api/vendor/product-declaration/accept", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || "server_error");
      }

      // dacă ai un callback în părinte (de ex. să refaci statusul/gate-ul)
      if (typeof onAccept === "function") {
        await onAccept();
      }

      // închidem modalul după succes
      onClose?.();
    } catch (e) {
      console.error("VendorGateModal accept error:", e);
      setLocalErr(
        "A apărut o eroare la salvarea declarației. Te rugăm să încerci din nou."
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
              Pentru a adăuga primul produs în magazinul tău, trebuie să confirmi că produsele
              pe care le listezi respectă legislația în vigoare și regulile platformei Artfest.
            </p>

            <p style={{ marginBottom: 16, fontSize: 14, opacity: 0.85 }}>
              Declarația de mai jos se aplică tuturor produselor pe care le vei adăuga în viitor
              și este complementară{" "}
              <a
                href={gateDocs?.vendor_terms?.url || "/legal/vendor/terms"}
                target="_blank"
                rel="noreferrer"
              >
                Acordului Marketplace pentru Vânzători
                {gateDocs?.vendor_terms?.version
                  ? ` (v${gateDocs?.vendor_terms?.version})`
                  : ""}
              </a>
              .
            </p>

            {/* Declarație de conformitate produse – OBLIGATORIE */}
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
                <li>
                  respectă legislația în vigoare și nu sunt produse interzise sau periculoase;
                </li>
                <li>
                  nu încalcă drepturi de autor, mărci sau alte drepturi de proprietate intelectuală;
                </li>
                <li>
                  sunt descrise corect (titlu, descriere, imagini, preț, stoc, termene de livrare);
                </li>
                <li>
                  sunt realizate, ambalate și livrate cu bună-credință, conform Acordului Marketplace
                  pentru Vânzători.
                </li>
              </ul>
            </label>

            {/* Acordul Marketplace – doar reminder, opțional */}
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
              <a
                href={gateDocs?.vendor_terms?.url || "/legal/vendor/terms"}
                target="_blank"
                rel="noreferrer"
              >
                Acordul Marketplace pentru Vânzători
                {gateDocs?.vendor_terms?.version
                  ? ` (v${gateDocs?.vendor_terms?.version})`
                  : ""}
              </a>{" "}
              și că produsele mele vor respecta aceste condiții.
              <span style={{ opacity: 0.7 }}> (opțional)</span>
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
                title={
                  !gateChecks.declaration
                    ? "Trebuie să confirmi declarația de conformitate pentru a continua"
                    : "Continuă către adăugarea produsului"
                }
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
