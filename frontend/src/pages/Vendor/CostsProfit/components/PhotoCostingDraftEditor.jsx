// src/pages/Vendor/CostsProfit/components/PhotoCostingDraftEditor.jsx

import { useEffect, useState } from "react";

import { fetchCostItems } from "../costLibraryApi.js";
import { analyzeCostingImages } from "../costingImageAnalysisApi.js";
import { uploadVendorProductImages } from "../../../../components/AIAssistant/VendorAIAssistant/services/vendorProductAi.js";

/* =========================================================
   Editor de draft "analiză din fotografie", reutilizabil -
   folosit atât de PhotoCostingModal (pagina de detaliu
   costing), cât și direct în Vendor Assistant (chat), fără
   duplicarea logicii de upload/analiză/matching/validare.

   Nu salvează nimic singur - la confirmare, doar întoarce
   lista de materiale (`onConfirm(materials)`); apelantul
   decide ce face cu ea (salvează direct pe un produs,
   întreabă de asociere, sau doar calculează temporar).
========================================================= */

const LOW_CONFIDENCE_THRESHOLD = 0.6;

let localIdCounter = 0;

function nextLocalId() {
  localIdCounter += 1;
  return `draft-${localIdCounter}`;
}

function componentFromAiResult(raw) {
  return {
    _id: nextLocalId(),
    label: raw.label || "",
    quantity: raw.suggestedQuantity || 1,
    unit: raw.suggestedUnit || "",
    confidence:
      typeof raw.confidence === "number"
        ? raw.confidence
        : null,
    matchedCostItemId: raw.matchedCostItemId || null,
    matchedCostItemName:
      raw.matchedCostItemName || null,
    matchedUnitCostCents:
      raw.matchedUnitCostCents ?? null,
    needsUserInput: Boolean(raw.needsUserInput),

    manualUnitCostLei:
      raw.matchedUnitCostCents != null
        ? String(raw.matchedUnitCostCents / 100)
        : "",
  };
}

function emptyComponentRow() {
  return {
    _id: nextLocalId(),
    label: "",
    quantity: 1,
    unit: "",
    confidence: null,
    matchedCostItemId: null,
    matchedCostItemName: null,
    matchedUnitCostCents: null,
    needsUserInput: true,
    manualUnitCostLei: "",
  };
}

function validateRow(row) {
  if (!row.label.trim()) return false;
  if (!(Number(row.quantity) > 0)) return false;

  if (row.matchedCostItemId) return true;

  const manual = Number(row.manualUnitCostLei);
  return Number.isFinite(manual) && manual >= 0;
}

function rowsToMaterials(components) {
  return components.map((row) => ({
    name: row.label.trim(),
    quantity: Number(row.quantity),
    unit: row.unit.trim(),

    unitCost: row.matchedCostItemId
      ? row.matchedUnitCostCents / 100
      : Number(row.manualUnitCostLei),

    costItemId: row.matchedCostItemId || null,
  }));
}

export default function PhotoCostingDraftEditor({
  initialImageUrl = null,
  initialFile = null,
  onConfirm,
  onCancel,
  confirmLabel = "Confirmă componentele și calculează",
  busy = false,
  busyLabel = "Se salvează...",
  externalError = "",
  hint = "AI-ul identifică materialele/componentele probabile din fotografie și cantitatea estimată — nu inventează costuri. Costul vine doar din biblioteca ta, iar tu trebuie să confirmi (sau completezi) fiecare linie înainte de a continua.",
}) {
  const [libraryItems, setLibraryItems] = useState(
    []
  );

  const [selectedFile, setSelectedFile] = useState(
    initialFile || null
  );

  const [previewUrl, setPreviewUrl] = useState(
    null
  );

  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] =
    useState("");

  const [components, setComponents] = useState(
    null
  );

  /*
   * URL-ul (deja încărcat) al imaginii analizate - păstrat ca să
   * poată fi întors apelantului la confirmare (al doilea argument
   * al onConfirm), fără să reîncărcăm nimic. Opțional - apelanții
   * care nu îl folosesc (ex. PhotoCostingModal) rămân neschimbați.
   */
  const [analyzedImageUrl, setAnalyzedImageUrl] =
    useState(null);

  useEffect(() => {
    fetchCostItems({ isActive: "true" })
      .then(setLibraryItems)
      .catch(() => setLibraryItems([]));
  }, []);

  useEffect(() => {
    if (!selectedFile) {
      setPreviewUrl(null);
      return;
    }

    const url = URL.createObjectURL(selectedFile);
    setPreviewUrl(url);

    return () => URL.revokeObjectURL(url);
  }, [selectedFile]);

  async function handleAnalyze(sourceUrl) {
    setAnalyzeError("");
    setAnalyzing(true);

    try {
      let imageUrl = sourceUrl;

      if (!imageUrl && selectedFile) {
        const uploaded =
          await uploadVendorProductImages([
            { file: selectedFile },
          ]);

        imageUrl = uploaded[0];
      }

      if (!imageUrl) {
        throw new Error(
          "Alege imaginea principală sau încarcă o fotografie."
        );
      }

      const results = await analyzeCostingImages([
        imageUrl,
      ]);

      setComponents(
        results.map(componentFromAiResult)
      );

      setAnalyzedImageUrl(imageUrl);
    } catch (err) {
      setAnalyzeError(
        err instanceof Error
          ? err.message
          : "Analiza imaginii a eșuat."
      );
    } finally {
      setAnalyzing(false);
    }
  }

  /*
   * Dacă venim cu o fotografie deja aleasă (ex: uploadată
   * direct în chat), pornim analiza automat, o singură dată.
   */
  useEffect(() => {
    if (initialFile) {
      handleAnalyze(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateRow(id, patch) {
    setComponents((current) =>
      current.map((row) =>
        row._id === id
          ? { ...row, ...patch }
          : row
      )
    );
  }

  function removeRow(id) {
    setComponents((current) =>
      current.filter((row) => row._id !== id)
    );
  }

  function addRow() {
    setComponents((current) => [
      ...(current || []),
      emptyComponentRow(),
    ]);
  }

  function handleLibrarySelect(id, costItemId) {
    if (!costItemId) {
      updateRow(id, {
        matchedCostItemId: null,
        matchedCostItemName: null,
        matchedUnitCostCents: null,
        needsUserInput: true,
      });

      return;
    }

    const libItem = libraryItems.find(
      (item) => item.id === costItemId
    );

    if (!libItem) return;

    updateRow(id, {
      matchedCostItemId: libItem.id,
      matchedCostItemName: libItem.name,
      matchedUnitCostCents: libItem.unitCostCents,
      needsUserInput: false,

      manualUnitCostLei: String(
        libItem.unitCostCents / 100
      ),
    });
  }

  const allValid =
    Array.isArray(components) &&
    components.length > 0 &&
    components.every(validateRow);

  function handleConfirmClick() {
    if (!allValid || busy) return;

    onConfirm?.(
      rowsToMaterials(components),
      analyzedImageUrl
    );
  }

  return (
    <div>
      <p style={hintStyle}>{hint}</p>

      {!components && (
        <div style={sourcePickerStyle}>
          {initialImageUrl && (
            <button
              type="button"
              onClick={() =>
                handleAnalyze(initialImageUrl)
              }
              disabled={analyzing}
              style={primaryBtnStyle}
            >
              {analyzing
                ? "Analizez..."
                : "Folosește imaginea principală a produsului"}
            </button>
          )}

          {!initialFile && (
            <>
              <div style={{ textAlign: "center" }}>
                <small style={{ color: "var(--color-muted, #6b7280)" }}>
                  sau
                </small>
              </div>

              <label style={fileLabelStyle}>
                <input
                  type="file"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={(e) =>
                    setSelectedFile(
                      e.target.files?.[0] || null
                    )
                  }
                />

                {selectedFile
                  ? `Fotografie selectată: ${selectedFile.name}`
                  : "Încarcă o fotografie nouă"}
              </label>
            </>
          )}

          {previewUrl && (
            <img
              src={previewUrl}
              alt=""
              style={previewImgStyle}
            />
          )}

          {selectedFile && !initialFile && (
            <button
              type="button"
              onClick={() => handleAnalyze(null)}
              disabled={analyzing}
              style={primaryBtnStyle}
            >
              {analyzing
                ? "Analizez..."
                : "Analizează fotografia încărcată"}
            </button>
          )}

          {analyzing && initialFile && (
            <div style={{ textAlign: "center" }}>
              <small style={{ color: "var(--color-muted, #6b7280)" }}>
                Analizez fotografia...
              </small>
            </div>
          )}

          {analyzeError && (
            <div style={errorStyle}>
              {analyzeError}
            </div>
          )}
        </div>
      )}

      {components && (
        <div>
          <div style={reanalyzeRowStyle}>
            <small style={{ color: "var(--color-muted, #6b7280)" }}>
              Verifică și completează fiecare
              componentă înainte să confirmi.
            </small>

            <button
              type="button"
              onClick={() => {
                setComponents(null);
                setSelectedFile(null);
              }}
              style={linkBtnStyle}
            >
              Analizează altă fotografie
            </button>
          </div>

          <div style={rowsWrapStyle}>
            {components.map((row) => (
              <ComponentRow
                key={row._id}
                row={row}
                libraryItems={libraryItems}
                onChange={(patch) =>
                  updateRow(row._id, patch)
                }
                onSelectLibrary={(costItemId) =>
                  handleLibrarySelect(
                    row._id,
                    costItemId
                  )
                }
                onRemove={() => removeRow(row._id)}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={addRow}
            style={{
              ...linkBtnStyle,
              marginTop: 8,
            }}
          >
            + Adaugă o componentă lipsă
          </button>

          {externalError && (
            <div style={errorStyle}>
              {externalError}
            </div>
          )}

          <div style={confirmRowStyle}>
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                style={ghostBtnStyle}
                disabled={busy}
              >
                Renunță
              </button>
            )}

            <button
              type="button"
              onClick={handleConfirmClick}
              disabled={!allValid || busy}
              style={primaryBtnStyle}
              title={
                !allValid
                  ? "Completează numele, cantitatea și costul fiecărei componente"
                  : undefined
              }
            >
              {busy ? busyLabel : confirmLabel}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* =========================================================
   Un rând editabil din draft
========================================================= */

function ComponentRow({
  row,
  libraryItems,
  onChange,
  onSelectLibrary,
  onRemove,
}) {
  const showLowConfidence =
    typeof row.confidence === "number" &&
    row.confidence < LOW_CONFIDENCE_THRESHOLD;

  const showMissingCost = !row.matchedCostItemId;

  return (
    <div style={rowCardStyle}>
      <div style={rowBadgesStyle}>
        {showLowConfidence && (
          <span style={badgeWarnStyle}>
            Verifică
          </span>
        )}

        {showMissingCost ? (
          <span style={badgeDangerStyle}>
            Cost lipsă
          </span>
        ) : (
          <span style={badgeOkStyle}>
            din bibliotecă
          </span>
        )}

        <button
          type="button"
          onClick={onRemove}
          aria-label="Elimină componenta"
          style={removeBtnStyle}
        >
          ✕
        </button>
      </div>

      <div style={rowFieldsStyle}>
        <input
          type="text"
          value={row.label}
          onChange={(e) =>
            onChange({ label: e.target.value })
          }
          placeholder="Nume componentă"
          style={{ ...inputStyle, flex: 2 }}
        />

        <input
          type="number"
          min="0"
          step="0.01"
          value={row.quantity}
          onChange={(e) =>
            onChange({
              quantity: e.target.value,
            })
          }
          placeholder="Cant."
          style={{ ...inputStyle, width: 70 }}
        />

        <input
          type="text"
          value={row.unit}
          onChange={(e) =>
            onChange({ unit: e.target.value })
          }
          placeholder="unit."
          style={{ ...inputStyle, width: 70 }}
        />
      </div>

      <div style={rowFieldsStyle}>
        <select
          value={row.matchedCostItemId || ""}
          onChange={(e) =>
            onSelectLibrary(e.target.value || null)
          }
          style={{ ...inputStyle, flex: 1 }}
        >
          <option value="">
            — fără (cost manual) —
          </option>

          {libraryItems.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} · {item.unitCost} lei
              {item.unit ? `/${item.unit}` : ""}
            </option>
          ))}
        </select>

        {!row.matchedCostItemId && (
          <input
            type="number"
            min="0"
            step="0.01"
            value={row.manualUnitCostLei}
            onChange={(e) =>
              onChange({
                manualUnitCostLei:
                  e.target.value,
              })
            }
            placeholder="cost manual (lei)"
            style={{ ...inputStyle, width: 140 }}
          />
        )}
      </div>

      {typeof row.confidence === "number" && (
        <small style={{ color: "var(--color-muted, #6b7280)" }}>
          Încredere identificare:{" "}
          {Math.round(row.confidence * 100)}%
        </small>
      )}
    </div>
  );
}

/* =========================================================
   Stiluri
========================================================= */

const hintStyle = {
  fontSize: 13,
  color: "var(--color-muted, #6b7280)",
  lineHeight: 1.5,
  marginBottom: 16,
};

const sourcePickerStyle = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

const primaryBtnStyle = {
  border: 0,
  borderRadius: 10,
  padding: "10px 14px",
  cursor: "pointer",
  fontWeight: 700,
  fontSize: 13.5,
  background: "var(--color-primary, #8b5cf6)",
  color: "#ffffff",
};

const ghostBtnStyle = {
  border: "1px solid var(--color-border, #e5e5e5)",
  borderRadius: 10,
  padding: "10px 14px",
  cursor: "pointer",
  fontWeight: 700,
  fontSize: 13.5,
  background: "var(--surface, #ffffff)",
  color: "var(--color-text, #2d2d2d)",
};

const fileLabelStyle = {
  display: "block",
  textAlign: "center",
  border: "1px dashed var(--color-border, #e5e5e5)",
  borderRadius: 10,
  padding: "10px 14px",
  cursor: "pointer",
  fontSize: 13.5,
  color: "var(--color-text, #2d2d2d)",
};

const previewImgStyle = {
  maxWidth: "100%",
  maxHeight: 180,
  borderRadius: 10,
  objectFit: "contain",
  margin: "0 auto",
};

const errorStyle = {
  color: "var(--color-danger, #dc2626)",
  fontSize: 12.5,
  marginTop: 4,
};

const reanalyzeRowStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 10,
  marginBottom: 10,
  flexWrap: "wrap",
};

const linkBtnStyle = {
  border: 0,
  background: "transparent",
  color: "var(--color-primary, #8b5cf6)",
  fontWeight: 700,
  fontSize: 12.5,
  cursor: "pointer",
  padding: 0,
};

const rowsWrapStyle = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

const rowCardStyle = {
  border: "1px solid var(--color-border, #e5e5e5)",
  borderRadius: 12,
  padding: 10,
  background: "var(--surface, #ffffff)",
};

const rowBadgesStyle = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  marginBottom: 6,
};

const rowFieldsStyle = {
  display: "flex",
  gap: 6,
  marginBottom: 6,
  flexWrap: "wrap",
};

const inputStyle = {
  border: "1px solid var(--color-border, #e5e5e5)",
  borderRadius: 8,
  padding: "7px 9px",
  fontSize: 13,
  background: "var(--surface, #ffffff)",
  color: "var(--color-text, #2d2d2d)",
  minWidth: 0,
};

const removeBtnStyle = {
  marginLeft: "auto",
  border: 0,
  background: "transparent",
  color: "var(--color-danger, #dc2626)",
  cursor: "pointer",
  fontSize: 13,
};

function badgeBase(bg, color) {
  return {
    fontSize: 11,
    fontWeight: 700,
    borderRadius: 999,
    padding: "2px 8px",
    background: bg,
    color,
  };
}

const badgeWarnStyle = badgeBase(
  "color-mix(in srgb, var(--color-warning, #f59e0b) 16%, transparent)",
  "var(--color-warning, #f59e0b)"
);

const badgeDangerStyle = badgeBase(
  "color-mix(in srgb, var(--color-danger, #dc2626) 12%, transparent)",
  "var(--color-danger, #dc2626)"
);

const badgeOkStyle = badgeBase(
  "color-mix(in srgb, var(--color-success, #16a34a) 14%, transparent)",
  "var(--color-success, #16a34a)"
);

const confirmRowStyle = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 10,
  marginTop: 16,
};
