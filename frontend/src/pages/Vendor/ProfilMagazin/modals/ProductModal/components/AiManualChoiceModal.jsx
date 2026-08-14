import Modal from "../../../ui/Modal";

export default function AiManualChoiceModal({
  open,
  onClose,
  onUseAi,
  onContinueManual,
  aiLoading = false,
  uploadingImages = 0,
  hasImages = false,
}) {
  const aiDisabled =
    aiLoading ||
    uploadingImages > 0 ||
    !hasImages;

  return (
   <Modal
  open={open}
  onClose={() => {
    if (!aiLoading) {
      onClose();
    }
  }}
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
  {aiLoading
    ? "Completez produsul cu AI..."
    : "Vrei să completezi manual?"}
</h3>

        <p
          style={{
            margin: "0 0 8px",
            lineHeight: 1.6,
            color: "var(--color-muted)",
          }}
        >
          Artfest poate completa automat
          detaliile produsului cu AI, pe baza
          fotografiilor încărcate.
        </p>

        <p
          style={{
            margin: "0 0 22px",
            lineHeight: 1.6,
            color: "var(--color-muted)",
          }}
        >
          Îți putem pregăti titlul,
          descrierea, categoria, culorile,
          materialele și alte informații,
          iar tu le poți modifica după.
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
            onClick={onUseAi}
            disabled={aiDisabled}
            style={{
              width: "100%",
              padding: "13px 16px",
              border: "none",
              borderRadius: "var(--radius)",
              background: aiDisabled
                ? "var(--color-border)"
                : "var(--color-primary)",
              color: aiDisabled
                ? "var(--color-muted)"
                : "#fff",
              fontFamily: "var(--font-body)",
              fontSize: "14px",
              fontWeight: 700,
              cursor: aiDisabled
                ? "not-allowed"
                : "pointer",
              boxShadow: "var(--shadow-sm)",
              opacity: aiDisabled ? 0.7 : 1,
            }}
          >
            {aiLoading
              ? "Se completează..."
              : "✨ Completează automat cu AI"}
          </button>

          {!hasImages && (
            <p
              style={{
                margin: 0,
                fontSize: "13px",
                color: "var(--color-muted)",
                textAlign: "center",
              }}
            >
              Încarcă mai întâi cel puțin o
              fotografie.
            </p>
          )}

         {!aiLoading && (
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
)}
        </div>
      </div>
    </Modal>
  );
}