import { useState } from "react";

import styles from "../../../components/css/ProductModal.module.css";
import TagComboField from "./TagComboField";
import SingleTagComboField from "./SingleTagComboField";

export default function ProductDetailsSection({
  form,
  setForm,
  updateField,
  materialOptions,
  techniqueOptions,
  styleOptions,
  occasionOptions,
  careOptions,
  colorOptions,
  categoryProps,
}) {
  const [
    detailsHelpOpen,
    setDetailsHelpOpen,
  ] = useState(false);

  return (
    <>
      {detailsHelpOpen && (
        <div className={styles.helpOverlay}>
          <div className={styles.helpModal}>
            <button
              type="button"
              className={styles.helpModalClose}
              onClick={() =>
                setDetailsHelpOpen(false)
              }
              aria-label="Închide ajutorul"
            >
              ×
            </button>

            <h3>
              Cum completezi detaliile produsului?
            </h3>

            <p>
              Completează informațiile cât mai
              clar pentru ca produsul să fie ușor
              de înțeles și de găsit de către
              clienți.
            </p>

            <div className={styles.helpSteps}>
              <div>
                <strong>
                  📝 Informații principale
                </strong>

                <p>
                  Adaugă un titlu clar, alege
                  categoria potrivită și descrie
                  produsul cât mai complet.
                </p>
              </div>

              <div>
                <strong>
                  ✨ Informații completate cu AI
                </strong>

                <p>
                  Dacă ai folosit „Analizează
                  produsul cu AI” în pasul
                  anterior, unele informații pot
                  fi deja completate automat.
                </p>

                <p>
                  Verifică titlul, descrierea,
                  materialul, tehnica, culoarea și
                  celelalte informații înainte de
                  publicare.
                </p>
              </div>

              <div>
                <strong>
                  🧵 Caracteristicile produsului
                </strong>

                <p>
                  Completează materialul principal,
                  tehnica folosită, culoarea și
                  stilul produsului.
                </p>

                <p>
                  Aceste informații îi ajută pe
                  clienți să înțeleagă mai bine
                  produsul și pot fi utile pentru
                  filtrare și căutare.
                </p>
              </div>

              <div>
                <strong>
                  📏 Informații suplimentare
                </strong>

                <p>
                  Adaugă dimensiunile, ocaziile
                  potrivite, instrucțiunile de
                  îngrijire și orice note speciale
                  importante pentru client.
                </p>
              </div>
            </div>

            <div className={styles.tip}>
              <strong>
                Important:
              </strong>{" "}
              AI-ul este un ajutor. Verifică și
              modifică informațiile generate dacă
              este necesar.
            </div>

            <div
              className={
                styles.helpModalActions
              }
            >
              <button
                type="button"
                className={styles.primaryBtn}
                onClick={() =>
                  setDetailsHelpOpen(false)
                }
              >
                Am înțeles
              </button>
            </div>
          </div>
        </div>
      )}

      <div className={styles.sectionHeader}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <h4
            className={
              styles.sectionTitle
            }
          >
            Detaliile produsului
          </h4>

          <button
            type="button"
            className={
              styles.helpButton
            }
            onClick={() =>
              setDetailsHelpOpen(true)
            }
            aria-label="Ajutor detalii produs"
            title="Cum completez detaliile?"
          >
            ?
          </button>
        </div>

        <p
          className={
            styles.sectionDescription
          }
        >
          Completează informațiile despre
          produs. Dacă ai folosit analiza AI
          în pasul anterior, verifică și
          ajustează informațiile completate
          automat.
        </p>
      </div>

      {/* =========================
          INFORMAȚII PRINCIPALE
      ========================== */}

      <div className={styles.fieldGroup}>
        <strong
          className={
            styles.orderConfigTitle
          }
        >
          Informații principale
        </strong>

        <label
          className={styles.label}
          htmlFor="product-title"
        >
          Titlu
        </label>

        <input
          id="product-title"
          className={styles.input}
          value={form.title}
          onChange={updateField("title")}
          placeholder="Ex: Coroniță florală din lavandă"
          required
        />

        {categoryProps && (
          <>
            <label
              className={styles.label}
              htmlFor="category-combobox-input"
            >
              Categorie
            </label>

            <select
              id="category-combobox-input"
              className={styles.input}
              value={
                form.category || ""
              }
              onChange={(e) =>
                setForm((s) => ({
                  ...s,
                  category:
                    e.target.value,
                }))
              }
              required
            >
              <option value="">
                Alege categorie
              </option>

              {categoryProps.options.map(
                (o) => (
                  <option
                    key={o.key}
                    value={o.key}
                  >
                    {o.label}
                  </option>
                )
              )}
            </select>
          </>
        )}

        <label
          className={styles.label}
          htmlFor="product-description"
        >
          Descriere
        </label>

        <textarea
          id="product-description"
          className={styles.textarea}
          value={form.description}
          onChange={updateField(
            "description"
          )}
          placeholder="Detalii despre material, dimensiuni, personalizare etc."
          rows={5}
        />
      </div>

      {/* =========================
          CARACTERISTICI
      ========================== */}

      <div className={styles.fieldGroup}>
        <strong
          className={
            styles.orderConfigTitle
          }
        >
          Caracteristicile produsului
        </strong>

        <SingleTagComboField
          id="product-material"
          label="Material principal"
          value={
            form.materialMain || ""
          }
          onChange={(val) =>
            setForm((s) => ({
              ...s,
              materialMain: val,
            }))
          }
          options={materialOptions}
          placeholder="ex: lemn de pin, ceramică, bumbac organic"
          note="Poți alege un material din sugestii sau poți scrie exact materialul folosit."
        />

        <SingleTagComboField
          id="product-technique"
          label="Tehnică / cum este lucrat"
          value={
            form.technique || ""
          }
          onChange={(val) =>
            setForm((s) => ({
              ...s,
              technique: val,
            }))
          }
          options={techniqueOptions}
          placeholder="ex: pictat manual, croșetat, turnat în matriță"
          note="Poți selecta o tehnică din sugestii sau poți descrie liber metoda ta."
        />

        <SingleTagComboField
          id="product-color"
          label="Culoare principală"
          value={
            form.color || ""
          }
          onChange={(val) =>
            setForm((s) => ({
              ...s,
              color: val,
            }))
          }
          options={colorOptions}
          useOptionKeyAsValue={true}
          placeholder="ex: alb, verde salvie, roz pudră"
          note="Poți alege o culoare din sugestii sau poți scrie exact nuanța."
        />

        <TagComboField
          id="product-style-tags"
          label="Stil"
          value={
            form.styleTags || ""
          }
          onChange={(val) =>
            setForm((s) => ({
              ...s,
              styleTags: val,
            }))
          }
          options={styleOptions}
          placeholder="ex: rustic, boho, minimalist"
        />
      </div>

      {/* =========================
          INFORMAȚII SUPLIMENTARE
      ========================== */}

      <div className={styles.fieldGroup}>
        <strong
          className={
            styles.orderConfigTitle
          }
        >
          Informații suplimentare
        </strong>

        <TagComboField
          id="product-occasion-tags"
          label="Ocazii"
          value={
            form.occasionTags || ""
          }
          onChange={(val) =>
            setForm((s) => ({
              ...s,
              occasionTags: val,
            }))
          }
          options={occasionOptions}
          placeholder="ex: cadou casă nouă, zi de naștere"
        />

        <label
          className={styles.label}
          htmlFor="product-dimensions"
        >
          Dimensiuni
        </label>

        <input
          id="product-dimensions"
          className={styles.input}
          value={
            form.dimensions || ""
          }
          onChange={updateField(
            "dimensions"
          )}
          placeholder="ex: 20 x 30 cm"
        />

        <TagComboField
          id="product-care-instructions"
          label="Instrucțiuni de îngrijire"
          value={
            form.careInstructions ||
            ""
          }
          onChange={(val) =>
            setForm((s) => ({
              ...s,
              careInstructions:
                val,
            }))
          }
          options={careOptions}
          placeholder="ex: șterge ușor cu o cârpă umedă"
        />

        <label
          className={styles.label}
          htmlFor="product-notes"
        >
          Note speciale
        </label>

        <textarea
          id="product-notes"
          className={styles.textarea}
          value={
            form.specialNotes || ""
          }
          onChange={updateField(
            "specialNotes"
          )}
          rows={3}
          placeholder="ex: fiecare piesă este unică, pot apărea mici variații față de fotografie"
        />
      </div>
    </>
  );
}