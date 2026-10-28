import styles from "../../../components/css/ProductModal.module.css";
import {
  GPSR_ADDRESS_HINT,
  isValidGpsrAddress,
  isValidGpsrEmail,
} from "../../../../../../../../backend/src/lib/gpsrCompliance.js";
import {
  cancelEditingVendorGpsr,
  loadVendorGpsrManufacturer,
  startEditingVendorGpsr,
  updateVendorGpsrDraft,
  useVendorGpsrManufacturer,
} from "../../../utils/vendorGpsrManufacturer.js";

/*
 * Secțiune GPSR (Regulamentul UE 2023/988) - "Producător și
 * siguranță". Regulă de bază, aplicată peste tot unde e folosită
 * această secțiune: NU inventăm și NU completăm automat nimic aici -
 * inclusiv atunci când e deschisă dintr-un flux AI, vendorul trebuie
 * să confirme explicit fiecare răspuns.
 *
 * „Eu sunt producătorul = Da”: datele publice ale producătorului vin
 * dintr-o singură sursă, la nivel de vendor (Vendor.gpsrManufacturer*,
 * utils/vendorGpsrManufacturer.js) - completate o singură dată, la primul
 * produs, și refolosite automat. NU se preiau din adresa de retur,
 * facturare sau ridicare.
 *
 * `manufacturerProfile` (doar Admin) = { name, address, email, complete } -
 * datele centrale ale vendorului produsului, afișate read-only.
 */
export default function ProductGpsrSection({
  form,
  setForm,
  manufacturerProfile = null,
}) {
  const isOwnManufacturer = form.isOwnManufacturer;
  const adminView = !!manufacturerProfile;

  const setField = (field, value) =>
    setForm((current) => ({
      ...current,
      [field]: value,
    }));

  return (
    <div id="product-gpsr" className={styles.fieldGroup}>
      <strong className={styles.orderConfigTitle}>
        Producător și siguranță
      </strong>

      <p className={styles.sectionDescription}>
        Aceste informații sunt cerute de Regulamentul (UE) 2023/988
        privind siguranța generală a produselor și vor fi afișate
        public pe pagina produsului.
      </p>

      <label className={styles.label}>Eu sunt producătorul acestui produs</label>

      <div style={{ display: "flex", gap: 16, marginBottom: 8 }}>
        <label className={styles.checkbox}>
          <input
            type="radio"
            name="isOwnManufacturer"
            checked={isOwnManufacturer === true}
            onChange={() => setField("isOwnManufacturer", true)}
          />
          Da
        </label>

        <label className={styles.checkbox}>
          <input
            type="radio"
            name="isOwnManufacturer"
            checked={isOwnManufacturer === false}
            onChange={() => setField("isOwnManufacturer", false)}
          />
          Nu
        </label>
      </div>

      {isOwnManufacturer === true &&
        (adminView ? (
          <ManufacturerSummary
            contact={manufacturerProfile.complete ? manufacturerProfile : null}
            emptyText="Vânzătorul nu a completat încă datele publice ale producătorului. Pe pagina produsului nu apare producătorul până atunci."
          />
        ) : (
          <VendorManufacturerData />
        ))}

      {isOwnManufacturer === false && (
        <>
          <label className={styles.label} htmlFor="gpsr-manufacturer-name">
            Denumire producător / denumire comercială
          </label>
          <input
            id="gpsr-manufacturer-name"
            className={styles.input}
            value={form.manufacturerName || ""}
            onChange={(e) => setField("manufacturerName", e.target.value)}
          />

          <label className={styles.label} htmlFor="gpsr-manufacturer-address">
            Adresă poștală a producătorului
          </label>
          <input
            id="gpsr-manufacturer-address"
            className={styles.input}
            value={form.manufacturerAddress || ""}
            onChange={(e) => setField("manufacturerAddress", e.target.value)}
          />

          <label className={styles.label} htmlFor="gpsr-manufacturer-email">
            Email producător
          </label>
          <input
            id="gpsr-manufacturer-email"
            type="email"
            className={styles.input}
            value={form.manufacturerEmail || ""}
            onChange={(e) => setField("manufacturerEmail", e.target.value)}
          />

          <label className={styles.label}>
            Producătorul este stabilit în UE?
          </label>

          <div style={{ display: "flex", gap: 16, marginBottom: 8 }}>
            <label className={styles.checkbox}>
              <input
                type="radio"
                name="manufacturerInEU"
                checked={form.manufacturerInEU === true}
                onChange={() => setField("manufacturerInEU", true)}
              />
              Da
            </label>

            <label className={styles.checkbox}>
              <input
                type="radio"
                name="manufacturerInEU"
                checked={form.manufacturerInEU === false}
                onChange={() => setField("manufacturerInEU", false)}
              />
              Nu
            </label>
          </div>

          {form.manufacturerInEU === false && (
            <>
              <label className={styles.label} htmlFor="gpsr-rp-name">
                Nume persoană responsabilă în UE
              </label>
              <input
                id="gpsr-rp-name"
                className={styles.input}
                value={form.responsiblePersonName || ""}
                onChange={(e) => setField("responsiblePersonName", e.target.value)}
              />

              <label className={styles.label} htmlFor="gpsr-rp-address">
                Adresă persoană responsabilă
              </label>
              <input
                id="gpsr-rp-address"
                className={styles.input}
                value={form.responsiblePersonAddress || ""}
                onChange={(e) => setField("responsiblePersonAddress", e.target.value)}
              />

              <label className={styles.label} htmlFor="gpsr-rp-email">
                Email persoană responsabilă
              </label>
              <input
                id="gpsr-rp-email"
                type="email"
                className={styles.input}
                value={form.responsiblePersonEmail || ""}
                onChange={(e) => setField("responsiblePersonEmail", e.target.value)}
              />
            </>
          )}
        </>
      )}

      <label className={styles.label} htmlFor="gpsr-safety-warnings">
        Avertismente și informații de siguranță
      </label>

      <textarea
        id="gpsr-safety-warnings"
        className={styles.textarea}
        rows={3}
        value={form.safetyWarnings ?? ""}
        onChange={(e) => setField("safetyWarnings", e.target.value)}
        placeholder="ex: A nu se lăsa la îndemâna copiilor sub 3 ani, conține piese mici"
      />

      <label className={styles.checkbox} style={{ marginBottom: 12 }}>
        <input
          type="checkbox"
          checked={form.safetyWarnings === ""}
          onChange={(e) =>
            setField("safetyWarnings", e.target.checked ? "" : null)
          }
        />
        Nu se aplică avertismente de siguranță pentru acest produs
      </label>

      <label className={styles.label}>Produs destinat copiilor?</label>

      <div style={{ display: "flex", gap: 16 }}>
        <label className={styles.checkbox}>
          <input
            type="radio"
            name="isForChildren"
            checked={form.isForChildren === true}
            onChange={() => setField("isForChildren", true)}
          />
          Da
        </label>

        <label className={styles.checkbox}>
          <input
            type="radio"
            name="isForChildren"
            checked={form.isForChildren === false}
            onChange={() => setField("isForChildren", false)}
          />
          Nu
        </label>
      </div>
    </div>
  );
}

/* ---------- datele publice ale vendorului-producător ---------- */

// aceleași denumiri în formular, rezumat (vendor) și Admin
const GPSR_LABELS = {
  name: "Denumire producător / denumire comercială",
  address: "Adresă poștală publică de contact",
  email: "Email public de contact",
};

const GPSR_HINTS = {
  name: "Introdu denumirea legală sau denumirea comercială înregistrată sub care produci.",
  address: "Această adresă va fi afișată public pe pagina produsului.",
  email: "Această adresă de email va fi afișată public pe pagina produsului.",
};

const GPSR_PUBLIC_NOTICE =
  "Aceste date sunt publice. Denumirea producătorului, adresa poștală și adresa electronică vor fi afișate pe pagina produselor pentru care ești producător.";

function ManufacturerSummary({ contact, emptyText, action = null }) {
  return (
    <div className={styles.tip} style={{ marginBottom: 12 }} data-testid="gpsr-vendor-summary">
      <strong>Date publice producător</strong>

      {contact ? (
        <dl style={{ margin: "6px 0 0", overflowWrap: "anywhere", display: "grid", gap: 4 }}>
          {["name", "address", "email"].map((field) => (
            <div key={field}>
              <dt style={{ fontWeight: 600 }}>{GPSR_LABELS[field]}</dt>
              <dd style={{ margin: 0 }}>{contact[field]}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <div style={{ marginTop: 6 }}>{emptyText}</div>
      )}

      <div style={{ marginTop: 6, opacity: 0.85 }}>{GPSR_PUBLIC_NOTICE}</div>

      {action}
    </div>
  );
}

// eroarea unui câmp se arată doar după ce vendorul a scris ceva în el
function fieldError(field, value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (field === "address" && !isValidGpsrAddress(text)) return GPSR_ADDRESS_HINT;
  if (field === "email" && !isValidGpsrEmail(text)) return "Emailul nu este valid.";
  return "";
}

function VendorManufacturerData() {
  const gpsr = useVendorGpsrManufacturer();

  if (gpsr.status === "idle" || gpsr.status === "loading") {
    return (
      <div className={styles.tip} style={{ marginBottom: 12 }}>
        Se încarcă datele producătorului…
      </div>
    );
  }

  if (gpsr.status === "error") {
    return (
      <div className={styles.tip} style={{ marginBottom: 12 }} role="alert">
        Nu am putut încărca datele producătorului.{" "}
        <button
          type="button"
          className={styles.linkBtn}
          onClick={() => loadVendorGpsrManufacturer({ force: true })}
        >
          Reîncearcă
        </button>
      </div>
    );
  }

  if (!gpsr.draft) {
    return (
      <ManufacturerSummary
        contact={gpsr.saved}
        action={
          <button
            type="button"
            className={styles.smallBtn}
            style={{ marginTop: 8 }}
            onClick={startEditingVendorGpsr}
          >
            Modifică datele producătorului
          </button>
        }
      />
    );
  }

  const editing = gpsr.complete;
  const draft = gpsr.draft;

  const input = (field, id, props = {}) => {
    const error = fieldError(field, draft[field]);
    return (
      <>
        <label className={styles.label} htmlFor={id}>
          {GPSR_LABELS[field]}
        </label>
        <input
          id={id}
          className={styles.input}
          value={draft[field] || ""}
          onChange={(e) => updateVendorGpsrDraft({ [field]: e.target.value })}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={`${id}-hint${error ? ` ${id}-error` : ""}`}
          {...props}
        />
        <div id={`${id}-hint`} style={{ fontSize: 13, opacity: 0.85 }}>
          {GPSR_HINTS[field]}
        </div>
        {error && (
          <div id={`${id}-error`} style={{ color: "#b42318", fontSize: 13 }}>
            {error}
          </div>
        )}
      </>
    );
  };

  return (
    <div
      className={styles.tip}
      style={{ marginBottom: 12, display: "grid", gap: 4 }}
      data-testid="gpsr-vendor-form"
    >
      <strong>Date publice ale producătorului</strong>

      <p role="note" data-testid="gpsr-public-notice" style={{ margin: "4px 0 0", fontWeight: 600 }}>
        {GPSR_PUBLIC_NOTICE}
      </p>

      <p style={{ margin: "4px 0 8px" }}>
        {editing
          ? "Modificarea acestor date se va reflecta pe toate produsele pentru care ești producător."
          : "Completezi aceste date o singură dată. Le vom folosi automat pentru toate produsele la care ești producător."}
      </p>

      {input("name", "gpsr-vendor-name", { autoComplete: "organization", maxLength: 200 })}
      {input("address", "gpsr-vendor-address", {
        autoComplete: "off",
        maxLength: 500,
        placeholder: "Stradă, număr, localitate, județ",
      })}
      {input("email", "gpsr-vendor-email", {
        type: "email",
        autoComplete: "off",
        maxLength: 320,
      })}

      {gpsr.saveError && (
        <div role="alert" style={{ color: "#b42318", fontSize: 13 }}>
          {gpsr.saveError}
        </div>
      )}

      <div style={{ fontSize: 13, opacity: 0.85, marginTop: 4 }}>
        Datele se salvează împreună cu produsul.
      </div>

      {editing && (
        <button
          type="button"
          className={styles.smallBtn}
          style={{ marginTop: 6, justifySelf: "start" }}
          onClick={cancelEditingVendorGpsr}
        >
          Renunță la modificare
        </button>
      )}
    </div>
  );
}
