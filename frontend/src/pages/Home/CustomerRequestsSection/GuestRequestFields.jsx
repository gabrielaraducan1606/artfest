// Câmpurile pentru vizitatorul fără cont din formularul de cerere
// (CreateCustomerRequestModal, guestMode) + panoul „Verifică emailul”.
// Fără parolă, fără popup-uri obligatorii: întrebarea despre cont e
// opțională, iar „Ai deja cont?” păstrează datele completate.

import React from "react";

import modalStyles from "./CreateCustomerRequestModal.module.css";
import styles from "./GuestRequestFields.module.css";
import { GUEST_CONSENT_TEXT } from "./guestRequestUtils.js";

export function GuestRequestFields({ guest, onChange, onLoginRequest, disabled = false, fieldError = "" }) {
  const set = (field) => (event) =>
    onChange({ ...guest, [field]: event.target.type === "checkbox" ? event.target.checked : event.target.value });

  return (
    <fieldset className={styles.box} disabled={disabled}>
      <legend className={styles.legend}>Cum te contactăm</legend>

      <button type="button" className={styles.loginLink} onClick={onLoginRequest}>
        Ai deja cont? <strong>Autentifică-te</strong>
      </button>

      <div className={styles.grid}>
        <div className={modalStyles.field}>
          <label className={modalStyles.label} htmlFor="guest-request-name">
            Prenume sau nume de utilizator
          </label>
          <input
            id="guest-request-name"
            className={`${modalStyles.input} ${styles.input} ${fieldError === "displayName" ? styles.invalid : ""}`}
            type="text"
            autoComplete="given-name"
            maxLength={40}
            value={guest.displayName}
            onChange={set("displayName")}
            placeholder="Ex: Ana"
          />
          <p className={modalStyles.fieldHelp}>Apare public lângă cerere.</p>
        </div>

        <div className={modalStyles.field}>
          <label className={modalStyles.label} htmlFor="guest-request-email">
            Email
          </label>
          <input
            id="guest-request-email"
            className={`${modalStyles.input} ${styles.input} ${fieldError === "email" ? styles.invalid : ""}`}
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="off"
            spellCheck={false}
            maxLength={254}
            value={guest.email}
            onChange={set("email")}
            placeholder="nume@exemplu.ro"
          />
          <p className={modalStyles.fieldHelp}>Nu se afișează public. Aici primești linkul de confirmare și ofertele.</p>
        </div>
      </div>

      {/* câmp-capcană pentru roboți: ascuns pentru oameni și cititoare de ecran */}
      <div className={styles.trap} aria-hidden="true">
        <label htmlFor="guest-request-website">Website</label>
        <input
          id="guest-request-website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={guest.website}
          onChange={set("website")}
        />
      </div>

      <div className={styles.account} role="group" aria-labelledby="guest-request-account-q">
        <p id="guest-request-account-q" className={styles.accountQuestion}>
          Vrei să îți creezi un cont Artfest pentru a urmări mai ușor ofertele primite?
        </p>
        <div className={styles.choices}>
          <button
            type="button"
            className={`${styles.choice} ${guest.wantsAccount === true ? styles.choiceActive : ""}`}
            aria-pressed={guest.wantsAccount === true}
            onClick={() => onChange({ ...guest, wantsAccount: true })}
          >
            Da, creez cont
          </button>
          <button
            type="button"
            className={`${styles.choice} ${guest.wantsAccount === false ? styles.choiceActive : ""}`}
            aria-pressed={guest.wantsAccount === false}
            onClick={() => onChange({ ...guest, wantsAccount: false })}
          >
            Nu acum
          </button>
        </div>
        {guest.wantsAccount === true && (
          <p className={styles.accountHint}>
            După ce confirmi emailul, îți creezi contul într-un pas (alegi doar parola). Cererea rămâne a ta.
          </p>
        )}
      </div>

      <label className={`${styles.consent} ${fieldError === "consent" ? styles.consentInvalid : ""}`}>
        <input type="checkbox" checked={guest.consent === true} onChange={set("consent")} />
        <span>
          {GUEST_CONSENT_TEXT}{" "}
          <a href="/confidentialitate" target="_blank" rel="noopener noreferrer">
            Politica de confidențialitate
          </a>
          .
        </span>
      </label>
    </fieldset>
  );
}

export function GuestRequestSentPanel({ email, wantsAccount, onClose }) {
  return (
    <div className={styles.sent} role="status" aria-live="polite">
      <div className={styles.sentIcon} aria-hidden="true">
        ✉️
      </div>
      <h3 className={styles.sentTitle}>Verifică-ți emailul</h3>
      <p className={styles.sentText}>
        Ți-am trimis un link{email ? <> la <strong>{email}</strong></> : null}. Deschide-l ca să publicăm cererea. Până
        atunci, cererea nu este vizibilă și nu ajunge la artizani.
      </p>
      <ul className={styles.sentList}>
        <li>Linkul este valabil 48 de ore.</li>
        <li>Nu găsești emailul? Verifică dosarele Spam și Promoții.</li>
        {wantsAccount ? <li>După confirmare îți poți crea contul alegând doar o parolă.</li> : null}
        <li>Fotografiile le poți adăuga după confirmare, din pagina cererii.</li>
      </ul>
      <button type="button" className={modalStyles.primaryButton} onClick={onClose}>
        Am înțeles
      </button>
    </div>
  );
}
