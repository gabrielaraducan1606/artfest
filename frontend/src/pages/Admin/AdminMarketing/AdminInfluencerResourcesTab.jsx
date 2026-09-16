import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { toast } from "react-toastify";

import { api } from "../../../lib/api";
import styles from "./AdminInfluencersTab.module.css";

/* =========================================================
   CONSTANTE
========================================================= */

const RESOURCE_TYPES = [
  { value: "PRODUCT_OF_DAY", label: "Produsul zilei" },
  { value: "ARTISAN_OF_WEEK", label: "Artizanul săptămânii" },
  { value: "POST_IDEA", label: "Idee de postare" },
  { value: "ARTFEST_FEATURE", label: "Funcționalitate Artfest" },
  { value: "CAMPAIGN", label: "Campanie" },
  { value: "GENERIC", label: "General" },
];

const RESOURCE_TYPE_LABELS = Object.fromEntries(
  RESOURCE_TYPES.map((item) => [item.value, item.label])
);

/*
 * Filtru principal de activitate - același interval FIX de
 * 14 zile folosit de backend (adminInfluencerResourcesRoutes.js),
 * nu recalculăm nimic aici, doar citim câmpurile deja calculate
 * server-side (influencersPostedCount, postedStaleCount).
 */
const ACTIVITY_FILTERS = [
  { id: "all", label: "Toate" },
  { id: "used", label: "Folosite" },
  { id: "unused", label: "Nefolosite" },
  { id: "stale", label: "De reluat" },
];

/*
 * Filtru de categorie - aceeași mapare de tip folosită pe
 * partea de influencer (InfluencerResourcesSection.jsx), ca
 * să fie coerentă în tot produsul.
 */
const CATEGORY_FILTERS = [
  { id: "all", label: "Toate" },
  ...RESOURCE_TYPES.map((item) => ({
    id: item.value,
    label: item.label,
  })),
];

function matchesCategoryFilter(resource, categoryId) {
  if (categoryId === "all") {
    return true;
  }

  return resource.type === categoryId;
}

function matchesActivityFilter(resource, filterId) {
  const postedCount = Number(
    resource.influencersPostedCount || 0
  );

  const staleCount = Number(
    resource.postedStaleCount || 0
  );

  if (filterId === "used") {
    return postedCount > 0;
  }

  if (filterId === "unused") {
    return postedCount === 0;
  }

  if (filterId === "stale") {
    return staleCount > 0;
  }

  return true;
}

const INITIAL_FORM = {
  type: "GENERIC",
  title: "",
  description: "",
  helpText: "",
  mediaType: null,
  mediaUrl: "",
  targetUrl: "",
  status: "DRAFT",
  expiresAt: "",
};

const HELP_TEXT_MAX_LENGTH = 2000;

/* =========================================================
   FORMATTERS
========================================================= */

function formatDate(value) {
  if (!value) {
    return "—";
  }

  try {
    return new Date(value).toLocaleString("ro-RO");
  } catch {
    return "—";
  }
}

function toDateTimeLocalValue(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const pad = (n) => String(n).padStart(2, "0");

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/* =========================================================
   COMPONENT
========================================================= */

export default function AdminInfluencerResourcesTab() {
  const [resources, setResources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(INITIAL_FORM);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [statusUpdatingId, setStatusUpdatingId] = useState("");
  const [deletingId, setDeletingId] = useState("");

  const [categoryFilter, setCategoryFilter] =
    useState("all");

  const [activityFilter, setActivityFilter] =
    useState("all");

  const [activityResource, setActivityResource] =
    useState(null);

  const isEditing = Boolean(editingId);

  /* =========================================================
     LOAD
  ========================================================= */

  const loadResources = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const data = await api(
        "/api/admin/influencer-resources"
      );

      if (data?.ok === false) {
        throw new Error(
          data?.message || "Nu am putut încărca resursele."
        );
      }

      setResources(
        Array.isArray(data?.items) ? data.items : []
      );
    } catch (err) {
      setError(
        err?.data?.message ||
          err?.message ||
          "Nu am putut încărca resursele."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadResources();
  }, [loadResources]);

  const sortedResources = useMemo(
    () =>
      [...resources].sort(
        (a, b) =>
          new Date(b.createdAt || 0).getTime() -
          new Date(a.createdAt || 0).getTime()
      ),
    [resources]
  );

  const visibleResources = useMemo(
    () =>
      sortedResources.filter(
        (resource) =>
          matchesCategoryFilter(resource, categoryFilter) &&
          matchesActivityFilter(resource, activityFilter)
      ),
    [sortedResources, categoryFilter, activityFilter]
  );

  /* =========================================================
     MODAL
  ========================================================= */

  function openCreateModal() {
    setEditingId(null);
    setForm(INITIAL_FORM);
    setModalOpen(true);
  }

  function openEditModal(resource) {
    setEditingId(resource.id);

    setForm({
      type: resource.type || "GENERIC",
      title: resource.title || "",
      description: resource.description || "",
      helpText: resource.helpText || "",
      mediaType: resource.mediaType || null,
      mediaUrl: resource.mediaUrl || "",
      targetUrl: resource.targetUrl || "",
      status: resource.status || "DRAFT",
      expiresAt: toDateTimeLocalValue(resource.expiresAt),
    });

    setModalOpen(true);
  }

  function closeModal() {
    if (saving || uploading) {
      return;
    }

    setModalOpen(false);
    setEditingId(null);
    setForm(INITIAL_FORM);
  }

  function updateField(field, value) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  /* =========================================================
     UPLOAD MEDIA
  ========================================================= */

  async function handleFileChange(event) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    setUploading(true);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const data = await api(
        "/api/admin/influencer-resources/upload",
        {
          method: "POST",
          body: formData,
        }
      );

      if (data?.ok === false || !data?.url) {
        throw new Error(
          data?.message || "Nu am putut încărca fișierul."
        );
      }

      updateField("mediaUrl", data.url);
      updateField("mediaType", data.mediaType);

      toast.success("Fișierul a fost încărcat.");
    } catch (err) {
      toast.error(
        err?.data?.message ||
          err?.message ||
          "Nu am putut încărca fișierul."
      );
    } finally {
      setUploading(false);
    }
  }

  function removeMedia() {
    updateField("mediaUrl", "");
    updateField("mediaType", null);
  }

  /* =========================================================
     SAVE
  ========================================================= */

  async function submitForm(event) {
    event.preventDefault();

    const title = form.title.trim();

    if (!title) {
      toast.error("Titlul este obligatoriu.");
      return;
    }

    /*
     * expiresAt trebuie să fie în viitor - altfel o resursă
     * publicată devine invizibilă pentru influenceri chiar din
     * momentul publicării (vezi GET /api/influencer/resources,
     * care exclude explicit expiresAt <= now).
     */
    const expiresAtDate = form.expiresAt
      ? new Date(form.expiresAt)
      : null;

    if (expiresAtDate && expiresAtDate <= new Date()) {
      toast.error(
        "Data expirării trebuie să fie în viitor."
      );
      return;
    }

    setSaving(true);

    try {
      const payload = {
        type: form.type,
        title,
        description: form.description.trim() || null,
        helpText: form.helpText.trim() || null,
        mediaType: form.mediaUrl ? form.mediaType : null,
        mediaUrl: form.mediaUrl || null,
        targetUrl: form.targetUrl.trim() || null,
        status: form.status,
        expiresAt: expiresAtDate
          ? expiresAtDate.toISOString()
          : null,
      };

      const endpoint = isEditing
        ? `/api/admin/influencer-resources/${encodeURIComponent(
            editingId
          )}`
        : "/api/admin/influencer-resources";

      const method = isEditing ? "PATCH" : "POST";

      const data = await api(endpoint, {
        method,
        body: payload,
      });

      if (data?.ok === false) {
        throw new Error(
          data?.message || "Nu am putut salva resursa."
        );
      }

      toast.success(
        isEditing
          ? "Resursa a fost actualizată."
          : "Resursa a fost salvată."
      );

      setModalOpen(false);
      setEditingId(null);
      setForm(INITIAL_FORM);

      await loadResources();
    } catch (err) {
      toast.error(
        err?.data?.message ||
          err?.message ||
          "Nu am putut salva resursa."
      );
    } finally {
      setSaving(false);
    }
  }

  /* =========================================================
     PUBLICĂ / RETRAGE
  ========================================================= */

  async function toggleStatus(resource) {
    const nextStatus =
      resource.status === "PUBLISHED" ? "DRAFT" : "PUBLISHED";

    setStatusUpdatingId(resource.id);

    try {
      const data = await api(
        `/api/admin/influencer-resources/${encodeURIComponent(
          resource.id
        )}`,
        {
          method: "PATCH",

          body: {
            type: resource.type,
            title: resource.title,
            description: resource.description,
            helpText: resource.helpText,
            mediaType: resource.mediaUrl
              ? resource.mediaType
              : null,
            mediaUrl: resource.mediaUrl,
            targetUrl: resource.targetUrl,
            status: nextStatus,
            expiresAt: resource.expiresAt,
          },
        }
      );

      if (data?.ok === false) {
        throw new Error(
          data?.message ||
            "Nu am putut actualiza statusul resursei."
        );
      }

      toast.success(
        nextStatus === "PUBLISHED"
          ? "Resursa a fost publicată."
          : "Resursa a fost retrasă."
      );

      await loadResources();
    } catch (err) {
      toast.error(
        err?.data?.message ||
          err?.message ||
          "Nu am putut actualiza statusul resursei."
      );
    } finally {
      setStatusUpdatingId("");
    }
  }

  /* =========================================================
     DELETE
  ========================================================= */

  async function deleteResource(resource) {
    const confirmed = window.confirm(
      `Sigur vrei să ștergi resursa „${resource.title}”?`
    );

    if (!confirmed) {
      return;
    }

    setDeletingId(resource.id);

    try {
      const data = await api(
        `/api/admin/influencer-resources/${encodeURIComponent(
          resource.id
        )}`,
        { method: "DELETE" }
      );

      if (data?.ok === false) {
        throw new Error(
          data?.message || "Nu am putut șterge resursa."
        );
      }

      toast.success("Resursa a fost ștearsă.");

      setResources((current) =>
        current.filter((item) => item.id !== resource.id)
      );
    } catch (err) {
      toast.error(
        err?.data?.message ||
          err?.message ||
          "Nu am putut șterge resursa."
      );
    } finally {
      setDeletingId("");
    }
  }

  /* =========================================================
     PAGE
  ========================================================= */

  return (
    <div>
      <div className={styles.header}>
        <div className={styles.headerText}>
          <h3 className={styles.title}>
            Resurse pentru influenceri
          </h3>

          <p className={styles.subtitle}>
            Materiale pe care influencerii le pot folosi direct
            în conținutul lor: produsul zilei, idei de postări,
            campanii și alte materiale Artfest.
          </p>
        </div>

        <button
          type="button"
          onClick={openCreateModal}
          className={styles.primaryButton}
        >
          + Adaugă resursă
        </button>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "nowrap",
          overflowX: "auto",
          WebkitOverflowScrolling: "touch",
          paddingBottom: 6,
          marginTop: 4,
        }}
      >
        {CATEGORY_FILTERS.map((filterItem) => (
          <FilterPill
            key={filterItem.id}
            active={categoryFilter === filterItem.id}
            onClick={() =>
              setCategoryFilter(filterItem.id)
            }
          >
            {filterItem.label}
          </FilterPill>
        ))}
      </div>

      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "nowrap",
          overflowX: "auto",
          WebkitOverflowScrolling: "touch",
          paddingBottom: 6,
          marginTop: 8,
          marginBottom: 16,
        }}
      >
        {ACTIVITY_FILTERS.map((filterItem) => (
          <FilterPill
            key={filterItem.id}
            active={activityFilter === filterItem.id}
            onClick={() =>
              setActivityFilter(filterItem.id)
            }
          >
            {filterItem.label}
          </FilterPill>
        ))}
      </div>

      {loading ? (
        <div className={styles.loading}>
          Se încarcă resursele…
        </div>
      ) : sortedResources.length === 0 ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyTitle}>
            Nu ai încă nicio resursă.
          </div>

          <div
            className={`${styles.emptyText} ${styles.emptyTextWithButton}`}
          >
            Adaugă prima resursă pentru influenceri.
          </div>

          <button
            type="button"
            onClick={openCreateModal}
            className={styles.primaryButton}
          >
            + Adaugă resursă
          </button>
        </div>
      ) : visibleResources.length === 0 ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyTitle}>
            Nu există resurse în această categorie.
          </div>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "repeat(auto-fill, minmax(260px, 1fr))",
            gap: 14,
          }}
        >
          {visibleResources.map((resource) => (
            <ResourceCard
              key={resource.id}
              resource={resource}
              statusUpdating={
                statusUpdatingId === resource.id
              }
              deleting={deletingId === resource.id}
              onEdit={() => openEditModal(resource)}
              onToggleStatus={() => toggleStatus(resource)}
              onDelete={() => deleteResource(resource)}
              onViewActivity={() =>
                setActivityResource(resource)
              }
            />
          ))}
        </div>
      )}

      {activityResource && (
        <ResourceActivityModal
          resource={activityResource}
          onClose={() => setActivityResource(null)}
        />
      )}

      {modalOpen && (
        <div
          role="presentation"
          className={styles.modalBackdrop}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeModal();
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="influencer-resource-title"
            className={styles.modal}
          >
            <div className={styles.modalHeader}>
              <div>
                <h3
                  id="influencer-resource-title"
                  className={styles.modalTitle}
                >
                  {isEditing
                    ? "Editează resursa"
                    : "Resursă nouă"}
                </h3>

                <p className={styles.modalSubtitle}>
                  Completează informațiile pe care le va vedea
                  influencerul.
                </p>
              </div>

              <button
                type="button"
                onClick={closeModal}
                disabled={saving || uploading}
                aria-label="Închide"
                className={styles.closeButton}
              >
                ×
              </button>
            </div>

            <form onSubmit={submitForm} className={styles.form}>
              <FormField label="Tip" required>
                <select
                  value={form.type}
                  onChange={(event) =>
                    updateField("type", event.target.value)
                  }
                  className={styles.input}
                >
                  {RESOURCE_TYPES.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </FormField>

              <FormField label="Titlu" required>
                <input
                  type="text"
                  value={form.title}
                  placeholder="Ex: Produsul zilei - 2 septembrie"
                  onChange={(event) =>
                    updateField("title", event.target.value)
                  }
                  className={styles.input}
                />
              </FormField>

              <FormField label="Descriere / caption">
                <textarea
                  value={form.description}
                  placeholder="Textul pe care influencerul îl poate copia pentru postare..."
                  onChange={(event) =>
                    updateField(
                      "description",
                      event.target.value
                    )
                  }
                  className={styles.input}
                  rows={4}
                  style={{ resize: "vertical" }}
                />
              </FormField>

              <FormField
                label="Informații suplimentare"
                hint="Acest text va fi afișat influencerilor când apasă pe butonul ?."
              >
                <textarea
                  value={form.helpText}
                  placeholder="Ex: Ce produs este, de ce l-am ales, cum îl poți folosi în conținutul tău..."
                  maxLength={HELP_TEXT_MAX_LENGTH}
                  onChange={(event) =>
                    updateField(
                      "helpText",
                      event.target.value
                    )
                  }
                  className={styles.input}
                  rows={4}
                  style={{ resize: "vertical" }}
                />

                <div
                  className={styles.fieldHint}
                  style={{ textAlign: "right" }}
                >
                  {form.helpText.length}/{HELP_TEXT_MAX_LENGTH}
                </div>
              </FormField>

              <FormField
                label="Media (imagine sau video)"
                hint="Opțional - de ex. o idee de postare poate avea doar text."
              >
                {form.mediaUrl ? (
                  <div
                    style={{
                      display: "grid",
                      gap: 8,
                    }}
                  >
                    {form.mediaType === "VIDEO" ? (
                      <video
                        src={form.mediaUrl}
                        controls
                        style={{
                          width: "100%",
                          maxHeight: 220,
                          borderRadius: 10,
                          background: "#000",
                        }}
                      />
                    ) : (
                      <img
                        src={form.mediaUrl}
                        alt="Preview"
                        style={{
                          width: "100%",
                          maxHeight: 220,
                          objectFit: "contain",
                          borderRadius: 10,
                          border: "1px solid #e5e7eb",
                        }}
                      />
                    )}

                    <button
                      type="button"
                      className={styles.secondaryButton}
                      onClick={removeMedia}
                      disabled={uploading}
                    >
                      Elimină media
                    </button>
                  </div>
                ) : (
                  <input
                    type="file"
                    accept="image/*,video/mp4,video/webm"
                    onChange={handleFileChange}
                    disabled={uploading}
                  />
                )}

                {uploading && (
                  <div
                    className={styles.fieldHint}
                    style={{ marginTop: 6 }}
                  >
                    Se încarcă fișierul…
                  </div>
                )}
              </FormField>

              <FormField label="Link țintă (targetUrl)">
                <input
                  type="url"
                  value={form.targetUrl}
                  placeholder="https://artfest.ro/produs/..."
                  onChange={(event) =>
                    updateField(
                      "targetUrl",
                      event.target.value
                    )
                  }
                  className={styles.input}
                />
              </FormField>

              <FormField label="Status">
                <select
                  value={form.status}
                  onChange={(event) =>
                    updateField("status", event.target.value)
                  }
                  className={styles.input}
                >
                  <option value="DRAFT">
                    Draft (doar în admin)
                  </option>
                  <option value="PUBLISHED">
                    Publicată (vizibilă influencerilor)
                  </option>
                </select>
              </FormField>

              <FormField
                label="Expiră la (opțional)"
                hint="După acest moment resursa nu mai apare în dashboardul influencerilor, dar rămâne în admin."
              >
                <input
                  type="datetime-local"
                  value={form.expiresAt}
                  onChange={(event) =>
                    updateField(
                      "expiresAt",
                      event.target.value
                    )
                  }
                  className={styles.input}
                />
              </FormField>

              <div className={styles.formActions}>
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={saving || uploading}
                  className={styles.secondaryButton}
                >
                  Renunță
                </button>

                <button
                  type="submit"
                  disabled={saving || uploading}
                  className={styles.primaryButton}
                >
                  {saving ? "Se salvează..." : "Salvează"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

/* =========================================================
   RESOURCE CARD
========================================================= */

function ResourceCard({
  resource,
  statusUpdating,
  deleting,
  onEdit,
  onToggleStatus,
  onDelete,
  onViewActivity,
}) {
  const isPublished = resource.status === "PUBLISHED";

  const activeCount = Number(
    resource.activeInfluencersCount || 0
  );

  const postedCount = Number(
    resource.influencersPostedCount || 0
  );

  const recentCount = Number(
    resource.postedRecentCount || 0
  );

  const staleCount = Number(
    resource.postedStaleCount || 0
  );

  const neverPostedCount = Number(
    resource.neverPostedCount ??
      Math.max(0, activeCount - postedCount)
  );

  /*
   * O resursă PUBLISHED cu expiresAt în trecut nu mai e vizibilă
   * pentru influenceri (vezi GET /api/influencer/resources) - nu
   * vrem ca admin-ul să creadă că e încă live.
   */
  const isExpired =
    isPublished &&
    Boolean(resource.expiresAt) &&
    new Date(resource.expiresAt) <= new Date();

  return (
    <article
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: 14,
        padding: 14,
        display: "grid",
        gap: 10,
      }}
    >
      {resource.mediaUrl && (
        <div
          style={{
            borderRadius: 10,
            overflow: "hidden",
            background: "#f3f4f6",
          }}
        >
          {resource.mediaType === "VIDEO" ? (
            <video
              src={resource.mediaUrl}
              controls
              style={{
                width: "100%",
                maxHeight: 160,
                display: "block",
              }}
            />
          ) : (
            <img
              src={resource.mediaUrl}
              alt={resource.title}
              style={{
                width: "100%",
                maxHeight: 160,
                objectFit: "cover",
                display: "block",
              }}
            />
          )}
        </div>
      )}

      <div
        className={styles.subtitle}
        style={{ fontSize: 12, fontWeight: 700 }}
      >
        {RESOURCE_TYPE_LABELS[resource.type] || resource.type}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <div style={{ fontWeight: 700 }}>{resource.title}</div>

        {Boolean(resource.helpText) && (
          <span
            title="Are informații suplimentare pentru influenceri"
            aria-label="Are informații suplimentare pentru influenceri"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 18,
              height: 18,
              flexShrink: 0,
              borderRadius: "50%",
              border: "1px solid #ddd6fe",
              background: "#f5f3ff",
              color: "#6d28d9",
              fontSize: 11,
              fontWeight: 800,
            }}
          >
            ?
          </span>
        )}
      </div>

      <span
        className={`${styles.status} ${
          isExpired
            ? styles.statusExpired
            : isPublished
            ? styles.statusActive
            : styles.statusDisabled
        }`}
        style={{ justifySelf: "start" }}
      >
        {isExpired
          ? "Expirată"
          : isPublished
          ? "Publicată"
          : "Draft"}
      </span>

      <div className={styles.subtitle} style={{ fontSize: 13 }}>
        Publicată: {formatDate(resource.publishedAt)}
        <br />
        Expiră: {formatDate(resource.expiresAt)}
      </div>

      {activeCount > 0 && (
        <div
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: 10,
            padding: 10,
            display: "grid",
            gap: 4,
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 13 }}>
            {postedCount} din {activeCount} influenceri
            au postat
          </div>

          <div
            className={styles.subtitle}
            style={{ fontSize: 12 }}
          >
            • {recentCount} recent
            <br />• {staleCount} de repostat
            <br />• {neverPostedCount} nu au postat
            niciodată
          </div>
        </div>
      )}

      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <SmallButton onClick={onEdit}>Editează</SmallButton>

        <SmallButton
          onClick={onToggleStatus}
          disabled={statusUpdating}
        >
          {statusUpdating
            ? "Se actualizează..."
            : isPublished
            ? "Retrage"
            : "Publică"}
        </SmallButton>

        <SmallButton onClick={onViewActivity}>
          Vezi activitatea
        </SmallButton>

        <SmallButton onClick={onDelete} disabled={deleting}>
          {deleting ? "Se șterge..." : "Șterge"}
        </SmallButton>
      </div>
    </article>
  );
}

/* =========================================================
   MODAL ACTIVITATE (cine a postat)
========================================================= */

function ResourceActivityModal({ resource, onClose }) {
  const [influencers, setInfluencers] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError("");

      try {
        const data = await api(
          `/api/admin/influencer-resources/${encodeURIComponent(
            resource.id
          )}/activity`
        );

        if (!active) {
          return;
        }

        if (data?.ok === false) {
          throw new Error(
            data?.message ||
              "Nu am putut încărca activitatea."
          );
        }

        setInfluencers(
          Array.isArray(data?.influencers)
            ? data.influencers
            : []
        );

        setSummary(data?.summary || null);
      } catch (err) {
        if (!active) {
          return;
        }

        setError(
          err?.data?.message ||
            err?.message ||
            "Nu am putut încărca activitatea."
        );
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      active = false;
    };
  }, [resource.id]);

  return (
    <div
      role="presentation"
      className={styles.modalBackdrop}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="resource-activity-title"
        className={styles.modal}
      >
        <div className={styles.modalHeader}>
          <div>
            <h3
              id="resource-activity-title"
              className={styles.modalTitle}
            >
              Cine a postat
            </h3>

            <p className={styles.modalSubtitle}>
              {resource.title}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Închide"
            className={styles.closeButton}
          >
            ×
          </button>
        </div>

        {summary && (
          <div
            className={styles.subtitle}
            style={{ marginBottom: 12 }}
          >
            {summary.postedCount} din{" "}
            {summary.activeInfluencersCount} au postat ·{" "}
            {summary.notPostedCount} încă nu au postat
          </div>
        )}

        {error && (
          <div className={styles.error}>{error}</div>
        )}

        {loading ? (
          <div className={styles.loading}>
            Se încarcă…
          </div>
        ) : influencers.length === 0 ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyTitle}>
              Niciun influencer activ momentan.
            </div>
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gap: 18,
              maxHeight: "60vh",
              overflowY: "auto",
            }}
          >
            <ActivityGroup
              title="De postat"
              influencers={influencers.filter(
                (influencer) => !influencer.hasPosted
              )}
            />

            <ActivityGroup
              title="De repostat"
              influencers={influencers.filter(
                (influencer) => influencer.isStale
              )}
            />

            <ActivityGroup
              title="Postat recent"
              influencers={influencers.filter(
                (influencer) =>
                  influencer.hasPosted &&
                  !influencer.isStale
              )}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/* =========================================================
   GRUP ACTIVITATE (De postat / De repostat / Postat recent)
========================================================= */

function ActivityGroup({ title, influencers }) {
  if (influencers.length === 0) {
    return null;
  }

  return (
    <div>
      <div
        style={{
          fontWeight: 700,
          fontSize: 13,
          marginBottom: 8,
          color: "#6b7280",
        }}
      >
        {title} ({influencers.length})
      </div>

      <div
        style={{
          display: "grid",
          gap: 8,
        }}
      >
        {influencers.map((influencer) => (
          <div
            key={influencer.influencerId}
            style={{
              border: "1px solid #e5e7eb",
              borderRadius: 10,
              padding: 10,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <div>
              <div style={{ fontWeight: 700 }}>
                {influencer.displayName}
              </div>

              {influencer.email && (
                <div
                  className={styles.subtitle}
                  style={{ fontSize: 12 }}
                >
                  {influencer.email}
                </div>
              )}

              <div
                className={styles.subtitle}
                style={{ fontSize: 12 }}
              >
                {influencer.hasPosted
                  ? `${formatLastPosted(
                      influencer.lastPostedAt
                    )} · Postat de ${
                      influencer.postedCount
                    } ${
                      influencer.postedCount === 1
                        ? "dată"
                        : "ori"
                    }`
                  : "Nu a postat încă"}
              </div>
            </div>

            <span
              className={`${styles.status} ${
                influencer.isStale
                  ? styles.statusExpired
                  : influencer.hasPosted
                  ? styles.statusActive
                  : styles.statusDisabled
              }`}
            >
              {influencer.isStale
                ? "De repostat"
                : influencer.hasPosted
                ? "A postat"
                : "Nu a postat încă"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatLastPosted(value) {
  if (!value) {
    return "Nu a postat încă";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Nu a postat încă";
  }

  const startOfDate = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  );

  const now = new Date();

  const startOfNow = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  );

  const days = Math.round(
    (startOfNow - startOfDate) / 86400000
  );

  if (days <= 0) {
    return "Ultima postare: azi";
  }

  return `Ultima postare: acum ${days} ${
    days === 1 ? "zi" : "zile"
  }`;
}

/* =========================================================
   FILTER PILL
========================================================= */

function FilterPill({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "7px 16px",
        borderRadius: 999,
        border: active
          ? "1px solid #ddd6fe"
          : "1px solid #e5e7eb",
        background: active ? "#f5f3ff" : "#ffffff",
        color: active ? "#6d28d9" : "#374151",
        fontWeight: active ? 700 : 500,
        fontSize: 13,
        whiteSpace: "nowrap",
        flexShrink: 0,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

/* =========================================================
   SMALL BUTTON
========================================================= */

function SmallButton({ children, onClick, disabled = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={styles.smallButton}
    >
      {children}
    </button>
  );
}

/* =========================================================
   FIELD
========================================================= */

function FormField({ label, hint, required, children }) {
  return (
    <label className={styles.field}>
      <div className={styles.fieldLabel}>
        {label}
        {required && (
          <span className={styles.required}>*</span>
        )}
      </div>

      {children}

      {hint && <div className={styles.fieldHint}>{hint}</div>}
    </label>
  );
}
