import { useMemo, useRef, useState } from "react";
import {
  Upload,
  FileSpreadsheet,
  RefreshCw,
  ShoppingBag,
  Globe2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ArrowLeft,
  ArrowRight,
  Sparkles,
  Link2,
  RotateCcw,
  Eye,
  Trash2,
  FileText,
} from "lucide-react";

import styles from "./CatalogImports.module.css";

const IMPORT_SOURCES = [
  {
    key: "EXCEL",
    title: "Excel / CSV",
    subtitle: "Importă produse din fișiere .xlsx, .xls sau .csv.",
    icon: FileSpreadsheet,
    available: true,
  },
  {
    key: "EASYSALES",
    title: "EasySales",
    subtitle: "Conectează catalogul existent din EasySales.",
    icon: RefreshCw,
    available: false,
  },
  {
    key: "SHOPIFY",
    title: "Shopify",
    subtitle: "Importă produsele din magazinul tău Shopify.",
    icon: ShoppingBag,
    available: false,
  },
  {
    key: "WOOCOMMERCE",
    title: "WooCommerce",
    subtitle: "Importă produsele magazinului WooCommerce.",
    icon: Globe2,
    available: false,
  },
];

const ARTFEST_FIELDS = [
  {
    key: "ignore",
    label: "Nu importa",
  },
  {
    key: "title",
    label: "Titlu produs",
  },
  {
    key: "description",
    label: "Descriere",
  },
  {
    key: "price",
    label: "Preț",
  },
  {
    key: "stock",
    label: "Stoc",
  },
  {
    key: "sku",
    label: "SKU / Cod produs",
  },
  {
    key: "category",
    label: "Categorie",
  },
  {
    key: "image",
    label: "Imagine",
  },
  {
    key: "images",
    label: "Imagini",
  },
  {
    key: "variants",
    label: "Variante / opțiuni",
  },
  {
    key: "availability",
    label: "Disponibilitate",
  },
];

const MOCK_COLUMNS = [
  {
    source: "product_name",
    sample: "Odorizant dulap lavandă",
    mappedTo: "title",
    confidence: 0.99,
  },
  {
    source: "product_description",
    sample: "Odorizant parfumat realizat manual...",
    mappedTo: "description",
    confidence: 0.97,
  },
  {
    source: "price",
    sample: "35",
    mappedTo: "price",
    confidence: 0.99,
  },
  {
    source: "inventory",
    sample: "12",
    mappedTo: "stock",
    confidence: 0.91,
  },
  {
    source: "category",
    sample: "Casă",
    mappedTo: "category",
    confidence: 0.96,
  },
  {
    source: "image_url",
    sample: "https://...",
    mappedTo: "image",
    confidence: 0.94,
  },
  {
    source: "aroma",
    sample: "Lavandă",
    mappedTo: "variants",
    confidence: 0.78,
  },
];

const MOCK_PREVIEW_ROWS = [
  {
    id: "row-1",
    rowNumber: 2,
    title: "Odorizant dulap",
    description: "Odorizant parfumat realizat manual.",
    price: 35,
    stock: 12,
    category: "Casă",
    image: "",
    status: "READY",
    warnings: [],
  },
  {
    id: "row-2",
    rowNumber: 3,
    title: "Cană personalizată",
    description: "Cană cu text și fotografie.",
    price: 45,
    stock: 8,
    category: "Cadouri",
    image: "",
    status: "READY",
    warnings: [],
  },
  {
    id: "row-3",
    rowNumber: 4,
    title: "Cutie pentru botez",
    description: "",
    price: null,
    stock: null,
    category: "Botez",
    image: "",
    status: "WARNING",
    warnings: [
      "Lipsește prețul.",
      "Descrierea este goală.",
    ],
  },
  {
    id: "row-4",
    rowNumber: 5,
    title: "",
    description: "Produs fără denumire.",
    price: 60,
    stock: 4,
    category: "Cadouri",
    image: "",
    status: "ERROR",
    warnings: ["Titlul produsului este obligatoriu."],
  },
];

const MOCK_HISTORY = [
  {
    id: "import-1",
    source: "EXCEL",
    fileName: "produse-august.xlsx",
    status: "COMPLETED",
    totalRows: 84,
    importedRows: 81,
    warningRows: 3,
    failedRows: 0,
    createdAt: "12 august 2026, 14:20",
  },
  {
    id: "import-2",
    source: "CSV",
    fileName: "catalog.csv",
    status: "COMPLETED_WITH_ERRORS",
    totalRows: 53,
    importedRows: 49,
    warningRows: 2,
    failedRows: 4,
    createdAt: "8 august 2026, 11:07",
  },
];

function sourceLabel(source) {
  if (source === "EXCEL") return "Excel";
  if (source === "CSV") return "CSV";
  if (source === "SHOPIFY") return "Shopify";
  if (source === "EASYSALES") return "EasySales";
  if (source === "WOOCOMMERCE") return "WooCommerce";
  return source;
}

function statusLabel(status) {
  if (status === "COMPLETED") return "Finalizat";
  if (status === "COMPLETED_WITH_ERRORS") {
    return "Finalizat cu erori";
  }
  if (status === "FAILED") return "Eșuat";
  if (status === "PROCESSING") return "În procesare";
  return status;
}

function getStatusIcon(status) {
  if (status === "READY") {
    return <CheckCircle2 size={17} />;
  }

  if (status === "WARNING") {
    return <AlertTriangle size={17} />;
  }

  return <XCircle size={17} />;
}

export default function CatalogImports() {
  const fileInputRef = useRef(null);

  const [step, setStep] = useState("SOURCE");

  const [setSelectedSource] =
    useState(null);

  const [selectedFile, setSelectedFile] =
    useState(null);

  const [isDragging, setIsDragging] =
    useState(false);

  const [columns, setColumns] =
    useState(MOCK_COLUMNS);

  const [previewRows, setPreviewRows] =
    useState(MOCK_PREVIEW_ROWS);

  const [history, setHistory] =
    useState(MOCK_HISTORY);

  const [isAnalyzing, setIsAnalyzing] =
    useState(false);

  const [isImporting, setIsImporting] =
    useState(false);

  const [importResult, setImportResult] =
    useState(null);

  const [onlyIssues, setOnlyIssues] =
    useState(false);

  const summary = useMemo(() => {
    const ready = previewRows.filter(
      (row) => row.status === "READY"
    ).length;

    const warning = previewRows.filter(
      (row) => row.status === "WARNING"
    ).length;

    const error = previewRows.filter(
      (row) => row.status === "ERROR"
    ).length;

    return {
      total: previewRows.length,
      ready,
      warning,
      error,
    };
  }, [previewRows]);

  const visibleRows = useMemo(() => {
    if (!onlyIssues) return previewRows;

    return previewRows.filter(
      (row) => row.status !== "READY"
    );
  }, [previewRows, onlyIssues]);

  function resetImportFlow() {
    setStep("SOURCE");
    setSelectedSource(null);
    setSelectedFile(null);
    setIsDragging(false);
    setColumns(MOCK_COLUMNS);
    setPreviewRows(MOCK_PREVIEW_ROWS);
    setImportResult(null);
    setOnlyIssues(false);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function selectSource(source) {
    if (!source.available) {
      alert(
        `${source.title} va fi conectat după ce finalizăm importul Excel / CSV.`
      );
      return;
    }

    setSelectedSource(source.key);
    setStep("UPLOAD");
  }

  function validateFile(file) {
    if (!file) return false;

    const name = String(file.name || "")
      .toLowerCase();

    const accepted =
      name.endsWith(".xlsx") ||
      name.endsWith(".xls") ||
      name.endsWith(".csv");

    if (!accepted) {
      alert(
        "Poți încărca momentan doar fișiere Excel sau CSV."
      );

      return false;
    }

    const maxSize =
      20 * 1024 * 1024;

    if (file.size > maxSize) {
      alert(
        "Fișierul este prea mare. Limita este de 20 MB."
      );

      return false;
    }

    return true;
  }

  function setFile(file) {
    if (!validateFile(file)) return;

    setSelectedFile(file);
  }

  function handleFileInput(event) {
    const file =
      event.target.files?.[0];

    setFile(file);
  }

  function handleDrop(event) {
    event.preventDefault();

    setIsDragging(false);

    const file =
      event.dataTransfer.files?.[0];

    setFile(file);
  }

  function handleDragOver(event) {
    event.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave(event) {
    event.preventDefault();
    setIsDragging(false);
  }

  async function analyzeFile() {
    if (!selectedFile) {
      alert(
        "Selectează un fișier pentru import."
      );
      return;
    }

    try {
      setIsAnalyzing(true);

      /*
       * BACKEND REAL:
       *
       * const formData = new FormData();
       * formData.append("file", selectedFile);
       *
       * const response = await api(
       *   "/api/vendor/catalog/imports/upload",
       *   {
       *     method: "POST",
       *     body: formData,
       *   }
       * );
       *
       * setColumns(response.columns || []);
       */

      await new Promise((resolve) =>
        setTimeout(resolve, 700)
      );

      setColumns(MOCK_COLUMNS);

      setStep("MAPPING");
    } finally {
      setIsAnalyzing(false);
    }
  }

  function updateMapping(
    sourceColumn,
    mappedTo
  ) {
    setColumns((prev) =>
      prev.map((column) =>
        column.source === sourceColumn
          ? {
              ...column,
              mappedTo,
            }
          : column
      )
    );
  }

  function goToPreview() {
    const titleMapped =
      columns.some(
        (column) =>
          column.mappedTo === "title"
      );

    if (!titleMapped) {
      alert(
        "Trebuie să alegi o coloană pentru Titlu produs."
      );
      return;
    }

    /*
     * BACKEND REAL:
     *
     * POST /api/vendor/catalog/imports/:importId/preview
     *
     * body:
     * {
     *   mapping: {
     *      product_name: "title",
     *      price: "price"
     *   }
     * }
     */

    setPreviewRows(
      MOCK_PREVIEW_ROWS
    );

    setStep("PREVIEW");
  }

  function removePreviewRow(id) {
    setPreviewRows((prev) =>
      prev.filter(
        (row) => row.id !== id
      )
    );
  }

  function markWarningAsAccepted(id) {
    setPreviewRows((prev) =>
      prev.map((row) =>
        row.id === id &&
        row.status === "WARNING"
          ? {
              ...row,
              status: "READY",
              warnings: [],
            }
          : row
      )
    );
  }

  async function executeImport() {
    const importableRows =
      previewRows.filter(
        (row) =>
          row.status !== "ERROR"
      );

    if (!importableRows.length) {
      alert(
        "Nu există produse valide pentru import."
      );
      return;
    }

    try {
      setIsImporting(true);

      /*
       * BACKEND REAL:
       *
       * const response = await api(
       *   `/api/vendor/catalog/imports/${importId}/execute`,
       *   {
       *     method: "POST",
       *   }
       * );
       */

      await new Promise((resolve) =>
        setTimeout(resolve, 900)
      );

      const importedRows =
        importableRows.length;

      const failedRows =
        previewRows.filter(
          (row) =>
            row.status === "ERROR"
        ).length;

      const result = {
        importedRows,
        failedRows,
        totalRows:
          previewRows.length,
      };

      setImportResult(result);

      setHistory((prev) => [
        {
          id: `import-${Date.now()}`,
          source:
            selectedFile?.name
              ?.toLowerCase()
              .endsWith(".csv")
              ? "CSV"
              : "EXCEL",
          fileName:
            selectedFile?.name ||
            "Import produse",
          status:
            failedRows > 0
              ? "COMPLETED_WITH_ERRORS"
              : "COMPLETED",
          totalRows:
            previewRows.length,
          importedRows,
          warningRows:
            previewRows.filter(
              (row) =>
                row.status ===
                "WARNING"
            ).length,
          failedRows,
          createdAt:
            new Date().toLocaleString(
              "ro-RO"
            ),
        },
        ...prev,
      ]);

      setStep("RESULT");
    } finally {
      setIsImporting(false);
    }
  }

  function renderSourceStep() {
    return (
      <>
        <section
          className={
            styles.importIntro
          }
        >
          <div>
            <span
              className={
                styles.eyebrow
              }
            >
              Import catalog
            </span>

            <h2>
              Ai deja produsele în altă
              parte?
            </h2>

            <p>
              Nu trebuie să le adaugi unul
              câte unul. Alege sursa,
              verifică informațiile și
              importă produsele în Artfest.
            </p>
          </div>
        </section>

        <div
          className={
            styles.sourceGrid
          }
        >
          {IMPORT_SOURCES.map(
            (source) => {
              const Icon =
                source.icon;

              return (
                <button
                  type="button"
                  key={source.key}
                  className={`${styles.sourceCard} ${
                    !source.available
                      ? styles.sourceCardDisabled
                      : ""
                  }`}
                  onClick={() =>
                    selectSource(
                      source
                    )
                  }
                >
                  <div
                    className={
                      styles.sourceIcon
                    }
                  >
                    <Icon
                      size={24}
                    />
                  </div>

                  <div
                    className={
                      styles.sourceInfo
                    }
                  >
                    <div
                      className={
                        styles.sourceTitleRow
                      }
                    >
                      <strong>
                        {
                          source.title
                        }
                      </strong>

                      {!source.available && (
                        <span
                          className={
                            styles.soonBadge
                          }
                        >
                          În curând
                        </span>
                      )}
                    </div>

                    <p>
                      {
                        source.subtitle
                      }
                    </p>
                  </div>

                  <ArrowRight
                    size={18}
                    className={
                      styles.sourceArrow
                    }
                  />
                </button>
              );
            }
          )}
        </div>

        <section
          className={styles.aiBox}
        >
          <Sparkles size={22} />

          <div>
            <strong>
              Import inteligent
            </strong>

            <p>
              Artfest va putea identifica
              automat coloanele pentru
              titlu, descriere, preț,
              categorie, stoc și variante.
              Tu verifici înainte să se
              importe ceva.
            </p>
          </div>
        </section>
      </>
    );
  }

  function renderUploadStep() {
    return (
      <>
        <StepHeader
          title="Încarcă fișierul"
          subtitle="Selectează fișierul Excel sau CSV care conține produsele."
          onBack={() =>
            setStep("SOURCE")
          }
        />

        <section
          className={
            styles.uploadCard
          }
        >
          <div
            className={`${styles.dropZone} ${
              isDragging
                ? styles.dropZoneActive
                : ""
            }`}
            onDrop={handleDrop}
            onDragOver={
              handleDragOver
            }
            onDragLeave={
              handleDragLeave
            }
            onClick={() =>
              fileInputRef.current?.click()
            }
          >
            <input
              ref={fileInputRef}
              type="file"
              hidden
              accept=".xlsx,.xls,.csv"
              onChange={
                handleFileInput
              }
            />

            <div
              className={
                styles.uploadIcon
              }
            >
              <Upload size={27} />
            </div>

            <h3>
              Trage fișierul aici
            </h3>

            <p>
              sau apasă pentru a selecta
              un fișier
            </p>

            <span
              className={
                styles.fileHint
              }
            >
              XLSX, XLS sau CSV · maxim
              20 MB
            </span>
          </div>

          {selectedFile && (
            <div
              className={
                styles.selectedFile
              }
            >
              <div
                className={
                  styles.selectedFileIcon
                }
              >
                <FileSpreadsheet
                  size={22}
                />
              </div>

              <div
                className={
                  styles.selectedFileInfo
                }
              >
                <strong>
                  {
                    selectedFile.name
                  }
                </strong>

                <span>
                  {(
                    selectedFile.size /
                    1024
                  ).toFixed(1)}{" "}
                  KB
                </span>
              </div>

              <button
                type="button"
                className={
                  styles.iconBtn
                }
                onClick={(event) => {
                  event.stopPropagation();

                  setSelectedFile(
                    null
                  );

                  if (
                    fileInputRef.current
                  ) {
                    fileInputRef.current.value =
                      "";
                  }
                }}
                aria-label="Șterge fișierul"
              >
                <Trash2 size={18} />
              </button>
            </div>
          )}
        </section>

        <section
          className={styles.infoCard}
        >
          <FileText size={20} />

          <div>
            <strong>
              Fișierul poate avea orice
              denumiri de coloane
            </strong>

            <p>
              De exemplu:
              „product_name”,
              „denumire” sau „nume
              produs”. În pasul următor
              vom potrivi coloanele cu
              câmpurile Artfest.
            </p>
          </div>
        </section>

        <div
          className={
            styles.footerActions
          }
        >
          <button
            type="button"
            className={
              styles.secondaryBtn
            }
            onClick={() =>
              setStep("SOURCE")
            }
          >
            Înapoi
          </button>

          <button
            type="button"
            className={
              styles.primaryBtn
            }
            disabled={
              !selectedFile ||
              isAnalyzing
            }
            onClick={analyzeFile}
          >
            {isAnalyzing ? (
              <>
                <RefreshCw
                  size={17}
                  className={
                    styles.spin
                  }
                />
                Analizăm...
              </>
            ) : (
              <>
                Analizează fișierul
                <ArrowRight
                  size={17}
                />
              </>
            )}
          </button>
        </div>
      </>
    );
  }

  function renderMappingStep() {
    return (
      <>
        <StepHeader
          title="Potrivește coloanele"
          subtitle="Verifică ce informație din fișier corespunde fiecărui câmp Artfest."
          onBack={() =>
            setStep("UPLOAD")
          }
        />

        <section
          className={
            styles.mappingNotice
          }
        >
          <Sparkles size={20} />

          <div>
            <strong>
              Am făcut o potrivire
              automată
            </strong>

            <p>
              Verifică propunerile înainte
              de a continua. Coloanele cu
              încredere mai mică merită
              verificate manual.
            </p>
          </div>
        </section>

        <section
          className={
            styles.mappingCard
          }
        >
          <div
            className={
              styles.mappingHeader
            }
          >
            <div>
              Coloană din fișier
            </div>

            <div>
              Exemplu
            </div>

            <div>
              Câmp Artfest
            </div>

            <div>
              Potrivire AI
            </div>
          </div>

          <div
            className={
              styles.mappingList
            }
          >
            {columns.map(
              (column) => (
                <div
                  key={
                    column.source
                  }
                  className={
                    styles.mappingRow
                  }
                >
                  <div
                    className={
                      styles.sourceColumn
                    }
                  >
                    <strong>
                      {
                        column.source
                      }
                    </strong>
                  </div>

                  <div
                    className={
                      styles.sampleValue
                    }
                  >
                    {column.sample ||
                      "—"}
                  </div>

                  <div>
                    <select
                      className={
                        styles.select
                      }
                      value={
                        column.mappedTo
                      }
                      onChange={(
                        event
                      ) =>
                        updateMapping(
                          column.source,
                          event.target
                            .value
                        )
                      }
                    >
                      {ARTFEST_FIELDS.map(
                        (field) => (
                          <option
                            key={
                              field.key
                            }
                            value={
                              field.key
                            }
                          >
                            {
                              field.label
                            }
                          </option>
                        )
                      )}
                    </select>
                  </div>

                  <div>
                    <span
                      className={`${styles.confidenceBadge} ${
                        column.confidence >=
                        0.9
                          ? styles.confidenceHigh
                          : column.confidence >=
                            0.75
                          ? styles.confidenceMedium
                          : styles.confidenceLow
                      }`}
                    >
                      {Math.round(
                        column.confidence *
                          100
                      )}
                      %
                    </span>
                  </div>
                </div>
              )
            )}
          </div>
        </section>

        <div
          className={
            styles.footerActions
          }
        >
          <button
            type="button"
            className={
              styles.secondaryBtn
            }
            onClick={() =>
              setStep("UPLOAD")
            }
          >
            Înapoi
          </button>

          <button
            type="button"
            className={
              styles.primaryBtn
            }
            onClick={goToPreview}
          >
            Previzualizează produsele
            <ArrowRight size={17} />
          </button>
        </div>
      </>
    );
  }

  function renderPreviewStep() {
    return (
      <>
        <StepHeader
          title="Verifică produsele"
          subtitle="Nimic nu este importat încă. Verifică produsele înainte de confirmare."
          onBack={() =>
            setStep("MAPPING")
          }
        />

        <section
          className={
            styles.summaryGrid
          }
        >
          <SummaryCard
            label="Produse găsite"
            value={summary.total}
          />

          <SummaryCard
            label="Gata de import"
            value={summary.ready}
            type="success"
          />

          <SummaryCard
            label="Avertismente"
            value={summary.warning}
            type="warning"
          />

          <SummaryCard
            label="Erori"
            value={summary.error}
            type="error"
          />
        </section>

        <section
          className={
            styles.previewCard
          }
        >
          <div
            className={
              styles.previewToolbar
            }
          >
            <div>
              <strong>
                Preview produse
              </strong>

              <span>
                {
                  visibleRows.length
                }{" "}
                afișate
              </span>
            </div>

            <label
              className={
                styles.issueToggle
              }
            >
              <input
                type="checkbox"
                checked={onlyIssues}
                onChange={(event) =>
                  setOnlyIssues(
                    event.target
                      .checked
                  )
                }
              />

              Arată doar problemele
            </label>
          </div>

          <div
            className={
              styles.previewScroll
            }
          >
            <table
              className={
                styles.previewTable
              }
            >
              <thead>
                <tr>
                  <th>Rând</th>
                  <th>Produs</th>
                  <th>Categorie</th>
                  <th>Preț</th>
                  <th>Stoc</th>
                  <th>Status</th>
                  <th>Acțiuni</th>
                </tr>
              </thead>

              <tbody>
                {visibleRows.map(
                  (row) => (
                    <tr key={row.id}>
                      <td>
                        {
                          row.rowNumber
                        }
                      </td>

                      <td>
                        <div
                          className={
                            styles.previewProduct
                          }
                        >
                          <strong>
                            {row.title ||
                              "Fără titlu"}
                          </strong>

                          <span>
                            {row.description ||
                              "Fără descriere"}
                          </span>
                        </div>
                      </td>

                      <td>
                        {row.category ||
                          "—"}
                      </td>

                      <td>
                        {row.price !==
                        null
                          ? `${row.price} lei`
                          : "—"}
                      </td>

                      <td>
                        {row.stock ??
                          "—"}
                      </td>

                      <td>
                        <div
                          className={`${styles.rowStatus} ${
                            row.status ===
                            "READY"
                              ? styles.rowStatusReady
                              : row.status ===
                                "WARNING"
                              ? styles.rowStatusWarning
                              : styles.rowStatusError
                          }`}
                        >
                          {getStatusIcon(
                            row.status
                          )}

                          <span>
                            {row.status ===
                            "READY"
                              ? "Gata"
                              : row.status ===
                                "WARNING"
                              ? "Verifică"
                              : "Eroare"}
                          </span>
                        </div>

                        {!!row.warnings
                          ?.length && (
                          <div
                            className={
                              styles.warningList
                            }
                          >
                            {row.warnings.map(
                              (
                                warning
                              ) => (
                                <span
                                  key={
                                    warning
                                  }
                                >
                                  {
                                    warning
                                  }
                                </span>
                              )
                            )}
                          </div>
                        )}
                      </td>

                      <td>
                        <div
                          className={
                            styles.rowActions
                          }
                        >
                          {row.status ===
                            "WARNING" && (
                            <button
                              type="button"
                              className={
                                styles.smallBtn
                              }
                              onClick={() =>
                                markWarningAsAccepted(
                                  row.id
                                )
                              }
                            >
                              Acceptă
                            </button>
                          )}

                          <button
                            type="button"
                            className={
                              styles.iconBtn
                            }
                            title="Elimină din import"
                            onClick={() =>
                              removePreviewRow(
                                row.id
                              )
                            }
                          >
                            <Trash2
                              size={16}
                            />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                )}

                {!visibleRows.length && (
                  <tr>
                    <td
                      colSpan={7}
                      className={
                        styles.emptyState
                      }
                    >
                      Nu există produse
                      pentru filtrul
                      selectat.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {summary.error > 0 && (
          <section
            className={
              styles.errorNotice
            }
          >
            <AlertTriangle
              size={20}
            />

            <div>
              <strong>
                Produsele cu eroare nu vor
                fi importate
              </strong>

              <p>
                Poți continua cu produsele
                valide. După import vei
                putea corecta produsele
                rămase.
              </p>
            </div>
          </section>
        )}

        <div
          className={
            styles.footerActions
          }
        >
          <button
            type="button"
            className={
              styles.secondaryBtn
            }
            onClick={() =>
              setStep("MAPPING")
            }
          >
            Înapoi
          </button>

          <button
            type="button"
            className={
              styles.primaryBtn
            }
            disabled={
              isImporting ||
              summary.ready +
                summary.warning ===
                0
            }
            onClick={executeImport}
          >
            {isImporting ? (
              <>
                <RefreshCw
                  size={17}
                  className={
                    styles.spin
                  }
                />
                Importăm...
              </>
            ) : (
              <>
                Importă{" "}
                {summary.ready +
                  summary.warning}{" "}
                produse
                <ArrowRight
                  size={17}
                />
              </>
            )}
          </button>
        </div>
      </>
    );
  }

  function renderResultStep() {
    return (
      <>
        <section
          className={
            styles.resultCard
          }
        >
          <div
            className={
              styles.resultIcon
            }
          >
            <CheckCircle2
              size={34}
            />
          </div>

          <h2>
            Import finalizat
          </h2>

          <p>
            Produsele valide au fost
            adăugate în catalog.
          </p>

          <div
            className={
              styles.resultStats
            }
          >
            <div>
              <span>
                Importate
              </span>

              <strong>
                {importResult
                  ?.importedRows || 0}
              </strong>
            </div>

            <div>
              <span>
                Neimportate
              </span>

              <strong>
                {importResult
                  ?.failedRows || 0}
              </strong>
            </div>

            <div>
              <span>
                Total
              </span>

              <strong>
                {importResult
                  ?.totalRows || 0}
              </strong>
            </div>
          </div>

          <div
            className={
              styles.resultActions
            }
          >
            <button
              type="button"
              className={
                styles.secondaryBtn
              }
              onClick={
                resetImportFlow
              }
            >
              <RotateCcw
                size={17}
              />
              Import nou
            </button>

            <button
              type="button"
              className={
                styles.primaryBtn
              }
              onClick={() =>
                alert(
                  "Catalogul se va actualiza cu produsele importate când conectăm backend-ul."
                )
              }
            >
              <Eye size={17} />
              Vezi produsele
            </button>
          </div>
        </section>
      </>
    );
  }

  return (
    <div
      className={
        styles.importsPage
      }
    >
      <header
        className={
          styles.pageHeader
        }
      >
        <div>
          <h2>
            Importuri produse
          </h2>

          <p>
            Adu produsele existente în
            Artfest fără să le introduci
            manual unul câte unul.
          </p>
        </div>

        {step !== "SOURCE" && (
          <button
            type="button"
            className={
              styles.resetBtn
            }
            onClick={
              resetImportFlow
            }
          >
            <RotateCcw
              size={16}
            />
            Începe din nou
          </button>
        )}
      </header>

      <ImportProgress
        step={step}
      />

      {step === "SOURCE" &&
        renderSourceStep()}

      {step === "UPLOAD" &&
        renderUploadStep()}

      {step === "MAPPING" &&
        renderMappingStep()}

      {step === "PREVIEW" &&
        renderPreviewStep()}

      {step === "RESULT" &&
        renderResultStep()}

      <ImportHistory
        history={history}
      />
    </div>
  );
}

function StepHeader({
  title,
  subtitle,
  onBack,
}) {
  return (
    <section
      className={
        styles.stepHeader
      }
    >
      <button
        type="button"
        className={
          styles.backBtn
        }
        onClick={onBack}
      >
        <ArrowLeft size={17} />
        Înapoi
      </button>

      <div>
        <h3>{title}</h3>
        <p>{subtitle}</p>
      </div>
    </section>
  );
}

function ImportProgress({
  step,
}) {
  const steps = [
    {
      key: "SOURCE",
      label: "Sursă",
    },
    {
      key: "UPLOAD",
      label: "Fișier",
    },
    {
      key: "MAPPING",
      label: "Potrivire",
    },
    {
      key: "PREVIEW",
      label: "Verificare",
    },
    {
      key: "RESULT",
      label: "Finalizat",
    },
  ];

  const currentIndex =
    steps.findIndex(
      (item) =>
        item.key === step
    );

  return (
    <div
      className={
        styles.progressSteps
      }
    >
      {steps.map(
        (item, index) => {
          const completed =
            index <
            currentIndex;

          const current =
            index ===
            currentIndex;

          return (
            <div
              key={item.key}
              className={`${styles.progressStep} ${
                completed
                  ? styles.progressStepDone
                  : ""
              } ${
                current
                  ? styles.progressStepCurrent
                  : ""
              }`}
            >
              <div
                className={
                  styles.progressNumber
                }
              >
                {completed ? (
                  <CheckCircle2
                    size={17}
                  />
                ) : (
                  index + 1
                )}
              </div>

              <span>
                {item.label}
              </span>
            </div>
          );
        }
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  type = "default",
}) {
  return (
    <div
      className={`${styles.summaryCard} ${
        type === "success"
          ? styles.summarySuccess
          : type === "warning"
          ? styles.summaryWarning
          : type === "error"
          ? styles.summaryError
          : ""
      }`}
    >
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ImportHistory({
  history,
}) {
  return (
    <section
      className={
        styles.historyCard
      }
    >
      <div
        className={
          styles.historyHeader
        }
      >
        <div>
          <h3>
            Importuri recente
          </h3>

          <p>
            Vezi ultimele importuri și
            rezultatul fiecăruia.
          </p>
        </div>
      </div>

      {!history.length ? (
        <div
          className={
            styles.emptyHistory
          }
        >
          Nu ai făcut încă niciun
          import.
        </div>
      ) : (
        <div
          className={
            styles.historyList
          }
        >
          {history.map(
            (item) => (
              <div
                key={item.id}
                className={
                  styles.historyRow
                }
              >
                <div
                  className={
                    styles.historyMain
                  }
                >
                  <div
                    className={
                      styles.historyIcon
                    }
                  >
                    <FileSpreadsheet
                      size={20}
                    />
                  </div>

                  <div>
                    <strong>
                      {
                        item.fileName
                      }
                    </strong>

                    <span>
                      {sourceLabel(
                        item.source
                      )}{" "}
                      ·{" "}
                      {
                        item.createdAt
                      }
                    </span>
                  </div>
                </div>

                <div
                  className={
                    styles.historyNumbers
                  }
                >
                  <span>
                    {
                      item.importedRows
                    }{" "}
                    importate
                  </span>

                  {item.warningRows >
                    0 && (
                    <span
                      className={
                        styles.historyWarning
                      }
                    >
                      {
                        item.warningRows
                      }{" "}
                      avertismente
                    </span>
                  )}

                  {item.failedRows >
                    0 && (
                    <span
                      className={
                        styles.historyError
                      }
                    >
                      {
                        item.failedRows
                      }{" "}
                      erori
                    </span>
                  )}
                </div>

                <span
                  className={`${styles.historyStatus} ${
                    item.status ===
                    "COMPLETED"
                      ? styles.historyStatusOk
                      : item.status ===
                        "COMPLETED_WITH_ERRORS"
                      ? styles.historyStatusWarning
                      : styles.historyStatusError
                  }`}
                >
                  {statusLabel(
                    item.status
                  )}
                </span>

                <button
                  type="button"
                  className={
                    styles.iconBtn
                  }
                  title="Vezi detalii"
                  onClick={() =>
                    alert(
                      "Detaliile importului vor fi conectate la backend."
                    )
                  }
                >
                  <Eye size={17} />
                </button>
              </div>
            )
          )}
        </div>
      )}
    </section>
  );
}