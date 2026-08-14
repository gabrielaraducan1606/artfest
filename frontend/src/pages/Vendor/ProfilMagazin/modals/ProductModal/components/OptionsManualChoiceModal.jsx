import Modal from "../../../ui/Modal";

export default function OptionsManualChoiceModal({
  open,
  onClose,
  onGuided,
  onContinueManual,
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      maxWidth={480}
    >
      <div
        style={{
          padding: "26px",
          color: "var(--color-text)",
        }}
      >
        <div
          style={{
            fontSize: "34px",
            marginBottom: "10px",
          }}
        >
          ✨
        </div>

        <h3
          style={{
            margin: "0 0 10px",
            fontSize: "22px",
            fontFamily: "var(--font-title)",
            color: "var(--color-text)",
          }}
        >
          Vrei să configurezi manual?
        </h3>

        <p
          style={{
            margin: "0 0 8px",
            lineHeight: 1.6,
            color: "var(--color-muted)",
          }}
        >
          Te putem ghida pas cu pas pentru a
          configura corect variantele și
          personalizarea produsului.
        </p>

        <p
          style={{
            margin: "0 0 22px",
            lineHeight: 1.6,
            color: "var(--color-muted)",
          }}
        >
          Dacă alegi, de exemplu, culoare sau
          mărime, te vom întreba imediat ce
          variante sunt disponibile pentru client.
        </p>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "10px",
          }}
        >
          <button
            type="button"
            onClick={onGuided}
            style={{
              width: "100%",
              padding: "13px 16px",
              border: "none",
              borderRadius: "var(--radius)",
              background: "var(--color-primary)",
              color: "#fff",
              fontFamily: "var(--font-body)",
              fontSize: "14px",
              fontWeight: 700,
              cursor: "pointer",
              boxShadow: "var(--shadow-sm)",
            }}
          >
            ✨ Ajută-mă pas cu pas
          </button>

          <button
            type="button"
            onClick={onContinueManual}
            style={{
              width: "100%",
              padding: "12px 16px",
              borderRadius: "var(--radius)",
              background: "var(--surface)",
              color: "var(--color-text)",
              border:
                "1px solid var(--color-border)",
              fontFamily: "var(--font-body)",
              fontSize: "14px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Continui manual
          </button>
        </div>
      </div>
    </Modal>
  );
}