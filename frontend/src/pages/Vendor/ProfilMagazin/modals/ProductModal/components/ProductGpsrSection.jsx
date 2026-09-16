import styles from "../../../components/css/ProductModal.module.css";

/*
 * Secțiune GPSR (Regulamentul UE 2023/988) - "Producător și
 * siguranță". Regulă de bază, aplicată peste tot unde e folosită
 * această secțiune: NU inventăm și NU completăm automat nimic aici -
 * inclusiv atunci când e deschisă dintr-un flux AI, vendorul trebuie
 * să confirme explicit fiecare răspuns.
 *
 * `vendorPreview` = { displayName, address, email } - profilul PUBLIC
 * al magazinului (NICIODATĂ date din VendorBilling/fiscal) - afișat
 * read-only când vendorul confirmă că el este producătorul.
 */
export default function ProductGpsrSection({
  form,
  setForm,
  vendorPreview,
}) {
  const isOwnManufacturer = form.isOwnManufacturer;

  const setField = (field, value) =>
    setForm((current) => ({
      ...current,
      [field]: value,
    }));

  return (
    <div className={styles.fieldGroup}>
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

      {isOwnManufacturer === true && (
        <div
          className={styles.tip}
          style={{ marginBottom: 12 }}
        >
          <strong>
            Aceste date vor fi afișate public pe pagina produsului,
            conform cerințelor privind siguranța produselor.
          </strong>

          <div style={{ marginTop: 6 }}>
            {vendorPreview?.displayName || vendorPreview?.address || vendorPreview?.email ? (
              <>
                <div>Nume: {vendorPreview?.displayName || "—"}</div>
                <div>Adresă: {vendorPreview?.address || "—"}</div>
                <div>Email: {vendorPreview?.email || "—"}</div>
              </>
            ) : (
              <div>Se vor folosi numele, adresa și emailul din profilul magazinului tău.</div>
            )}
          </div>

          {(!vendorPreview?.address || !vendorPreview?.email) && (
            <div style={{ marginTop: 6, opacity: 0.85 }}>
              Adresa și/sau emailul lipsesc din profilul magazinului tău.
              Completează-le în secțiunea „Informații magazin" din profil
              pentru ca pagina produsului să le poată afișa.
            </div>
          )}
        </div>
      )}

      {isOwnManufacturer === false && (
        <>
          <label className={styles.label} htmlFor="gpsr-manufacturer-name">
            Nume producător
          </label>
          <input
            id="gpsr-manufacturer-name"
            className={styles.input}
            value={form.manufacturerName || ""}
            onChange={(e) => setField("manufacturerName", e.target.value)}
          />

          <label className={styles.label} htmlFor="gpsr-manufacturer-address">
            Adresă producător
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
