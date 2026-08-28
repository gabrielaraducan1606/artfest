import Modal from "../../../ui/Modal";
import styles from "../../../components/css/ProductModal.module.css";

function getSchemaFields(schema) {
  if (Array.isArray(schema)) {
    return schema;
  }

  if (Array.isArray(schema?.fields)) {
    return schema.fields;
  }

  return [];
}

function normalizeOrderMode(value) {
  if (value === "DIRECT") {
    return "READY_TO_BUY";
  }

  if (value === "CUSTOMIZABLE") {
    return "OPTIONS";
  }

  return value || "READY_TO_BUY";
}

function CustomFieldPreview({ field }) {
  const type = field.type || "text";

  if (type === "file") {
    return (
      <div className={styles.orderFieldCard}>
        <strong>{field.label}</strong>
        <div className={styles.tip}>
          📷 Buton „Încarcă fotografie”
        </div>
      </div>
    );
  }

  if (type === "date") {
    return (
      <div className={styles.orderFieldCard}>
        <strong>{field.label}</strong>
        <div className={styles.tip}>📅 zz/ll/aaaa</div>
      </div>
    );
  }

  return (
    <div className={styles.orderFieldCard}>
      <strong>{field.label}</strong>
      <div className={styles.tip}>
        {type === "textarea" ? "[ text mai lung ]" : "[ ______ ]"}
      </div>
    </div>
  );
}

/**
 * Previzualizare rapidă, în cuvinte simple, a ceea ce va vedea
 * clientul pe pagina produsului - NU publică nimic, doar arată
 * vendorului configurația curentă a formularului.
 */
export default function ProductClientPreviewModal({
  open,
  onClose,
  form,
  resolveProductImageUrl,
}) {
  if (!open) {
    return null;
  }

  const mode = normalizeOrderMode(form.orderMode);
  const optionFields = getSchemaFields(form.optionsSchema);
  const customFields = getSchemaFields(form.customSchema);
  const quoteFields = getSchemaFields(form.quoteSchema);

  const repeatedGroups = Array.isArray(form.repeatedGroups)
    ? form.repeatedGroups
    : [];

  const repeatedGroup = repeatedGroups[0] || null;

  const mainImage =
    Array.isArray(form.images) && form.images.length
      ? form.images[0]
      : null;

  return (
  <Modal open={open} onClose={onClose} maxWidth={560}>
    <div className={styles.clientPreviewModal}>
      <div className={styles.clientPreviewHeader}>
        <h3 className={styles.clientPreviewTitle}>
          Așa va vedea clientul produsul
        </h3>

        <p className={styles.clientPreviewSubtitle}>
          Doar previzualizare - produsul nu este publicat.
        </p>
      </div>

      <div className={styles.clientPreviewBody}>
        {mainImage && (
          <img
            src={resolveProductImageUrl?.(mainImage) || mainImage}
            alt="Previzualizare produs"
            className={styles.clientPreviewImage}
          />
        )}

        <h4 className={styles.clientPreviewProductTitle}>
          {form.title?.trim() || "(fără titlu încă)"}
        </h4>

        <p className={styles.clientPreviewDescription}>
          {form.description?.trim() || "(fără descriere încă)"}
        </p>

        <div className={styles.fieldGroup}>
          <strong className={styles.orderConfigTitle}>Preț</strong>

          <div className={styles.tip}>
            {mode === "QUOTE_ONLY"
              ? "Clientul nu vede un preț - trimite o cerere, iar tu răspunzi cu o ofertă."
              : form.price !== "" && form.price != null
                ? `${form.price} RON`
                : "(preț nesetat încă)"}
          </div>
        </div>

        {mode === "OPTIONS" && !!optionFields.length && (
          <div className={styles.fieldGroup}>
            <strong className={styles.orderConfigTitle}>
              Variante
            </strong>

            <div className={styles.orderFieldsList}>
              {optionFields.map((field) => (
                <div
                  key={field.key}
                  className={styles.orderFieldCard}
                >
                  <strong>{field.label}</strong>

                  <div className={styles.clientPreviewOptions}>
                    {(Array.isArray(field.options)
                      ? field.options
                      : []
                    ).map((option) => (
                      <span key={option}>○ {option}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {mode === "OPTIONS" && !!customFields.length && (
          <div className={styles.fieldGroup}>
            <strong className={styles.orderConfigTitle}>
              Personalizare
            </strong>

            <div className={styles.orderFieldsList}>
              {customFields.map((field) => (
                <CustomFieldPreview
                  key={field.key}
                  field={field}
                />
              ))}
            </div>
          </div>
        )}

        {mode === "OPTIONS" && !!repeatedGroup && (
          <div className={styles.fieldGroup}>
            <strong className={styles.orderConfigTitle}>
              Set / grup
            </strong>

            <div className={styles.tip}>
              Clientul va putea adăuga mai mulți membri și va
              completa, pentru fiecare:{" "}
              {(repeatedGroup.fields || [])
                .map((field) => field.label)
                .filter(Boolean)
                .join(", ") || "(niciun câmp ales încă)"}
            </div>
          </div>
        )}

        {mode === "QUOTE_ONLY" && (
          <div className={styles.fieldGroup}>
            <strong className={styles.orderConfigTitle}>
              Formular cerere ofertă
            </strong>

            <div className={styles.orderFieldsList}>
              {quoteFields.map((field) => (
                <CustomFieldPreview
                  key={field.key || field.id}
                  field={field}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <div className={styles.clientPreviewFooter}>
        <button
          type="button"
          className={styles.primaryBtn}
          onClick={onClose}
        >
          Am înțeles, închide previzualizarea
        </button>
      </div>
    </div>
  </Modal>
);
}
