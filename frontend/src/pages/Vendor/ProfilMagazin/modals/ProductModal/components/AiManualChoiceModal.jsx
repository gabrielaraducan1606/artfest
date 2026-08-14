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
  return (
    <Modal
      open={open}
      onClose={onClose}
      maxWidth={480}
    >
      <div
        style={{
          padding: "26px",
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
          }}
        >
          Vrei să completezi manual?
        </h3>

        <p
          style={{
            margin: "0 0 8px",
            lineHeight: 1.6,
            color: "#555",
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
            color: "#555",
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
            disabled={
              aiLoading ||
              uploadingImages > 0 ||
              !hasImages
            }
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
                color: "#777",
                textAlign: "center",
              }}
            >
              Încarcă mai întâi cel puțin o
              fotografie.
            </p>
          )}

          <button
            type="button"
            onClick={onContinueManual}
          >
            Continui manual
          </button>
        </div>
      </div>
    </Modal>
  );
}