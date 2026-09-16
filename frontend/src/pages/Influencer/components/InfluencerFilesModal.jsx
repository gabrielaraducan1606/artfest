import {
  useCallback,
  useEffect,
  useState,
} from "react";

import { api } from "../../../lib/api.js";

import styles from "./InfluencerFilesModal.module.css";

const FILE_TYPE_OPTIONS = [
  { value: "CONTRACT", label: "Contract" },
  { value: "BRIEF", label: "Brief" },
  { value: "DOCUMENT", label: "Document" },
  { value: "OTHER", label: "Altul" },
];

const FILE_TYPE_LABELS = FILE_TYPE_OPTIONS.reduce((acc, item) => {
  acc[item.value] = item.label;
  return acc;
}, {});

const ACCEPTED_EXTENSIONS =
  ".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx";

const EMPTY_FORM = {
  title: "",
  type: "DOCUMENT",
  file: null,
};

function formatBytes(value) {
  const bytes = Number(value || 0);

  if (!bytes) return "—";

  if (bytes < 1024) return `${bytes} B`;

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value) {
  if (!value) return "—";

  try {
    return new Date(value).toLocaleString("ro-RO", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

/*
 * Câmpurile formularului de upload, extrase separat ca să nu fie
 * duplicate între modul „manage” (formSheet peste listă, ca înainte)
 * și modul „upload” (formular simplu, folosit din Setări ->
 * Fiscalizare & plăți, unde lista reală e afișată direct în pagină -
 * vezi InfluencerPayoutProfileSettings.jsx).
 */
function AddFileFields({ form, setForm }) {
  return (
    <>
      <label className={styles.field}>
        <span>Titlu (opțional)</span>

        <input
          value={form.title}
          maxLength={200}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              title: event.target.value,
            }))
          }
          placeholder="Ex: Contract colaborare 2026"
        />
      </label>

      <label className={styles.field}>
        <span>Tip</span>

        <select
          value={form.type}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              type: event.target.value,
            }))
          }
        >
          {FILE_TYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className={styles.field}>
        <span>Fișier *</span>

        <input
          type="file"
          accept={ACCEPTED_EXTENSIONS}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              file: event.target.files?.[0] || null,
            }))
          }
        />

        <small>
          Acceptăm PDF, JPG, PNG, WEBP, DOC, DOCX, XLS sau XLSX,
          maximum 10MB.
        </small>
      </label>
    </>
  );
}

/*
 * mode="manage" (implicit) - comportamentul original: header sticky +
 * listă completă + upload/ștergere, folosit din dashboard ("Fișierele
 * mele").
 *
 * mode="upload" - modal compact, DOAR formularul de adăugare, fără
 * listă (evită duplicarea listei - lista reală rămâne exclusiv în
 * pagina care îl deschide). La succes se închide automat și
 * apelează onChanged, ca pagina care l-a deschis să-și reîmprospăteze
 * propria listă imediat.
 */
export default function InfluencerFilesModal({
  onClose,
  mode = "manage",
  onChanged,
}) {
  const isUploadOnly = mode === "upload";

  const [loading, setLoading] = useState(!isUploadOnly);
  const [files, setFiles] = useState([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [formOpen, setFormOpen] = useState(isUploadOnly);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [openingId, setOpeningId] = useState("");

  /* =========================================================
     MODAL LIFECYCLE
  ========================================================= */

  useEffect(() => {
    const previous = document.body.style.overflow;

    document.body.style.overflow = "hidden";

    function onKeyDown(event) {
      if (event.key !== "Escape") return;

      if (formOpen && !isUploadOnly) {
        setFormOpen(false);
        setForm(EMPTY_FORM);
        return;
      }

      onClose?.();
    }

    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, formOpen, isUploadOnly]);

  /* =========================================================
     LOAD (doar mode="manage" - modul "upload" nu afișează listă)
  ========================================================= */

  const loadFiles = useCallback(async () => {
    if (isUploadOnly) return;

    setLoading(true);
    setError("");

    try {
      const response = await api("/api/influencer/files");

      setFiles(
        Array.isArray(response?.items) ? response.items : []
      );
    } catch (err) {
      setFiles([]);

      setError(
        err?.data?.message ||
          err?.message ||
          "Nu am putut încărca fișierele."
      );
    } finally {
      setLoading(false);
    }
  }, [isUploadOnly]);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  /* =========================================================
     FORM
  ========================================================= */

  function openCreate() {
    setForm(EMPTY_FORM);
    setFormOpen(true);
    setError("");
    setSuccess("");
  }

  function closeForm() {
    if (isUploadOnly) {
      onClose?.();
      return;
    }

    setFormOpen(false);
    setForm(EMPTY_FORM);
  }

  async function saveFile(event) {
    event.preventDefault();

    if (!form.file) {
      setError("Alege un fișier de încărcat.");
      return;
    }

    setError("");
    setSuccess("");
    setSaving(true);

    try {
      const formData = new FormData();
      formData.append("file", form.file);
      formData.append("type", form.type);

      if (form.title.trim()) {
        formData.append("title", form.title.trim());
      }

      await api("/api/influencer/files", {
        method: "POST",
        body: formData,
      });

      onChanged?.();

      if (isUploadOnly) {
        onClose?.();
        return;
      }

      setSuccess("Fișierul a fost încărcat.");
      closeForm();
      await loadFiles();
    } catch (err) {
      setError(
        err?.data?.message ||
          err?.message ||
          "Nu am putut încărca fișierul."
      );
    } finally {
      setSaving(false);
    }
  }

  /* =========================================================
     OPEN (URL semnat, temporar - fileUrl nu mai e expus de API)
  ========================================================= */

  async function openFile(file) {
    setOpeningId(file.id);
    setError("");

    try {
      const response = await api(`/api/influencer/files/${file.id}/download`);
      window.open(response.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(
        err?.data?.message ||
          err?.message ||
          "Nu am putut deschide fișierul."
      );
    } finally {
      setOpeningId("");
    }
  }

  /* =========================================================
     DELETE (doar mode="manage")
  ========================================================= */

  async function deleteFile(file) {
    const confirmed = window.confirm(
      `Ștergi fișierul „${file.title || file.originalFilename}”?`
    );

    if (!confirmed) return;

    setBusyId(file.id);
    setError("");
    setSuccess("");

    try {
      await api(`/api/influencer/files/${file.id}`, {
        method: "DELETE",
      });

      setSuccess("Fișierul a fost șters.");
      await loadFiles();
      onChanged?.();
    } catch (err) {
      setError(
        err?.data?.message ||
          err?.message ||
          "Nu am putut șterge fișierul."
      );
    } finally {
      setBusyId("");
    }
  }

  /* =========================================================
     UI - mode="upload": formular compact, fără listă
  ========================================================= */

  if (isUploadOnly) {
    return (
      <div className={styles.backdrop} onMouseDown={onClose}>
        <div
          className={styles.modal}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <header className={styles.header}>
            <div>
              <div className={styles.eyebrow}>DOCUMENT NOU</div>

              <h2>Adaugă document</h2>

              <p>
                Încarcă un document (contract, brief sau alt document)
                pentru colaborarea cu Artfest.
              </p>
            </div>

            <div className={styles.headerActions}>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={onClose}
              >
                Închide
              </button>
            </div>
          </header>

          {error && <div className={styles.errorBox}>{error}</div>}

          <form onSubmit={saveFile} className={styles.form}>
            <AddFileFields form={form} setForm={setForm} />

            <div className={styles.formActions}>
              <button
                type="submit"
                className={styles.primaryButton}
                disabled={saving}
              >
                {saving ? "Se încarcă…" : "Încarcă"}
              </button>

              <button
                type="button"
                className={styles.secondaryButton}
                disabled={saving}
                onClick={onClose}
              >
                Anulează
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  /* =========================================================
     UI - mode="manage" (implicit, comportament original)
  ========================================================= */

  return (
    <div className={styles.backdrop} onMouseDown={onClose}>
      <div
        className={styles.modal}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className={styles.header}>
          <div>
            <div className={styles.eyebrow}>CONT</div>

            <h2>Fișierele mele</h2>

            <p>
              Încarcă și păstrează aici documentele pe care vrei să le ai
              la îndemână pentru colaborarea cu Artfest.
            </p>
          </div>

          <div className={styles.headerActions}>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={openCreate}
            >
              + Adaugă fișier
            </button>

            <button
              type="button"
              className={styles.secondaryButton}
              onClick={onClose}
            >
              Închide
            </button>
          </div>
        </header>

        {error && <div className={styles.errorBox}>{error}</div>}
        {success && <div className={styles.successBox}>{success}</div>}

        {loading ? (
          <div className={styles.centerState}>Se încarcă…</div>
        ) : !files.length ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>▤</div>

            <strong>Nu ai încă fișiere încărcate.</strong>

            <p>
              Adaugă contracte, briefuri sau alte documente utile pentru
              colaborarea ta cu Artfest.
            </p>

            <button
              type="button"
              className={styles.primaryButton}
              onClick={openCreate}
            >
              Adaugă primul fișier
            </button>
          </div>
        ) : (
          <div className={styles.fileList}>
            {files.map((file) => (
              <article key={file.id} className={styles.fileCard}>
                <div className={styles.fileMain}>
                  <div className={styles.fileTop}>
                    <strong className={styles.fileTitle}>
                      {file.title || file.originalFilename}
                    </strong>

                    <span className={styles.typeBadge}>
                      {FILE_TYPE_LABELS[file.type] || "Document"}
                    </span>
                  </div>

                  <div className={styles.fileMeta}>
                    <span>{file.originalFilename}</span>

                    <span>
                      Încărcat la {formatDate(file.createdAt)} ·{" "}
                      {formatBytes(file.sizeBytes)}
                    </span>
                  </div>
                </div>

                <div className={styles.fileActions}>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    disabled={openingId === file.id}
                    onClick={() => openFile(file)}
                  >
                    {openingId === file.id ? "Se deschide..." : "Deschide"}
                  </button>

                  <button
                    type="button"
                    className={`${styles.secondaryButton} ${styles.dangerButton}`}
                    disabled={busyId === file.id}
                    onClick={() => deleteFile(file)}
                  >
                    {busyId === file.id ? "Se șterge..." : "Șterge"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}

        {/* =====================================================
            ADD FILE
        ===================================================== */}

        {formOpen && (
          <div className={styles.formOverlay} onMouseDown={closeForm}>
            <div
              className={styles.formSheet}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className={styles.formHeader}>
                <div>
                  <div className={styles.eyebrow}>FIȘIER NOU</div>
                  <h3>Adaugă un fișier</h3>
                </div>

                <button
                  type="button"
                  className={styles.closeButton}
                  onClick={closeForm}
                  disabled={saving}
                >
                  ×
                </button>
              </div>

              <form onSubmit={saveFile} className={styles.form}>
                <AddFileFields form={form} setForm={setForm} />

                <div className={styles.formActions}>
                  <button
                    type="submit"
                    className={styles.primaryButton}
                    disabled={saving}
                  >
                    {saving ? "Se încarcă…" : "Încarcă"}
                  </button>

                  <button
                    type="button"
                    className={styles.secondaryButton}
                    disabled={saving}
                    onClick={closeForm}
                  >
                    Anulează
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
