import { useState } from "react";
import styles from "../../../components/css/ProductModal.module.css";
import GpsrAddressHelp from "../../../../../../components/GpsrAddressHelp.jsx";
import GpsrAddressChoice from "../../../../../../components/GpsrAddressChoice.jsx";
import GpsrInfoPanel from "../../../../../../components/GpsrInfoPanel.jsx";
import { GPSR_LOCKER_ERROR, isLockerAddress } from "../../../../../../utils/gpsrAddressHelp.js";
import {
  GPSR_CHILDREN_HINT,
  GPSR_CHILDREN_QUESTION,
  GPSR_WARNINGS_HINT,
  GPSR_WARNINGS_QUESTION,
  gpsrWarningsAnswer,
} from "../../../../../../utils/gpsrNotice.js";
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
 * Ordinea: datele producătorului -> informații de siguranță -> informarea
 * GPSR (compactă). Confirmarea unică GPSR e la publicare (pasul de verificare).
 *
 * „Eu am realizat produsul”: datele publice ale producătorului vin
 * dintr-o singură sursă, la nivel de vendor (Vendor.gpsrManufacturer*,
 * utils/vendorGpsrManufacturer.js) - completate o singură dată, la primul
 * produs, și refolosite automat. NU se preiau din adresa de retur,
 * facturare sau ridicare.
 *
 * Valorile salvate nu se schimbă: isOwnManufacturer true/false/null,
 * safetyWarnings null (nerăspuns) / "" (nu sunt necesare) / text.
 *
 * `manufacturerProfile` (doar Admin) = { name, address, email, complete } -
 * datele centrale ale vendorului produsului, afișate read-only.
 */
export default function ProductGpsrSection({
  form,
  setForm,
  manufacturerProfile = null,
  // produsul editat (null la un produs nou): ajunge în cererea de ajutor GPSR
  productId = null,
}) {
  const isOwnManufacturer = form.isOwnManufacturer;
  const adminView = !!manufacturerProfile;
  // „Da” fără text încă: rămâne ales până se scrie (valoarea salvată rămâne null = nerăspuns)
  const [warningsYes, setWarningsYes] = useState(false);
  const warningsAnswer = gpsrWarningsAnswer(form.safetyWarnings, warningsYes);

  const setField = (field, value) =>
    setForm((current) => ({
      ...current,
      [field]: value,
    }));

  const externalAddress = (
    <>
      <label className={styles.label} htmlFor="gpsr-manufacturer-address">
        Adresă poștală de contact
      </label>
      <input
        id="gpsr-manufacturer-address"
        className={styles.input}
        value={form.manufacturerAddress || ""}
        placeholder="Ex: Str. Florilor 10, Cluj-Napoca, jud. Cluj"
        onChange={(e) => setField("manufacturerAddress", e.target.value)}
      />
      {isLockerAddress(form.manufacturerAddress) && (
        <div role="alert" style={{ color: "#b42318", fontSize: 13 }}>
          {GPSR_LOCKER_ERROR}
        </div>
      )}
    </>
  );

  return (
    <div id="product-gpsr" className={styles.fieldGroup}>
      <strong className={styles.orderConfigTitle}>
        Producător și siguranță
      </strong>

      <p className={styles.sectionDescription}>
        Apar public pe pagina produsului.
      </p>

      <label className={styles.label}>Cine a realizat produsul?</label>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 16px", marginBottom: 8 }}>
        <label className={styles.checkbox}>
          <input
            type="radio"
            name="isOwnManufacturer"
            checked={isOwnManufacturer === true}
            onChange={() => setField("isOwnManufacturer", true)}
          />
          {adminView ? "Vânzătorul" : "Eu"}
        </label>

        <label className={styles.checkbox}>
          <input
            type="radio"
            name="isOwnManufacturer"
            checked={isOwnManufacturer === false}
            onChange={() => setField("isOwnManufacturer", false)}
          />
          Altă persoană sau firmă
        </label>
      </div>

      {isOwnManufacturer === true &&
        (adminView ? (
          <ManufacturerSummary
            contact={manufacturerProfile.complete ? manufacturerProfile : null}
            emptyText="Vânzătorul nu a completat încă datele publice ale producătorului. Pe pagina produsului nu apare producătorul până atunci."
          />
        ) : (
          <VendorManufacturerData productId={productId} />
        ))}

      {isOwnManufacturer === false && (
        <>
          <label className={styles.label} htmlFor="gpsr-manufacturer-name">
            Nume / denumire producător
          </label>
          <input
            id="gpsr-manufacturer-name"
            className={styles.input}
            value={form.manufacturerName || ""}
            placeholder="Ex: Ceramica Exemplu SRL"
            onChange={(e) => setField("manufacturerName", e.target.value)}
          />

          {adminView ? (
            externalAddress
          ) : (
            <GpsrAddressChoice helpActions={!adminView && <GpsrAddressHelp productId={productId} />}>{externalAddress}</GpsrAddressChoice>
          )}

          <label className={styles.label} htmlFor="gpsr-manufacturer-email">
            Email de contact
          </label>
          <input
            id="gpsr-manufacturer-email"
            type="email"
            className={styles.input}
            value={form.manufacturerEmail || ""}
            placeholder="Ex: contact@exemplu.ro"
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
              <p className={styles.sectionDescription} style={{ margin: "0 0 4px" }}>
                Pentru un producător din afara UE, completează persoana responsabilă din UE.
              </p>
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
                Adresă poștală în UE
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

      <label className={styles.label}>{GPSR_WARNINGS_QUESTION}</label>

      <div style={{ display: "flex", gap: 16, marginBottom: 8 }}>
        <label className={styles.checkbox}>
          <input
            id="gpsr-safety-warnings-yes"
            type="radio"
            name="gpsrSafetyWarnings"
            checked={warningsAnswer === "yes"}
            onChange={() => {
              setWarningsYes(true);
              if (form.safetyWarnings === "") setField("safetyWarnings", null);
            }}
          />
          Da
        </label>

        <label className={styles.checkbox}>
          <input
            type="radio"
            name="gpsrSafetyWarnings"
            checked={warningsAnswer === "no"}
            onChange={() => {
              setWarningsYes(false);
              setField("safetyWarnings", "");
            }}
          />
          Nu
        </label>
      </div>

      {warningsAnswer === "yes" && (
        <>
          <textarea
            id="gpsr-safety-warnings"
            aria-label="Avertismente și instrucțiuni de siguranță"
            className={styles.textarea}
            rows={3}
            value={form.safetyWarnings ?? ""}
            onChange={(e) => setField("safetyWarnings", e.target.value || null)}
            placeholder="Ex: A nu se lăsa la îndemâna copiilor sub 3 ani, conține piese mici."
          />
          <div style={{ fontSize: 13, opacity: 0.85, marginBottom: 8 }}>{GPSR_WARNINGS_HINT}</div>
        </>
      )}

      <label className={styles.label}>{GPSR_CHILDREN_QUESTION}</label>

      <div style={{ display: "flex", gap: 16 }}>
        <label className={styles.checkbox}>
          <input
            id="gpsr-children-yes"
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
      {form.isForChildren === true && (
        <div style={{ fontSize: 13, opacity: 0.85, marginTop: 4 }}>{GPSR_CHILDREN_HINT}</div>
      )}

      {/* informarea GPSR pentru vânzător (Adminul vede deja datele) */}
      {!adminView && (
        <div style={{ marginTop: 12 }}>
          <GpsrInfoPanel />
        </div>
      )}
    </div>
  );
}

/* ---------- datele publice ale vendorului-producător ---------- */

// aceleași denumiri în formular, rezumat (vendor) și Admin
const GPSR_LABELS = {
  name: "Nume / denumire",
  address: "Adresă poștală de contact",
  email: "Email de contact",
};

const GPSR_PLACEHOLDERS = {
  name: "Ex: Atelier Mara",
  address: "Ex: Str. Florilor 10, Cluj-Napoca, jud. Cluj",
  email: "Ex: contact@ateliermara.ro",
};

function ManufacturerSummary({ contact, emptyText, action = null }) {
  return (
    <div className={styles.tip} style={{ marginBottom: 12 }} data-testid="gpsr-vendor-summary">
      <strong>Datele producătorului (publice)</strong>

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

      {action}
    </div>
  );
}

// eroarea unui câmp se arată doar după ce vendorul a scris ceva în el
function fieldError(field, value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (field === "address" && isLockerAddress(text)) return GPSR_LOCKER_ERROR;
  if (field === "address" && !isValidGpsrAddress(text)) return GPSR_ADDRESS_HINT;
  if (field === "email" && !isValidGpsrEmail(text)) return "Emailul nu este valid. Exemplu: contact@ateliermara.ro";
  return "";
}

function VendorManufacturerData({ productId = null }) {
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

  // date complete salvate: se refolosesc, fără reintroducere
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
          placeholder={GPSR_PLACEHOLDERS[field]}
          onChange={(e) => updateVendorGpsrDraft({ [field]: e.target.value })}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          {...props}
        />
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
      <strong>Datele tale de producător</strong>

      <p style={{ margin: "2px 0 6px" }}>
        {editing
          ? "Modificarea se aplică tuturor produselor la care ești producător și se salvează împreună cu produsul."
          : "Le completezi o singură dată și le refolosim automat la celelalte produse. Se salvează împreună cu produsul."}
      </p>

      {input("name", "gpsr-vendor-name", { autoComplete: "organization", maxLength: 200 })}
      <GpsrAddressChoice helpActions={<GpsrAddressHelp productId={productId} />}>
        {input("address", "gpsr-vendor-address", {
          autoComplete: "off",
          maxLength: 500,
        })}
      </GpsrAddressChoice>
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
