import { useId, useState } from "react";
import { AlertTriangle, ChevronDown, KeyRound, Link2, Loader2, ShieldCheck } from "lucide-react";

import styles from "./WooCommerceImport.module.css";
import { errorMessage } from "./wooImportLogic.js";
import { wooApi } from "./wooApi.js";

function validate({ shopUrl, consumerKey, consumerSecret }) {
  const errors = {};
  const url = shopUrl.trim();
  if (!url) errors.shopUrl = "Introdu adresa magazinului.";
  else if (!/^https:\/\//i.test(url)) errors.shopUrl = "Adresa trebuie să înceapă cu https://";
  else {
    try {
      new URL(url);
    } catch {
      errors.shopUrl = "Adresa nu este validă. Exemplu: https://magazinul-meu.ro";
    }
  }
  if (!/^ck_[A-Za-z0-9_]{6,}$/.test(consumerKey.trim())) errors.consumerKey = "Consumer Key începe cu ck_ și nu conține spații.";
  if (!/^cs_[A-Za-z0-9_]{6,}$/.test(consumerSecret.trim())) errors.consumerSecret = "Consumer Secret începe cu cs_ și nu conține spații.";
  return errors;
}

export default function WooConnectForm({ onConnected }) {
  const id = useId();
  const [form, setForm] = useState({ shopUrl: "", consumerKey: "", consumerSecret: "", label: "" });
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);

  const set = (key) => (event) => {
    setForm((prev) => ({ ...prev, [key]: event.target.value }));
    setFieldErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    const errors = validate(form);
    setFieldErrors(errors);
    if (Object.keys(errors).length) {
      document.getElementById(`${id}-${Object.keys(errors)[0]}`)?.focus();
      return;
    }

    setSubmitting(true);
    try {
      const data = await wooApi.connect({
        platform: "WOOCOMMERCE",
        shopUrl: form.shopUrl.trim(),
        consumerKey: form.consumerKey.trim(),
        consumerSecret: form.consumerSecret.trim(),
        label: form.label.trim() || undefined,
      });
      // cheile nu rămân în memoria formularului după conectare
      setForm({ shopUrl: "", consumerKey: "", consumerSecret: "", label: "" });
      onConnected(data.connection, data.warnings || []);
    } catch (err) {
      setError(errorMessage(err.code, err.message));
    } finally {
      setSubmitting(false);
    }
  }

  const field = (key, label, props = {}, hint = null) => (
    <div className={styles.field}>
      <label htmlFor={`${id}-${key}`}>{label}</label>
      <input
        id={`${id}-${key}`}
        className={`${styles.input} ${fieldErrors[key] ? styles.inputInvalid : ""}`}
        value={form[key]}
        onChange={set(key)}
        aria-invalid={Boolean(fieldErrors[key])}
        aria-describedby={fieldErrors[key] ? `${id}-${key}-err` : hint ? `${id}-${key}-hint` : undefined}
        disabled={submitting}
        {...props}
      />
      {fieldErrors[key] ? (
        <span id={`${id}-${key}-err`} className={styles.fieldError} role="alert">
          {fieldErrors[key]}
        </span>
      ) : hint ? (
        <span id={`${id}-${key}-hint`} className={styles.fieldHint}>
          {hint}
        </span>
      ) : null}
    </div>
  );

  return (
    <section className={styles.panel} aria-labelledby={`${id}-title`}>
      <div className={styles.panelHead}>
        <span className={styles.panelIcon}>
          <Link2 size={20} />
        </span>
        <div>
          <h3 id={`${id}-title`}>Conectează magazinul WooCommerce</h3>
          <p>Artfest citește produsele din magazinul tău. Nimic nu se publică fără confirmarea ta.</p>
        </div>
      </div>

      <div className={styles.helpBox}>
        <button
          type="button"
          className={styles.helpToggle}
          aria-expanded={helpOpen}
          aria-controls={`${id}-help`}
          onClick={() => setHelpOpen((v) => !v)}
        >
          <KeyRound size={17} />
          <span>Unde găsesc cheile API?</span>
          <ChevronDown size={17} className={helpOpen ? styles.chevronOpen : ""} />
        </button>
        {helpOpen && (
          <ol id={`${id}-help`} className={styles.helpSteps}>
            <li>
              Intră în panoul de administrare WordPress al magazinului (de obicei <code>magazinul-tau.ro/wp-admin</code>).
            </li>
            <li>
              Mergi la <strong>WooCommerce → Setări → Avansat → REST API</strong>.
            </li>
            <li>
              Apasă <strong>Adaugă cheie</strong>. La descriere scrie „Artfest”, alege utilizatorul tău de administrator și, la
              permisiuni, <strong>Citire/Scriere</strong> (Read/Write) - scrierea va fi folosită pentru stoc, când pornim
              sincronizarea.
            </li>
            <li>
              Apasă <strong>Generează cheia API</strong> și copiază imediat <strong>Consumer key</strong> (începe cu{" "}
              <code>ck_</code>) și <strong>Consumer secret</strong> (începe cu <code>cs_</code>). WooCommerce le arată o
              singură dată.
            </li>
            <li>
              Dacă primești eroare de adresă: în WordPress, la <strong>Setări → Legături permanente</strong>, alege orice
              opțiune în afară de „Simplu”.
            </li>
          </ol>
        )}
      </div>

      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        {field(
          "shopUrl",
          "Adresa magazinului",
          { type: "url", inputMode: "url", autoComplete: "url", placeholder: "https://magazinul-meu.ro" },
          "Adresa site-ului, cu https://"
        )}
        <div className={styles.fieldRow}>
          {field("consumerKey", "Consumer Key", {
            type: "text",
            autoComplete: "off",
            spellCheck: false,
            autoCapitalize: "off",
            placeholder: "ck_…",
          })}
          {field("consumerSecret", "Consumer Secret", {
            type: "password",
            autoComplete: "new-password",
            spellCheck: false,
            autoCapitalize: "off",
            placeholder: "cs_…",
          })}
        </div>
        {field("label", "Nume intern (opțional)", { type: "text", maxLength: 120, placeholder: "ex. Magazinul principal" })}

        <p className={styles.secureNote}>
          <ShieldCheck size={16} />
          Cheile se păstrează criptat și nu mai sunt afișate după conectare.
        </p>

        {error && (
          <div className={styles.alertError} role="alert">
            <AlertTriangle size={18} />
            <div>
              <strong>Conectarea nu a reușit</strong>
              <p>{error}</p>
            </div>
          </div>
        )}

        <div className={styles.actions}>
          <button type="submit" className={styles.primaryBtn} disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 size={16} className={styles.spin} /> Verificăm conexiunea…
              </>
            ) : (
              "Verifică și conectează"
            )}
          </button>
        </div>
      </form>
    </section>
  );
}
