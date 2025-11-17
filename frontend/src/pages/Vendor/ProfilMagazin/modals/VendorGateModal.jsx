// client/src/pages/Store/ProfilMagazin/modals/VendorGateModal.jsx
// rute in agreementsRoutes.js
import Modal from "../ui/Modal";
import styles from "../ProfilMagazin.module.css";

export default function VendorGateModal({
  open,
  onClose,
  gateLoading,
  gateErr,
  gateDocs,
  gateChecks,
  setGateChecks,
  onAccept,
}) {
  const canClose = !gateLoading;

  return (
    <Modal open={open} onClose={() => (canClose ? onClose() : null)} maxWidth={720}>
      <div className={styles.modalHeader}>
        <h3 className={styles.modalTitle}>Finalizează acordurile pentru a continua</h3>
        <button
          className={styles.modalClose}
          onClick={() => (canClose ? onClose() : null)}
          disabled={gateLoading}
          type="button"
          aria-label="Închide"
        >
          ×
        </button>
      </div>

      <div className={styles.modalBody} aria-busy={gateLoading}>
        {gateLoading ? (
          <p>Se verifică acordurile…</p>
        ) : (
          <>
            <p>
              Pentru a adăuga produse, trebuie să accepți documentele de mai jos.
              Linkurile se deschid într-o filă nouă.
            </p>

            <label style={{ display: "block", margin: "10px 0" }}>
              <input
                type="checkbox"
                checked={!!gateChecks.vendor}
                onChange={(e) => setGateChecks((s) => ({ ...s, vendor: e.target.checked }))}
                required
              />{" "}
              Accept{" "}
              <a
                href={gateDocs?.vendor_terms?.url || "/legal/vendor/terms"}
                target="_blank"
                rel="noreferrer"
              >
                Acordul Marketplace pentru Vânzători{" "}
                {gateDocs?.vendor_terms?.version ? `(v${gateDocs?.vendor_terms?.version})` : ""}
              </a>
            </label>

            <label style={{ display: "block", margin: "10px 0" }}>
              <input
                type="checkbox"
                checked={!!gateChecks.shipping}
                onChange={(e) => setGateChecks((s) => ({ ...s, shipping: e.target.checked }))}
                required
              />{" "}
              Accept{" "}
              <a
                href={gateDocs?.shipping_addendum?.url || "/legal/vendor/expediere"}
                target="_blank"
                rel="noreferrer"
              >
                Anexa de Expediere &amp; Curierat{" "}
                {gateDocs?.shipping_addendum?.version
                  ? `(v${gateDocs?.shipping_addendum?.version})`
                  : ""}
              </a>
            </label>

            <label style={{ display: "block", margin: "10px 0" }}>
              <input
                type="checkbox"
                checked={!!gateChecks.returns}
                onChange={(e) => setGateChecks((s) => ({ ...s, returns: e.target.checked }))}
              />{" "}
              Confirm că am citit{" "}
              <a href={gateDocs?.returns_policy?.url || "/retur"} target="_blank" rel="noreferrer">
                Politica de retur{" "}
                {gateDocs?.returns_policy?.version ? `(v${gateDocs?.returns_policy?.version})` : ""}
              </a>{" "}
              <span style={{ opacity: 0.7 }}>(opțional)</span>
            </label>

            {!!gateErr && (
              <div className={styles.error} style={{ marginTop: 8 }}>
                {gateErr}
              </div>
            )}

            <div className={styles.modalFooter}>
              <button
                type="button"
                className={styles.linkBtn}
                onClick={() => (canClose ? onClose() : null)}
                disabled={gateLoading}
              >
                Renunță
              </button>
              <button
                className={styles.primaryBtn}
                onClick={onAccept}
                disabled={gateLoading || !(gateChecks.vendor && gateChecks.shipping)}
                title={
                  !(gateChecks.vendor && gateChecks.shipping)
                    ? "Bifează acordurile obligatorii"
                    : "Continuă"
                }
              >
                Accept și continuă
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
