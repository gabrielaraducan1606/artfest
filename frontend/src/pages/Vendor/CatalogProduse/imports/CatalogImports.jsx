import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  Upload,
  Download,
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
    subtitle:
      "Importă produse din fișiere .xlsx, .xls sau .csv.",
    icon: FileSpreadsheet,
    available: true,
    canDownloadTemplate: true,
  },
  {
    key: "EASYSALES",
    title: "EasySales",
    subtitle:
      "Conectează catalogul existent din EasySales.",
    icon: RefreshCw,
    available: false,
  },
  {
    key: "SHOPIFY",
    title: "Shopify",
    subtitle:
      "Importă produsele din magazinul tău Shopify.",
    icon: ShoppingBag,
    available: false,
  },
  {
    key: "WOOCOMMERCE",
    title: "WooCommerce",
    subtitle:
      "Importă produsele magazinului WooCommerce.",
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
  {
    key: "orderMode",
    label: "Mod comandă",
  },
  {
    key: "color",
    label: "Culoare",
  },
  {
    key: "materialMain",
    label: "Material principal",
  },
  {
    key: "dimensions",
    label: "Dimensiuni",
  },
  {
    key: "leadTimeDays",
    label: "Timp producție",
  },
  {
    key: "isActive",
    label: "Status activ",
  },
];

async function apiRequest(
  url,
  options = {}
) {
  const response = await fetch(url, {
    credentials: "include",
    ...options,
  });

  let data = null;

  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const error = new Error(
      data?.message ||
        data?.error ||
        "A apărut o eroare."
    );

    error.status =
      response.status;

    error.code =
      data?.error || null;

    throw error;
  }

  return data;
}

function formatHistoryDate(value) {
  if (!value) return "—";

  try {
    return new Date(
      value
    ).toLocaleString("ro-RO");
  } catch {
    return String(value);
  }
}

function sourceLabel(source) {
  if (source === "EXCEL")
    return "Excel";

  if (source === "CSV")
    return "CSV";

  if (source === "SHOPIFY")
    return "Shopify";

  if (source === "EASYSALES")
    return "EasySales";

  if (source === "WOOCOMMERCE")
    return "WooCommerce";

  return source;
}

function statusLabel(status) {
  if (status === "UPLOADED")
    return "Încărcat";

  if (status === "MAPPING")
    return "Potrivire coloane";

  if (
    status ===
    "PREVIEW_READY"
  ) {
    return "Pregătit pentru import";
  }

  if (
    status ===
    "IMPORTING"
  ) {
    return "Se importă";
  }

  if (
    status ===
    "COMPLETED"
  ) {
    return "Finalizat";
  }

  if (
    status ===
    "COMPLETED_WITH_ERRORS"
  ) {
    return "Finalizat cu erori";
  }

  if (status === "FAILED")
    return "Eșuat";

  if (status === "CANCELED")
    return "Anulat";

  return status;
}

function getStatusIcon(status) {
  if (status === "READY") {
    return (
      <CheckCircle2
        size={17}
      />
    );
  }

  if (
    status === "WARNING"
  ) {
    return (
      <AlertTriangle
        size={17}
      />
    );
  }

  return <XCircle size={17} />;
}

export default function CatalogImports() {
  const fileInputRef =
    useRef(null);

  const [step, setStep] =
    useState("SOURCE");

  const [,
    setSelectedSource,
  ] = useState(null);

  const [
    services,
    setServices,
  ] = useState([]);

  const [
    selectedServiceId,
    setSelectedServiceId,
  ] = useState("");

  const [
    isLoadingServices,
    setIsLoadingServices,
  ] = useState(false);

  const [
    retryingImportId,
    setRetryingImportId,
  ] = useState(null);

  const [
    downloadingReportId,
    setDownloadingReportId,
  ] = useState(null);

  const [
    selectedFile,
    setSelectedFile,
  ] = useState(null);

  const [
    importId,
    setImportId,
  ] = useState(null);

  const [
    isDragging,
    setIsDragging,
  ] = useState(false);

  const [
    columns,
    setColumns,
  ] = useState([]);

  const [
    previewRows,
    setPreviewRows,
  ] = useState([]);

  const [
    history,
    setHistory,
  ] = useState([]);

  const [
    isAnalyzing,
    setIsAnalyzing,
  ] = useState(false);

  const [
    isPreviewing,
    setIsPreviewing,
  ] = useState(false);

  const [
    isImporting,
    setIsImporting,
  ] = useState(false);

  const [
    isLoadingHistory,
    setIsLoadingHistory,
  ] = useState(false);

  const [
    importResult,
    setImportResult,
  ] = useState(null);

  const [
    onlyIssues,
    setOnlyIssues,
  ] = useState(false);

  const [
    errorMessage,
    setErrorMessage,
  ] = useState("");

  const [
    isDownloadingTemplate,
    setIsDownloadingTemplate,
  ] = useState(false);

  const [
    isExportingProducts,
    setIsExportingProducts,
  ] = useState(false);

  const summary =
    useMemo(() => {
      const ready =
        previewRows.filter(
          (row) =>
            row.status ===
            "READY"
        ).length;

      const warning =
        previewRows.filter(
          (row) =>
            row.status ===
            "WARNING"
        ).length;

      const error =
        previewRows.filter(
          (row) =>
            row.status ===
            "ERROR"
        ).length;

      return {
        total:
          previewRows.length,
        ready,
        warning,
        error,
      };
    }, [previewRows]);

  const visibleRows =
    useMemo(() => {
      if (!onlyIssues) {
        return previewRows;
      }

      return previewRows.filter(
        (row) =>
          row.status !==
          "READY"
      );
    }, [
      previewRows,
      onlyIssues,
    ]);

  async function loadHistory() {
    try {
      setIsLoadingHistory(true);

      const data =
        await apiRequest(
          "/api/vendor/catalog/imports"
        );

      const imports =
        Array.isArray(
          data?.imports
        )
          ? data.imports
          : [];

      setHistory(
        imports.map(
          (item) => ({
            ...item,

            createdAt:
              formatHistoryDate(
                item.createdAt
              ),
          })
        )
      );
    } catch (error) {
      console.error(
        "[CatalogImports] history:",
        error
      );
    } finally {
      setIsLoadingHistory(
        false
      );
    }
  }

  async function loadServices() {
    try {
      setIsLoadingServices(true);

      const data =
        await apiRequest(
          "/api/vendor/catalog/imports/services"
        );

      const nextServices =
        Array.isArray(
          data?.services
        )
          ? data.services
          : [];

      setServices(
        nextServices
      );

      if (
        data?.defaultServiceId
      ) {
        setSelectedServiceId(
          data.defaultServiceId
        );
      } else if (
        nextServices.length === 1
      ) {
        setSelectedServiceId(
          nextServices[0].id
        );
      } else {
        setSelectedServiceId("");
      }
    } catch (error) {
      console.error(
        "[CatalogImports] services:",
        error
      );

      setErrorMessage(
        error.message ||
          "Magazinele nu au putut fi încărcate."
      );
    } finally {
      setIsLoadingServices(
        false
      );
    }
  }

  useEffect(() => {
    loadHistory();
    loadServices();
  }, []);

  function resetImportFlow() {
    setStep("SOURCE");

    setSelectedSource(null);
    setSelectedFile(null);
    setImportId(null);

    setIsDragging(false);

    setColumns([]);
    setPreviewRows([]);

    setImportResult(null);

    setOnlyIssues(false);

    setErrorMessage("");

    if (
      fileInputRef.current
    ) {
      fileInputRef.current.value =
        "";
    }
  }


  function validateFile(
    file
  ) {
    if (!file) return false;

    const name = String(
      file.name || ""
    ).toLowerCase();

    const accepted =
      name.endsWith(
        ".xlsx"
      ) ||
      name.endsWith(
        ".xls"
      ) ||
      name.endsWith(
        ".csv"
      );

    if (!accepted) {
      alert(
        "Poți încărca momentan doar fișiere Excel sau CSV."
      );

      return false;
    }

    const maxSize =
      20 * 1024 * 1024;

    if (
      file.size > maxSize
    ) {
      alert(
        "Fișierul este prea mare. Limita este de 20 MB."
      );

      return false;
    }

    return true;
  }

  function setFile(file) {
    if (
      !validateFile(file)
    ) {
      return;
    }

    setSelectedFile(file);

    setErrorMessage("");
  }

  function handleFileInput(
    event
  ) {
    const file =
      event.target.files?.[0];

    setFile(file);
  }

  function handleDrop(
    event
  ) {
    event.preventDefault();

    setIsDragging(false);

    const file =
      event.dataTransfer
        .files?.[0];

    setFile(file);
  }

  function handleDragOver(
    event
  ) {
    event.preventDefault();

    setIsDragging(true);
  }

  function handleDragLeave(
    event
  ) {
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

    if (
      services.length > 1 &&
      !selectedServiceId
    ) {
      setErrorMessage(
        "Alege magazinul în care vrei să imporți produsele."
      );

      return;
    }

    try {
      setIsAnalyzing(true);

      setErrorMessage("");

      const formData =
        new FormData();

      formData.append(
        "file",
        selectedFile
      );

      if (selectedServiceId) {
        formData.append(
          "serviceId",
          selectedServiceId
        );
      }

      const response =
        await apiRequest(
          "/api/vendor/catalog/imports/upload",
          {
            method: "POST",
            body: formData,
          }
        );

      setImportId(
        response.importId
      );

      setColumns(
        Array.isArray(
          response.columns
        )
          ? response.columns
          : []
      );

      setStep("MAPPING");
    } catch (error) {
      console.error(
        "[CatalogImports] analyze:",
        error
      );

      if (
        error.code ===
        "SERVICE_REQUIRED"
      ) {
        setErrorMessage(
          "Ai mai multe magazine. Trebuie să alegem magazinul în care vor fi importate produsele."
        );

        return;
      }

      setErrorMessage(
        error.message ||
          "Fișierul nu a putut fi analizat."
      );
    } finally {
      setIsAnalyzing(false);
    }
  }

  function updateMapping(
    sourceColumn,
    mappedTo
  ) {
    setColumns((prev) =>
      prev.map(
        (column) =>
          column.source ===
          sourceColumn
            ? {
                ...column,
                mappedTo,
              }
            : column
      )
    );
  }

  async function goToPreview() {
    const titleMapped =
      columns.some(
        (column) =>
          column.mappedTo ===
          "title"
      );

    if (!titleMapped) {
      alert(
        "Trebuie să alegi o coloană pentru Titlu produs."
      );

      return;
    }

    if (!importId) {
      alert(
        "Importul nu a fost inițializat. Încearcă din nou."
      );

      return;
    }

    const mapping =
      Object.fromEntries(
        columns.map(
          (column) => [
            column.source,
            column.mappedTo ||
              "ignore",
          ]
        )
      );

    try {
      setIsPreviewing(true);

      setErrorMessage("");

      const response =
        await apiRequest(
          `/api/vendor/catalog/imports/${importId}/preview`,
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body: JSON.stringify({
              mapping,
            }),
          }
        );

      setPreviewRows(
        Array.isArray(
          response.rows
        )
          ? response.rows
          : []
      );

      setStep("PREVIEW");
    } catch (error) {
      console.error(
        "[CatalogImports] preview:",
        error
      );

      setErrorMessage(
        error.message ||
          "Preview-ul nu a putut fi generat."
      );
    } finally {
      setIsPreviewing(false);
    }
  }

  async function removePreviewRow(
    id
  ) {
    if (!importId) {
      return;
    }

    try {
      setErrorMessage("");

      await apiRequest(
        `/api/vendor/catalog/imports/${importId}/items/${id}/skip`,
        {
          method: "PATCH",

          headers: {
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify(
            {}
          ),
        }
      );

      setPreviewRows(
        (prev) =>
          prev.filter(
            (row) =>
              row.id !== id
          )
      );
    } catch (error) {
      console.error(
        "[CatalogImports] skip:",
        error
      );

      alert(
        error.message ||
          "Produsul nu a putut fi eliminat din import."
      );
    }
  }

  async function executeImport() {
    if (!importId) {
      alert(
        "Importul nu a fost inițializat."
      );

      return;
    }

    const importableRows =
      previewRows.filter(
        (row) =>
          row.status ===
            "READY" ||
          row.status ===
            "WARNING"
      );

    if (
      !importableRows.length
    ) {
      alert(
        "Nu există produse valide pentru import."
      );

      return;
    }

    try {
      setIsImporting(true);

      setErrorMessage("");

      const response =
        await apiRequest(
          `/api/vendor/catalog/imports/${importId}/execute`,
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body: JSON.stringify(
              {}
            ),
          }
        );

      setImportResult({
        importedRows:
          response.importedRows ||
          0,

        failedRows:
          response.failedRows ||
          0,

        totalRows:
          response.totalRows ||
          0,

        skippedRows:
          response.skippedRows ||
          0,
      });

      await loadHistory();

      setStep("RESULT");
    } catch (error) {
      console.error(
        "[CatalogImports] execute:",
        error
      );

      setErrorMessage(
        error.message ||
          "Produsele nu au putut fi importate."
      );
    } finally {
      setIsImporting(false);
    }
  }

  async function retryFailedImport(
    item
  ) {
    if (!item?.id) return;

    try {
      setRetryingImportId(
        item.id
      );

      setErrorMessage("");

      const response =
        await apiRequest(
          `/api/vendor/catalog/imports/${item.id}/retry-failed`,
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body: JSON.stringify(
              {}
            ),
          }
        );

      await loadHistory();

      alert(
        `Reîncercare finalizată. Importate acum: ${
          response.importedNow || 0
        }. Eșuate: ${
          response.failedNow || 0
        }.`
      );
    } catch (error) {
      console.error(
        "[CatalogImports] retry:",
        error
      );

      setErrorMessage(
        error.message ||
          "Produsele eșuate nu au putut fi reîncercate."
      );
    } finally {
      setRetryingImportId(
        null
      );
    }
  }

  async function downloadImportErrors(
    item
  ) {
    if (!item?.id) return;

    try {
      setDownloadingReportId(
        item.id
      );

      setErrorMessage("");

      const response =
        await fetch(
          `/api/vendor/catalog/imports/${item.id}/errors.xlsx`,
          {
            method: "GET",
            credentials: "include",
          }
        );

      if (!response.ok) {
        let data = null;

        try {
          data =
            await response.json();
        } catch {
          data = null;
        }

        throw new Error(
          data?.message ||
            data?.error ||
            "Raportul nu a putut fi descărcat."
        );
      }

      const blob =
        await response.blob();

      const disposition =
        response.headers.get(
          "content-disposition"
        );

      const fileNameMatch =
        disposition?.match(
          /filename="?([^"]+)"?/i
        );

      const fileName =
        fileNameMatch?.[1] ||
        `raport-erori-${item.id}.xlsx`;

      const objectUrl =
        URL.createObjectURL(
          blob
        );

      const link =
        document.createElement(
          "a"
        );

      link.href =
        objectUrl;

      link.download =
        fileName;

      document.body.appendChild(
        link
      );

      link.click();
      link.remove();

      URL.revokeObjectURL(
        objectUrl
      );
    } catch (error) {
      console.error(
        "[CatalogImports] errors report:",
        error
      );

      setErrorMessage(
        error.message ||
          "Raportul de erori nu a putut fi descărcat."
      );
    } finally {
      setDownloadingReportId(
        null
      );
    }
  }

  async function handleDownloadTemplate() {
    try {
      setIsDownloadingTemplate(true);
      setErrorMessage("");

      const response = await fetch(
        "/api/vendor/catalog/imports/template",
        {
          method: "GET",
          credentials: "include",
        }
      );

      if (!response.ok) {
        let data = null;

        try {
          data = await response.json();
        } catch {
          data = null;
        }

        throw new Error(
          data?.message ||
            data?.error ||
            "Modelul Excel nu a putut fi descărcat."
        );
      }

      const blob = await response.blob();

      const disposition =
        response.headers.get(
          "content-disposition"
        );

      const fileNameMatch =
        disposition?.match(
          /filename="?([^"]+)"?/i
        );

      const fileName =
        fileNameMatch?.[1] ||
        "model-import-produse-artfest.xlsx";

      const objectUrl =
        URL.createObjectURL(blob);

      const link =
        document.createElement("a");

      link.href = objectUrl;
      link.download = fileName;

      document.body.appendChild(link);

      link.click();
      link.remove();

      URL.revokeObjectURL(objectUrl);
    } catch (error) {
      console.error(
        "[CatalogImports] template:",
        error
      );

      setErrorMessage(
        error.message ||
          "Modelul Excel nu a putut fi descărcat."
      );
    } finally {
      setIsDownloadingTemplate(false);
    }
  }

  async function handleExportProducts() {
    try {
      setIsExportingProducts(true);
      setErrorMessage("");

      const response = await fetch(
        "/api/vendor/catalog/imports/export",
        {
          method: "GET",
          credentials: "include",
        }
      );

      if (!response.ok) {
        let data = null;

        try {
          data = await response.json();
        } catch {
          data = null;
        }

        throw new Error(
          data?.message ||
            data?.error ||
            "Catalogul nu a putut fi descărcat."
        );
      }

      const blob =
        await response.blob();

      const disposition =
        response.headers.get(
          "content-disposition"
        );

      const fileNameMatch =
        disposition?.match(
          /filename="?([^"]+)"?/i
        );

      const fileName =
        fileNameMatch?.[1] ||
        "catalog-produse-artfest.xlsx";

      const objectUrl =
        URL.createObjectURL(blob);

      const link =
        document.createElement("a");

      link.href = objectUrl;
      link.download = fileName;

      document.body.appendChild(
        link
      );

      link.click();
      link.remove();

      URL.revokeObjectURL(
        objectUrl
      );
    } catch (error) {
      console.error(
        "[CatalogImports] export:",
        error
      );

      setErrorMessage(
        error.message ||
          "Catalogul nu a putut fi descărcat."
      );
    } finally {
      setIsExportingProducts(false);
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
          {IMPORT_SOURCES.map((source) => {
            const Icon = source.icon;

            return (
              <div
                key={source.key}
                className={`${styles.sourceCard} ${
                  !source.available
                    ? styles.sourceCardDisabled
                    : ""
                }`}
              >
                <div
                  className={
                    styles.sourceIcon
                  }
                >
                  <Icon size={24} />
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
                      {source.title}
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

                  <p>{source.subtitle}</p>

                  {source.available && (
                    <div
                      className={
                        styles.sourceActions
                      }
                    >
                      <button
  type="button"
  className={styles.primaryBtn}
  onClick={() => {
    setSelectedSource(source.key);
    setErrorMessage("");
    setSelectedFile(null);
    setImportId(null);
    setStep("UPLOAD");
  }}
>
  <Upload size={16} />
  Importă produse
</button>

                      {source.canDownloadTemplate && (
                        <button
                          type="button"
                          className={
                            styles.secondaryBtn
                          }
                          disabled={
                            isDownloadingTemplate
                          }
                          onClick={
                            handleDownloadTemplate
                          }
                        >
                          {isDownloadingTemplate ? (
                            <>
                              <RefreshCw
                                size={16}
                                className={
                                  styles.spin
                                }
                              />
                              Pregătim...
                            </>
                          ) : (
                            <>
                              <Download size={16} />
                              Descarcă model
                            </>
                          )}
                        </button>
                        
                      )}

                      {source.key === "EXCEL" && (
                        <button
                          type="button"
                          className={
                            styles.secondaryBtn
                          }
                          disabled={
                            isExportingProducts
                          }
                          onClick={
                            handleExportProducts
                          }
                        >
                          {isExportingProducts ? (
                            <>
                              <RefreshCw
                                size={16}
                                className={
                                  styles.spin
                                }
                              />
                              Pregătim...
                            </>
                          ) : (
                            <>
                              <Download size={16} />
                              Descarcă produsele mele
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <section
          className={
            styles.aiBox
          }
        >
          <Sparkles
            size={22}
          />

          <div>
            <strong>
              Import inteligent
            </strong>

            <p>
              Artfest identifică automat
              coloanele pentru titlu,
              descriere, preț, categorie,
              stoc și alte informații.
              Tu verifici totul înainte
              să se importe ceva.
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

        {services.length > 1 && (
          <section
            className={
              styles.infoCard
            }
          >
            <ShoppingBag
              size={20}
            />

            <div
              style={{
                width: "100%",
              }}
            >
              <strong>
                În ce magazin vrei să imporți produsele?
              </strong>

              <p>
                Ai mai multe magazine pe Artfest. Alege destinația acestui import.
              </p>

              <select
                className={
                  styles.select
                }
                value={
                  selectedServiceId
                }
                disabled={
                  isLoadingServices ||
                  isAnalyzing
                }
                onChange={(
                  event
                ) => {
                  setSelectedServiceId(
                    event.target.value
                  );

                  setErrorMessage(
                    ""
                  );
                }}
                style={{
                  width: "100%",
                  marginTop: 10,
                }}
              >
                <option value="">
                  Alege magazinul
                </option>

                {services.map(
                  (service) => (
                    <option
                      key={
                        service.id
                      }
                      value={
                        service.id
                      }
                    >
                      {service.title}
                      {!service.isActive
                        ? " (inactiv)"
                        : ""}
                    </option>
                  )
                )}
              </select>
            </div>
          </section>
        )}

        {services.length === 1 && (
          <section
            className={
              styles.infoCard
            }
          >
            <ShoppingBag
              size={20}
            />

            <div>
              <strong>
                Magazin destinație
              </strong>

              <p>
                {services[0].title}
              </p>
            </div>
          </section>
        )}

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
            onDrop={
              handleDrop
            }
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
              ref={
                fileInputRef
              }
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
              <Upload
                size={27}
              />
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
                  ).toFixed(
                    1
                  )}{" "}
                  KB
                </span>
              </div>

              <button
                type="button"
                className={
                  styles.iconBtn
                }
                onClick={(
                  event
                ) => {
                  event.stopPropagation();

                  setSelectedFile(
                    null
                  );

                  setErrorMessage(
                    ""
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
                <Trash2
                  size={18}
                />
              </button>
            </div>
          )}
        </section>

        <section
          className={
            styles.infoCard
          }
        >
          <FileText
            size={20}
          />

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
              isAnalyzing ||
              isLoadingServices ||
              (
                services.length > 1 &&
                !selectedServiceId
              )
            }
            onClick={
              analyzeFile
            }
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
          <Sparkles
            size={20}
          />

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
              Potrivire
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
                        column.mappedTo ||
                        "ignore"
                      }
                      onChange={(
                        event
                      ) =>
                        updateMapping(
                          column.source,
                          event.target.value
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
                        Number(
                          column.confidence ||
                            0
                        ) *
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
            disabled={
              isPreviewing
            }
            onClick={
              goToPreview
            }
          >
            {isPreviewing ? (
              <>
                <RefreshCw
                  size={17}
                  className={
                    styles.spin
                  }
                />

                Generăm preview...
              </>
            ) : (
              <>
                Previzualizează produsele

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
            value={
              summary.total
            }
          />

          <SummaryCard
            label="Gata de import"
            value={
              summary.ready
            }
            type="success"
          />

          <SummaryCard
            label="Avertismente"
            value={
              summary.warning
            }
            type="warning"
          />

          <SummaryCard
            label="Erori"
            value={
              summary.error
            }
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
                checked={
                  onlyIssues
                }
                onChange={(
                  event
                ) =>
                  setOnlyIssues(
                    event.target.checked
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
                  <th>
                    Rând
                  </th>

                  <th>
                    Produs
                  </th>

                  <th>
                    Categorie
                  </th>

                  <th>
                    Preț
                  </th>

                  <th>
                    Stoc
                  </th>

                  <th>
                    Status
                  </th>

                  <th>
                    Acțiuni
                  </th>
                </tr>
              </thead>

              <tbody>
                {visibleRows.map(
                  (row) => (
                    <tr
                      key={
                        row.id
                      }
                    >
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
                          null &&
                        row.price !==
                          undefined
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

                        {!!row
                          .warnings
                          ?.length && (
                          <div
                            className={
                              styles.warningList
                            }
                          >
                            {row.warnings.map(
                              (
                                warning,
                                index
                              ) => (
                                <span
                                  key={`${warning}-${index}`}
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

        {summary.error >
          0 && (
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
                valide. Produsele cu erori
                rămân în istoricul
                importului pentru
                verificare.
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
            onClick={
              executeImport
            }
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
                ?.importedRows ||
                0}
            </strong>
          </div>

          <div>
            <span>
              Neimportate
            </span>

            <strong>
              {importResult
                ?.failedRows ||
                0}
            </strong>
          </div>

          <div>
            <span>
              Total
            </span>

            <strong>
              {importResult
                ?.totalRows ||
                0}
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
            onClick={() => {
              /*
               * Suntem deja în Catalog.
               * Pentru moment revenim
               * la începutul importului.
               * Mai târziu putem primi
               * onGoToProducts de la
               * CatalogProdusePage.
               */
              resetImportFlow();
            }}
          >
            <Eye
              size={17}
            />

            Vezi produsele
          </button>
        </div>
      </section>
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

        {step !==
          "SOURCE" && (
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

      {errorMessage && (
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
              Importul nu poate continua
            </strong>

            <p>
              {errorMessage}
            </p>
          </div>
        </section>
      )}

      {step ===
        "SOURCE" &&
        renderSourceStep()}

      {step ===
        "UPLOAD" &&
        renderUploadStep()}

      {step ===
        "MAPPING" &&
        renderMappingStep()}

      {step ===
        "PREVIEW" &&
        renderPreviewStep()}

      {step ===
        "RESULT" &&
        renderResultStep()}

      <ImportHistory
        history={history}
        isLoading={
          isLoadingHistory
        }
        onRetryFailed={
          retryFailedImport
        }
        onDownloadErrors={
          downloadImportErrors
        }
        retryingImportId={
          retryingImportId
        }
        downloadingReportId={
          downloadingReportId
        }
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
        <ArrowLeft
          size={17}
        />

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
              key={
                item.key
              }
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
                {
                  item.label
                }
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
        type ===
        "success"
          ? styles.summarySuccess
          : type ===
            "warning"
          ? styles.summaryWarning
          : type ===
            "error"
          ? styles.summaryError
          : ""
      }`}
    >
      <span>
        {label}
      </span>

      <strong>
        {value}
      </strong>
    </div>
  );
}

function ImportHistory({
  history,
  isLoading,
  onRetryFailed,
  onDownloadErrors,
  retryingImportId,
  downloadingReportId,
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

      {isLoading ? (
        <div
          className={
            styles.emptyHistory
          }
        >
          Se încarcă istoricul...
        </div>
      ) : !history.length ? (
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
                key={
                  item.id
                }
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
                      {item.fileName ||
                        "Import produse"}
                    </strong>

                    <span>
                      {sourceLabel(
                        item.source
                      )}{" "}
                      ·{" "}
                      {
                        item.createdAt
                      }

                      {item.service?.title
                        ? ` · ${item.service.title}`
                        : ""}
                    </span>
                  </div>
                </div>

                <div
                  className={
                    styles.historyNumbers
                  }
                >
                  <span>
                    {item.importedRows ||
                      0}{" "}
                    importate
                  </span>

                  {Number(
                    item.warningRows ||
                      0
                  ) > 0 && (
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

                  {Number(
                    item.failedRows ||
                      0
                  ) > 0 && (
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
                      : item.status ===
                          "FAILED"
                      ? styles.historyStatusError
                      : styles.historyStatusWarning
                  }`}
                >
                  {statusLabel(
                    item.status
                  )}
                </span>

                <div
                  className={
                    styles.rowActions
                  }
                >
                  {(Number(
                    item.warningRows ||
                      0
                  ) > 0 ||
                    Number(
                      item.failedRows ||
                        0
                    ) > 0) && (
                    <button
                      type="button"
                      className={
                        styles.iconBtn
                      }
                      title="Descarcă raport erori"
                      disabled={
                        downloadingReportId ===
                        item.id
                      }
                      onClick={() =>
                        onDownloadErrors(
                          item
                        )
                      }
                    >
                      {downloadingReportId ===
                      item.id ? (
                        <RefreshCw
                          size={17}
                          className={
                            styles.spin
                          }
                        />
                      ) : (
                        <Download
                          size={17}
                        />
                      )}
                    </button>
                  )}

                  {Number(
                    item.failedRows ||
                      0
                  ) > 0 && (
                    <button
                      type="button"
                      className={
                        styles.iconBtn
                      }
                      title="Reîncearcă produsele eșuate"
                      disabled={
                        retryingImportId ===
                        item.id
                      }
                      onClick={() =>
                        onRetryFailed(
                          item
                        )
                      }
                    >
                      <RefreshCw
                        size={17}
                        className={
                          retryingImportId ===
                          item.id
                            ? styles.spin
                            : undefined
                        }
                      />
                    </button>
                  )}

                  <button
                    type="button"
                    className={
                      styles.iconBtn
                    }
                    title="Vezi detalii"
                    onClick={() => {
                      alert(
                        `Import: ${
                          item.fileName ||
                          item.id
                        }\n\nMagazin: ${
                          item.service?.title ||
                          "—"
                        }\nStatus: ${statusLabel(
                          item.status
                        )}\nTotal: ${
                          item.totalRows ||
                          0
                        }\nImportate: ${
                          item.importedRows ||
                          0
                        }\nAvertismente: ${
                          item.warningRows ||
                          0
                        }\nErori: ${
                          item.failedRows ||
                          0
                        }`
                      );
                    }}
                  >
                    <Eye
                      size={17}
                    />
                  </button>
                </div>
              </div>
            )
          )}
        </div>
      )}
    </section>
  );
}