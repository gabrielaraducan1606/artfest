// src/components/AIAssistant/Vendor/components/VendorProductWizard.jsx

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import ProductVideoField from "../../../../components/ProductVideoField";

import ProductModalWizard from "../../../../pages/Vendor/ProfilMagazin/modals/ProductModal/ProductModalWizard";
import { useProductEditorController } from "../../../../pages/Vendor/ProfilMagazin/modals/useProductEditorController.js";
import EditModal from "../../../../pages/Vendor/ProfilMagazin/ui/Modal";

import styles from "./VendorProductWizard.module.css";
import editStyles from "./VendorProductEditWizard.module.css";

const EMPTY_DRAFT = {
  images: [],
  videoUrl: null,
  videoMuted: false,

  title: "",
  description: "",
  category: "",

  price: "",
  currency: "RON",

  materialMain: "",
  technique: "",
  color: "",

  availability: "",
  readyQty: "",
  leadTimeDays: "",
  nextShipDate: "",

  orderMode:
    "READY_TO_BUY",

  optionsSchema: [],
  customSchema: [],
  repeatedGroups: [],
  quoteSchema: [],

  orderInstructions: "",

  aiAnalysis: null,
  aiQuestions: [],
  aiOrderMessage: "",
  aiOrderReason: "",
  aiOrderConfidence: null,
};

function mergeDraft(
  draft
) {
  return {
    ...EMPTY_DRAFT,
    ...(draft || {}),

    images:
      Array.isArray(
        draft?.images
      )
        ? draft.images
        : [],

    optionsSchema:
      Array.isArray(
        draft?.optionsSchema
      )
        ? draft.optionsSchema
        : [],

    customSchema:
      Array.isArray(
        draft?.customSchema
      )
        ? draft.customSchema
        : [],

    repeatedGroups:
      Array.isArray(
        draft?.repeatedGroups
      )
        ? draft.repeatedGroups
        : [],

    quoteSchema:
      Array.isArray(
        draft?.quoteSchema
      )
        ? draft.quoteSchema
        : [],

    aiQuestions:
      Array.isArray(
        draft?.aiQuestions
      )
        ? draft.aiQuestions
        : [],
  };
}

function getImageUrl(
  image
) {
  if (
    typeof image ===
    "string"
  ) {
    return image;
  }

  return (
    image?.previewUrl ||
    image?.url ||
    image?.src ||
    image?.imageUrl ||
    ""
  );
}

function getOrderModeLabel(
  orderMode
) {
  switch (
    orderMode
  ) {
    case "OPTIONS":
      return "Clientul alege opțiuni sau completează personalizarea";

    case "QUOTE_ONLY":
      return "Clientul trimite o cerere de ofertă";

    default:
      return "Clientul cumpără produsul direct";
  }
}

function getOrderModeDescription(
  orderMode
) {
  switch (
    orderMode
  ) {
    case "OPTIONS":
      return "Produsul poate avea mărimi, culori, materiale, texte personalizate sau alte alegeri.";

    case "QUOTE_ONLY":
      return "Prețul și configurația finală sunt stabilite după discutarea cerințelor cu clientul.";

    default:
      return "Produsul nu necesită alegeri suplimentare înainte de adăugarea în coș.";
  }
}

function getAvailabilityLabel(
  availability
) {
  switch (
    availability
  ) {
    case "READY":
      return "Gata de livrare";

    case "MADE_TO_ORDER":
      return "Realizat la comandă";

    case "PREORDER":
      return "Precomandă";

    case "SOLD_OUT":
      return "Indisponibil";

    default:
      return "Nu a fost stabilită";
  }
}

/*
 * Checklist proactiv (audit, cerința #14) - NU dezactivează butonul
 * de salvare fără explicație, doar arată ce lipsește ÎNAINTE ca
 * vendorul să apese "Salvează produsul" - validarea reactivă din
 * handlePublishProductFromWizard (VendorAssistant.jsx) rămâne
 * neatinsă, ca ultimă plasă de siguranță.
 */
export function getMissingFields(
  safeDraft,
  images
) {
  const missing = [];

  if (
    !String(
      safeDraft.title || ""
    ).trim()
  ) {
    missing.push("titlu");
  }

  if (!images.length) {
    missing.push("cel puțin o fotografie");
  }

  /*
   * BUGFIX (audit) - QUOTE_ONLY cere acum preț orientativ > 0, la fel
   * ca celelalte moduri (nu doar "necompletat" - un 0 introdus
   * explicit tot trebuie semnalat, exact ca la READY_TO_BUY/OPTIONS).
   */
  const priceNum = Number(
    safeDraft.price ?? ""
  );

  if (
    !Number.isFinite(priceNum) ||
    priceNum <= 0
  ) {
    missing.push("preț");
  }

  if (!safeDraft.availability) {
    missing.push("disponibilitate");
  }

  if (
    safeDraft.availability ===
      "MADE_TO_ORDER" &&
    !String(
      safeDraft.leadTimeDays ?? ""
    ).trim()
  ) {
    missing.push("timp de realizare");
  }

  return missing;
}

function getFieldTypeLabel(
  type
) {
  switch (
    type
  ) {
    case "select":
      return "Alegere";

    case "textarea":
      return "Text mai lung";

    case "date":
      return "Dată";

    case "file":
      return "Fotografie sau fișier";

    default:
      return "Text";
  }
}

function SchemaFields({
  title,
  fields,
}) {
  if (
    !Array.isArray(
      fields
    ) ||
    !fields.length
  ) {
    return null;
  }

  return (
    <div
      className={
        styles.cardSpaced
      }
    >
      <strong
        className={
          styles.schemaFieldsTitle
        }
      >
        {title}
      </strong>

      <div
        className={
          styles.schemaFieldsGrid
        }
      >
        {fields.map(
          (
            field,
            index
          ) => (
            <div
              key={
                field?.key ||
                field?.id ||
                `field-${index}`
              }
              className={
                styles.schemaField
              }
            >
              <div
                className={
                  styles.schemaFieldHeader
                }
              >
                <strong>
                  {field?.label ||
                    "Câmp"}
                </strong>

                <small
                  className={
                    styles.schemaFieldType
                  }
                >
                  {getFieldTypeLabel(
                    field?.type
                  )}
                </small>
              </div>

              <small
                className={
                  styles.schemaFieldMeta
                }
              >
                {field?.required
                  ? "Obligatoriu"
                  : "Opțional"}
              </small>

              {Array.isArray(
                field?.options
              ) &&
                field.options.length >
                  0 && (
                  <small
                    className={
                      styles.schemaFieldMeta
                    }
                  >
                    Variante:{" "}
                    {field.options.join(
                      ", "
                    )}
                  </small>
                )}
            </div>
          )
        )}
      </div>
    </div>
  );
}

function VendorProductCreateWizard({
  draft,
  setDraft,

  step = "images",
  setStep,

  onUpload,
  onAnalyze,
  onAnalyzeOrder,

  onBack,
  onClose,

  analyzing = false,
  analyzingOrder = false,

  /*
   * Publicare reală a produsului - opțional. Dacă lipsește,
   * comportamentul vechi (fără publicare) rămâne identic, doar
   * fără buton funcțional (evită o eroare dacă vreodată acest
   * wizard e montat fără apelantul care știe să publice).
   */
  onPublish,
  publishing = false,
  publishError = "",
  publishSuccess = null,
}) {
  const safeDraft =
    useMemo(
      () =>
        mergeDraft(
          draft
        ),
      [draft]
    );

  const images =
    safeDraft.images;

  const canAnalyze =
    images.length > 0 &&
    !analyzing;

  const canAnalyzeOrder =
    String(
      safeDraft
        .orderInstructions ||
        ""
    ).trim().length >
      2 &&
    !analyzingOrder;

  const missingFields =
    useMemo(
      () =>
        getMissingFields(
          safeDraft,
          images
        ),
      [safeDraft, images]
    );

  /*
   * Confirmare explicită înainte de publicare (audit, cerința #15) -
   * "Salvează produsul" nu mai declanșează direct salvarea, cere
   * întâi confirmare într-un card, nu într-un window.confirm() brut.
   * Resetăm starea de confirmare dacă vendorul schimbă pasul (ex.
   * "Modifică informațiile"), ca la revenirea la rezumat să nu vadă
   * cardul de confirmare rămas deschis dintr-o încercare anterioară.
   */
  const [
    confirmingPublish,
    setConfirmingPublish,
  ] = useState(false);

  useEffect(() => {
    setConfirmingPublish(false);
  }, [step]);

  function updateDraft(
    patch
  ) {
    setDraft?.(
      (current) => ({
        ...mergeDraft(
          current
        ),

        ...patch,
      })
    );
  }

  function goToStep(
    nextStep
  ) {
    setStep?.(
      nextStep
    );
  }

  return (
    <section
      className={
        styles.wrapper
      }
    >
      <header
        className={
          styles.header
        }
      >
        <button
          type="button"
          className={
            styles.headerButton
          }
          onClick={
            onBack
          }
        >
          ← Înapoi
        </button>

        <strong
          className={
            styles.headerTitle
          }
        >
          Adaugă produs
        </strong>

        <button
          type="button"
          className={
            styles.headerButton
          }
          onClick={
            onClose
          }
          aria-label="Închide"
        >
          ✕
        </button>
      </header>

      <div
        className={
          styles.content
        }
      >
        {step ===
          "images" && (
          <>
            <div
              className={
                styles.progress
              }
            >
              Pasul 1 din 6
            </div>

            <h3
              className={
                styles.title
              }
            >
              Încarcă fotografiile produsului
            </h3>

            <p
              className={
                styles.text
              }
            >
              Adaugă una sau mai multe fotografii clare. AI-ul va pregăti informațiile de bază ale produsului.
            </p>

            {images.length >
              0 && (
              <div
                className={
                  styles.imageGrid
                }
              >
                {images.map(
                  (
                    image,
                    index
                  ) => {
                    const imageUrl =
                      getImageUrl(
                        image
                      );

                    if (
                      !imageUrl
                    ) {
                      return null;
                    }

                    return (
                      <div
                        key={
                          image?.id ||
                          `${imageUrl}-${index}`
                        }
                        className={
                          styles.imageThumb
                        }
                      >
                        <img
                          src={
                            imageUrl
                          }
                          alt={`Fotografie produs ${
                            index +
                            1
                          }`}
                        />
                      </div>
                    );
                  }
                )}
              </div>
            )}

            <div
              className={
                styles.buttonGroup
              }
            >
              <button
                type="button"
                className={
                  styles.primaryButton
                }
                onClick={
                  onUpload
                }
              >
                + Adaugă fotografii
              </button>

              {images.length >
                0 && (
                <button
                  type="button"
                  className={
                    styles.secondaryButton
                  }
                  disabled={
                    !canAnalyze
                  }
                  onClick={
                    onAnalyze
                  }
                >
                  {analyzing
                    ? "Analizez produsul..."
                    : "Analizează cu AI"}
                </button>
              )}
            </div>

            <button
              type="button"
              className={
                styles.secondaryButton
              }
              style={{
                marginTop: 8,
              }}
              onClick={() =>
                goToStep(
                  "details"
                )
              }
            >
              Nu am poze acum, continui fără AI
            </button>

            <small
              className={
                styles.hint
              }
            >
              Poți completa titlul,
              descrierea și restul
              informațiilor manual, la
              pasul următor.
            </small>

            <div style={{ marginTop: 16 }}>
              <ProductVideoField
                videoUrl={
                  safeDraft.videoUrl ||
                  null
                }
                videoMuted={
                  !!safeDraft.videoMuted
                }
                onChange={(url) =>
                  updateDraft({
                    videoUrl: url,
                  })
                }
                onMutedChange={(muted) =>
                  updateDraft({
                    videoMuted: muted,
                  })
                }
              />
            </div>
          </>
        )}

        {step ===
          "analysis" && (
          <>
            <div
              className={
                styles.progress
              }
            >
              Pasul 2 din 6
            </div>

            <h3
              className={
                styles.title
              }
            >
              AI-ul pregătește produsul
            </h3>

            <p
              className={
                styles.text
              }
            >
              Analizăm fotografiile și identificăm informațiile care pot fi completate automat.
            </p>

            <div
              className={
                styles.card
              }
            >
              <strong>
                Se analizează:
              </strong>

              <ul
                className={
                  styles.infoList
                }
              >
                <li>
                  tipul produsului;
                </li>

                <li>
                  titlul și descrierea;
                </li>

                <li>
                  categoria și materialele;
                </li>

                <li>
                  culorile și stilul;
                </li>

                <li>
                  modul probabil de comandă.
                </li>
              </ul>
            </div>
          </>
        )}

        {step ===
          "details" && (
          <>
            <div
              className={
                styles.progress
              }
            >
              Pasul 3 din 6
            </div>

            <h3
              className={
                styles.title
              }
            >
              Verifică informațiile propuse
            </h3>

            <p
              className={
                styles.text
              }
            >
              AI-ul a completat informațiile pe care le-a putut identifica. Poți modifica orice câmp.
            </p>

            <div
              className={
                styles.card
              }
            >
              <label
                className={
                  styles.label
                }
              >
                Titlu
              </label>

              <input
                value={
                  safeDraft.title
                }
                onChange={(
                  event
                ) =>
                  updateDraft({
                    title:
                      event
                        .target
                        .value,
                  })
                }
                className={
                  styles.input
                }
                placeholder="Titlul produsului"
              />
            </div>

            <div
              className={
                styles.card
              }
            >
              <label
                className={
                  styles.label
                }
              >
                Descriere
              </label>

              <textarea
                value={
                  safeDraft.description
                }
                onChange={(
                  event
                ) =>
                  updateDraft({
                    description:
                      event
                        .target
                        .value,
                  })
                }
                rows={6}
                className={`${styles.input} ${styles.textarea}`}
                placeholder="Descrierea produsului"
              />
            </div>

            <div
              className={
                styles.card
              }
            >
              <label
                className={
                  styles.label
                }
              >
                Categorie
              </label>

              <input
                value={
                  safeDraft.category
                }
                onChange={(
                  event
                ) =>
                  updateDraft({
                    category:
                      event
                        .target
                        .value,
                  })
                }
                className={
                  styles.input
                }
                placeholder="Categoria"
              />
            </div>

            {safeDraft
              .materialMain && (
              <div
                className={
                  styles.card
                }
              >
                <label
                  className={
                    styles.label
                  }
                >
                  Material identificat
                </label>

                <input
                  value={
                    safeDraft
                      .materialMain
                  }
                  onChange={(
                    event
                  ) =>
                    updateDraft({
                      materialMain:
                        event
                          .target
                          .value,
                    })
                  }
                  className={
                    styles.input
                  }
                />
              </div>
            )}

            {safeDraft
              .color && (
              <div
                className={
                  styles.card
                }
              >
                <label
                  className={
                    styles.label
                  }
                >
                  Culoare identificată
                </label>

                <input
                  value={
                    safeDraft.color
                  }
                  onChange={(
                    event
                  ) =>
                    updateDraft({
                      color:
                        event
                          .target
                          .value,
                    })
                  }
                  className={
                    styles.input
                  }
                />
              </div>
            )}

            <div
              className={
                styles.buttonGroup
              }
            >
              <button
                type="button"
                className={
                  styles.primaryButton
                }
                onClick={() =>
                  goToStep(
                    "order"
                  )
                }
              >
                Continuă la modul de comandă
              </button>

              <button
                type="button"
                className={
                  styles.secondaryButton
                }
                onClick={() =>
                  goToStep(
                    "images"
                  )
                }
              >
                Schimbă fotografiile
              </button>
            </div>
          </>
        )}

        {step ===
          "order" && (
          <>
            <div
              className={
                styles.progress
              }
            >
              Pasul 4 din 6
            </div>

            <h3
              className={
                styles.title
              }
            >
              Cum se comandă produsul?
            </h3>

            <p
              className={
                styles.text
              }
            >
              Explică simplu ce trebuie să aleagă sau să completeze clientul. AI-ul va transforma explicația într-un formular de comandă.
            </p>

            <div
              className={`${styles.card} ${styles.cardAccentInfo}`}
            >
              <strong
                style={{
                  display: "block",
                  marginBottom: 6,
                }}
              >
                Variantă vs. personalizare
              </strong>

              <p
                style={{
                  margin: "0 0 6px",
                  fontSize: 13,
                  lineHeight: 1.5,
                }}
              >
                <strong>Variantă</strong> =
                clientul alege dintre opțiuni
                deja definite de tine. Ex:
                Culoare → Alb / Roz / Verde.
              </p>

              <p
                style={{
                  margin: 0,
                  fontSize: 13,
                  lineHeight: 1.5,
                }}
              >
                <strong>
                  Personalizare
                </strong>{" "}
                = clientul introduce
                propria informație. Ex:
                Nume, text, dată eveniment
                sau o fotografie.
              </p>
            </div>

            <div
              className={
                styles.card
              }
            >
              <small
                className={
                  styles.cardEyebrow
                }
              >
                AI-ul sugerează:
              </small>

              <strong>
                {getOrderModeLabel(
                  safeDraft.orderMode
                )}
              </strong>

              <p
                className={
                  styles.cardSubtext
                }
              >
                {getOrderModeDescription(
                  safeDraft.orderMode
                )}
              </p>
            </div>

            <div
              className={
                styles.card
              }
            >
              <label
                className={
                  styles.label
                }
              >
                Cum trebuie să comande clientul?
              </label>

              <textarea
                value={
                  safeDraft
                    .orderInstructions
                }
                onChange={(
                  event
                ) =>
                  updateDraft({
                    orderInstructions:
                      event
                        .target
                        .value,
                  })
                }
                rows={6}
                className={`${styles.input} ${styles.textarea}`}
                placeholder="Exemplu: Clientul alege membrii familiei, iar pentru fiecare selectează mărimea și textul. Materialul se alege o singură dată pentru întregul set."
              />

              <small
                className={
                  styles.hint
                }
              >
                Poți scrie normal. Nu trebuie să creezi singur câmpurile sau variantele.
              </small>
            </div>

            {safeDraft
              .aiOrderMessage && (
              <div
                className={`${styles.card} ${styles.cardAccentSuccess}`}
              >
                <strong>
                  Ce a pregătit AI-ul
                </strong>

                <p
                  className={
                    styles.cardSubtextLarge
                  }
                >
                  {
                    safeDraft
                      .aiOrderMessage
                  }
                </p>
              </div>
            )}

            {safeDraft
              .aiOrderReason && (
              <div
                className={
                  styles.card
                }
              >
                <strong>
                  De ce a ales acest mod?
                </strong>

                <p
                  className={
                    styles.cardSubtext
                  }
                >
                  {
                    safeDraft
                      .aiOrderReason
                  }
                </p>
              </div>
            )}

            <SchemaFields
              title="Opțiuni pe care clientul le alege"
              fields={
                safeDraft
                  .optionsSchema
              }
            />

            <SchemaFields
              title="Informații de personalizare"
              fields={
                safeDraft
                  .customSchema
              }
            />

            <SchemaFields
              title="Informații pentru cererea de ofertă"
              fields={
                safeDraft
                  .quoteSchema
              }
            />

            {safeDraft
              .repeatedGroups
              .length >
              0 && (
              <div
                className={`${styles.card} ${styles.cardSpaced}`}
              >
                <strong>
                  Detalii completate separat pentru fiecare element
                </strong>

                <p
                  className={
                    styles.cardSubtext
                  }
                >
                  AI-ul a detectat că produsul conține mai multe elemente sau persoane care trebuie configurate separat. Clientul va putea adăuga mai mulți membri și, pentru fiecare, va completa:
                </p>

                <p
                  style={{
                    margin:
                      "6px 0 0",
                    fontSize:
                      13,
                    fontWeight: 700,
                  }}
                >
                  {(
                    safeDraft
                      .repeatedGroups[0]
                      ?.fields || []
                  )
                    .map(
                      (field) =>
                        field.label
                    )
                    .filter(Boolean)
                    .join(", ") ||
                    "(niciun câmp identificat încă)"}
                </p>
              </div>
            )}

            {safeDraft
              .aiQuestions
              .length >
              0 && (
              <div
                className={`${styles.card} ${styles.cardAccentWarning} ${styles.cardSpaced}`}
              >
                <strong>
                  AI-ul mai are nevoie de câteva informații
                </strong>

                <ul
                  className={
                    styles.infoList
                  }
                >
                  {safeDraft
                    .aiQuestions
                    .map(
                      (
                        question,
                        index
                      ) => (
                        <li
                          key={`${question}-${index}`}
                        >
                          {
                            question
                          }
                        </li>
                      )
                    )}
                </ul>

                <small
                  className={
                    styles.hint
                  }
                >
                  Poți include răspunsurile direct în explicația de mai sus și apoi să apeși din nou butonul AI.
                </small>
              </div>
            )}

            <div
              className={
                styles.buttonGroup
              }
            >
              <button
                type="button"
                disabled={
                  !canAnalyzeOrder
                }
                className={
                  styles.primaryButton
                }
                onClick={
                  onAnalyzeOrder
                }
              >
                {analyzingOrder
                  ? "Pregătesc formularul..."
                  : "Pregătește formularul cu AI"}
              </button>

              <button
                type="button"
                className={
                  styles.secondaryButton
                }
                onClick={() =>
                  goToStep(
                    "commercial"
                  )
                }
              >
                Continuă la preț și disponibilitate
              </button>

              <button
                type="button"
                className={
                  styles.secondaryButton
                }
                onClick={() =>
                  goToStep(
                    "details"
                  )
                }
              >
                Înapoi la detalii
              </button>
            </div>
          </>
        )}

        {step ===
          "commercial" && (
          <>
            <div
              className={
                styles.progress
              }
            >
              Pasul 5 din 6
            </div>

            <h3
              className={
                styles.title
              }
            >
              Preț și disponibilitate
            </h3>

            <div
              className={
                styles.card
              }
            >
              <label
                className={
                  styles.label
                }
              >
                {safeDraft.orderMode ===
                "QUOTE_ONLY"
                  ? "Preț orientativ / de la (RON)"
                  : "Preț"}
              </label>

              <input
                type="number"
                min="0.01"
                step="0.01"
                value={
                  safeDraft.price
                }
                onChange={(
                  event
                ) =>
                  updateDraft({
                    price:
                      event
                        .target
                        .value,
                  })
                }
                className={
                  styles.input
                }
                placeholder={
                  safeDraft.orderMode ===
                  "QUOTE_ONLY"
                    ? "Ex: 150"
                    : "Ex: 120"
                }
              />

              {/*
               * BUGFIX (audit) - QUOTE_ONLY cere acum un preț
               * orientativ real, ca și celelalte moduri - nu mai
               * ascundem inputul, doar explicăm ce înseamnă.
               */}
              {safeDraft.orderMode ===
                "QUOTE_ONLY" && (
                <p
                  className={
                    styles.cardSubtext
                  }
                >
                  Prețul final poate varia în funcție de cerințele clientului și va fi stabilit în urma cererii de ofertă.
                </p>
              )}

              <a
                href="/vendor/costs-profit"
                target="_blank"
                rel="noopener noreferrer"
                className={
                  styles.hint
                }
                style={{
                  textDecoration:
                    "underline",
                }}
              >
                Vezi calculatorul de cost și profit (se deschide într-o filă nouă - draftul rămâne aici)
              </a>
            </div>

            <div
              className={
                styles.card
              }
            >
              <label
                className={
                  styles.label
                }
              >
                Disponibilitate
              </label>

              <select
                value={
                  safeDraft
                    .availability
                }
                onChange={(
                  event
                ) =>
                  updateDraft({
                    availability:
                      event
                        .target
                        .value,
                  })
                }
                className={
                  styles.input
                }
              >
                <option value="">
                  Alege disponibilitatea
                </option>

                <option value="READY">
                  Gata de livrare
                </option>

                <option value="MADE_TO_ORDER">
                  Realizat la comandă
                </option>

                <option value="PREORDER">
                  Precomandă
                </option>

                <option value="SOLD_OUT">
                  Indisponibil
                </option>
              </select>
            </div>

            {safeDraft
              .availability ===
              "READY" && (
              <div
                className={
                  styles.card
                }
              >
                <label
                  className={
                    styles.label
                  }
                >
                  Cantitate disponibilă
                </label>

                <input
                  type="number"
                  min="0"
                  step="1"
                  value={
                    safeDraft
                      .readyQty
                  }
                  onChange={(
                    event
                  ) =>
                    updateDraft({
                      readyQty:
                        event
                          .target
                          .value,
                    })
                  }
                  className={
                    styles.input
                  }
                />
              </div>
            )}

            {safeDraft
              .availability ===
              "MADE_TO_ORDER" && (
              <div
                className={
                  styles.card
                }
              >
                <label
                  className={
                    styles.label
                  }
                >
                  Timp de realizare în zile
                </label>

                <input
                  type="number"
                  min="1"
                  step="1"
                  value={
                    safeDraft
                      .leadTimeDays
                  }
                  onChange={(
                    event
                  ) =>
                    updateDraft({
                      leadTimeDays:
                        event
                          .target
                          .value,
                    })
                  }
                  className={
                    styles.input
                  }
                />
              </div>
            )}

            <div
              className={
                styles.buttonGroup
              }
            >
              <button
                type="button"
                className={
                  styles.primaryButton
                }
                onClick={() =>
                  goToStep(
                    "summary"
                  )
                }
              >
                Vezi rezumatul
              </button>

              <button
                type="button"
                className={
                  styles.secondaryButton
                }
                onClick={() =>
                  goToStep(
                    "order"
                  )
                }
              >
                Înapoi la modul de comandă
              </button>
            </div>
          </>
        )}

        {step ===
          "summary" && (
          <>
            <div
              className={
                styles.progress
              }
            >
              Pasul 6 din 6
            </div>

            <h3
              className={
                styles.title
              }
            >
              Verifică produsul
            </h3>

            {images[0] && (
              <div
                className={
                  styles.summaryImage
                }
              >
                <img
                  src={
                    getImageUrl(
                      images[0]
                    )
                  }
                  alt={
                    safeDraft.title ||
                    "Produs"
                  }
                />
              </div>
            )}

            <div
              className={
                styles.card
              }
            >
              <strong>
                {safeDraft.title ||
                  "Produs fără titlu"}
              </strong>

              <p
                className={
                  styles.cardSubtextLarge
                }
              >
                {safeDraft.description ||
                  "Descrierea nu este completată."}
              </p>

              <div
                className={
                  styles.summaryMetaGrid
                }
              >
                <span>
                  Categorie:{" "}
                  <strong>
                    {safeDraft.category ||
                      "Neselectată"}
                  </strong>
                </span>

                <span>
                  {safeDraft.orderMode ===
                  "QUOTE_ONLY"
                    ? "Preț orientativ:"
                    : "Preț:"}{" "}
                  <strong>
                    {safeDraft.price
                      ? `${
                          safeDraft.orderMode ===
                          "QUOTE_ONLY"
                            ? "De la "
                            : ""
                        }${safeDraft.price} ${safeDraft.currency}`
                      : "Necompletat"}
                  </strong>
                </span>

                <span>
                  Disponibilitate:{" "}
                  <strong>
                    {getAvailabilityLabel(
                      safeDraft
                        .availability
                    )}
                  </strong>
                </span>

                <span>
                  Comandă:{" "}
                  <strong>
                    {getOrderModeLabel(
                      safeDraft
                        .orderMode
                    )}
                  </strong>
                </span>

                {safeDraft
                  .optionsSchema
                  .length >
                  0 && (
                  <span>
                    Opțiuni:{" "}
                    <strong>
                      {
                        safeDraft
                          .optionsSchema
                          .length
                      }
                    </strong>
                  </span>
                )}

                {safeDraft
                  .customSchema
                  .length >
                  0 && (
                  <span>
                    Câmpuri de personalizare:{" "}
                    <strong>
                      {
                        safeDraft
                          .customSchema
                          .length
                      }
                    </strong>
                  </span>
                )}

                {safeDraft.videoUrl && (
                  <span>
                    Video:{" "}
                    <strong>
                      {safeDraft.videoMuted
                        ? "Da (fără sunet)"
                        : "Da (cu sunet)"}
                    </strong>
                  </span>
                )}
              </div>
            </div>

            {!publishSuccess &&
              missingFields.length >
                0 && (
                <div
                  className={`${styles.card} ${styles.cardAccentWarning}`}
                >
                  <strong>
                    Mai ai de completat:
                  </strong>

                  <ul
                    className={
                      styles.infoList
                    }
                  >
                    {missingFields.map(
                      (field) => (
                        <li
                          key={
                            field
                          }
                        >
                          {field}
                        </li>
                      )
                    )}
                  </ul>
                </div>
              )}

            {publishSuccess ? (
              <div className={styles.successCard}>
                <strong>
                  Produsul „
                  {publishSuccess.title}
                  ” a fost salvat.
                </strong>

                <p
                  style={{
                    margin: "6px 0 0",
                    fontSize: 13,
                  }}
                >
                  E în așteptarea
                  moderării Artfest
                  înainte să apară
                  public.
                  {publishSuccess.costingWarning
                    ? ""
                    : " Am salvat și costingul calculat pentru el."}
                </p>

                {publishSuccess.costingWarning && (
                  <p
                    className={
                      styles.warningText
                    }
                  >
                    Nu am putut salva
                    costingul calculat:{" "}
                    {
                      publishSuccess.costingWarning
                    }
                  </p>
                )}

                <div
                  className={
                    styles.buttonGroup
                  }
                >
                  <a
                    href={`/produs/${publishSuccess.productId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={
                      styles.secondaryButton
                    }
                  >
                    Vezi produsul
                  </a>

                  <a
                    href="/vendor/catalog"
                    target="_blank"
                    rel="noopener noreferrer"
                    className={
                      styles.secondaryButton
                    }
                  >
                    Vezi în catalog
                  </a>
                </div>
              </div>
            ) : (
              <div
                className={
                  styles.buttonGroup
                }
              >
                {confirmingPublish ? (
                  <div
                    className={`${styles.card} ${styles.cardAccentInfo}`}
                  >
                    <strong>
                      Confirmă salvarea
                    </strong>

                    <p
                      style={{
                        margin:
                          "6px 0 0",
                        fontSize: 13,
                        lineHeight: 1.5,
                      }}
                    >
                      Produsul va fi trimis spre moderare Artfest înainte să apară public. Continui?
                    </p>

                    <div
                      className={
                        styles.buttonGroup
                      }
                    >
                      <button
                        type="button"
                        disabled={
                          publishing
                        }
                        className={
                          styles.primaryButton
                        }
                        onClick={() =>
                          onPublish?.()
                        }
                      >
                        {publishing
                          ? "Se salvează..."
                          : "Da, salvează produsul"}
                      </button>

                      <button
                        type="button"
                        disabled={
                          publishing
                        }
                        className={
                          styles.secondaryButton
                        }
                        onClick={() =>
                          setConfirmingPublish(
                            false
                          )
                        }
                      >
                        Renunță
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={
                      publishing
                    }
                    className={
                      styles.primaryButton
                    }
                    onClick={() =>
                      setConfirmingPublish(
                        true
                      )
                    }
                  >
                    Salvează produsul
                  </button>
                )}

                {publishError && (
                  <p
                    className={
                      styles.errorText
                    }
                  >
                    {publishError}
                  </p>
                )}

                <button
                  type="button"
                  disabled={
                    publishing
                  }
                  className={
                    styles.secondaryButton
                  }
                  onClick={() =>
                    goToStep(
                      "details"
                    )
                  }
                >
                  Modifică informațiile
                </button>

                <button
                  type="button"
                  disabled={
                    publishing
                  }
                  className={
                    styles.secondaryButton
                  }
                  onClick={() =>
                    goToStep(
                      "order"
                    )
                  }
                >
                  Modifică modul de comandă
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

/*
 * VendorProductEditWizard - mode="edit" real (audit: wizard-ul de
 * mai sus e un flow de CREARE asistat de AI din poze, nu un editor
 * manual - nu are reorder/ștergere imagini, categorie cu sugestii,
 * sau builder manual de variante/personalizare/repeated-groups/
 * quote-only).
 *
 * NU rescrie acele capabilități - le reutilizează STRICT prin
 * ProductModalWizard + useProductEditorController (aceleași
 * ProductImagesSection/ProductDetailsSection/ProductOrderModeSection/
 * ProductClientPreviewModal ca vechiul ProductModal), astfel încât
 * editarea unui produs existent să fie echivalentă funcțional cu
 * ProductModal - nu un editor nou, mai sărac.
 *
 * Adaugă STRICT ce lipsea din ProductModal pentru acest task: dirty
 * state, protecție la ieșire cu modificări nesalvate, retry la
 * eșecul salvării, guard de double-submit (delegat apelantului -
 * vezi handleSaveProductFromWizard din CatalogProduse.jsx) și
 * actualizare locală a listei fără reload complet.
 */
function VendorProductEditWizard({
  editingProduct,
  draft,
  setDraft,

  categories = [],
  storeSlug,
  uploadFile,

  onSave,
  saving = false,
  saveError = "",
  saveSuccess = null,

  onClose,
  onBack,
}) {
  const controller = useProductEditorController({
    editingProduct,
    form: draft,
    setForm: setDraft,
    categories,
    onSave,
    onClose,
    uploadFile,
    storeSlug,

    /*
     * Nu pornim flow-ul de la poze/AI ca la crearea unui produs nou -
     * un produs existent se deschide direct pe detalii.
     */
    initialStep: "details",
  });

  /*
   * Dirty state: snapshot-ul e luat o SINGURĂ dată, la montare -
   * componenta se montează din nou de fiecare dată când vendorul
   * deschide un alt produs (CatalogProduse randează
   * VendorProductWizard mode="edit" condiționat de editProductOpen),
   * deci fiecare sesiune de editare pornește cu propriul baseline.
   */
  const [snapshot, setSnapshot] = useState(
    () => JSON.stringify(draft)
  );

  const draftRef = useRef(draft);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const isDirty =
    JSON.stringify(draft) !== snapshot;

  const [confirmingExit, setConfirmingExit] =
    useState(null); // null | "close" | "back"

  function requestExit(kind) {
    if (saving) {
      return;
    }

    const action =
      kind === "back" ? onBack : onClose;

    if (!isDirty) {
      action?.();
      return;
    }

    setConfirmingExit(kind);
  }

  function confirmExit() {
    const kind = confirmingExit;

    setConfirmingExit(null);

    (kind === "back" ? onBack : onClose)?.();
  }

  function cancelExit() {
    setConfirmingExit(null);
  }

  async function handleFormSubmit(event) {
    event?.preventDefault?.();

    if (controller.uploadingImages > 0) {
      alert(
        "Te rog așteaptă să se termine încărcarea pozelor."
      );
      return;
    }

    if (
      (draft?.images || []).some((image) =>
        String(image).startsWith("blob:")
      )
    ) {
      alert(
        "Mai există imagini care nu s-au încărcat complet."
      );
      return;
    }

    const ok = await onSave?.(event);

    if (ok) {
      setSnapshot(
        JSON.stringify(draftRef.current)
      );
    }
  }

  return (
    <EditModal
      open
      onClose={() => requestExit("close")}
      maxWidth={760}
    >
    <section className={editStyles.wrapper}>
      <header className={editStyles.header}>
        {onBack && (
          <button
            type="button"
            className={editStyles.headerButton}
            onClick={() => requestExit("back")}
            disabled={saving}
          >
            ← Înapoi
          </button>
        )}

        <strong className={editStyles.headerTitle}>
          Editează produs
          {draft?.title ? `: ${draft.title}` : ""}
        </strong>

        <button
          type="button"
          className={editStyles.headerButton}
          onClick={() => requestExit("close")}
          disabled={saving}
          aria-label="Închide"
        >
          ✕
        </button>
      </header>

      <div className={editStyles.body}>
        {confirmingExit && (
          <div className={editStyles.exitConfirm}>
            <strong>
              Ai modificări nesalvate.
            </strong>

            <p>
              Vrei să ieși fără să salvezi?
            </p>

            <div className={editStyles.exitConfirmActions}>
              <button
                type="button"
                className={editStyles.dangerButton}
                onClick={confirmExit}
              >
                Da, ieși
              </button>

              <button
                type="button"
                className={editStyles.secondaryButton}
                onClick={cancelExit}
              >
                Rămân și continui editarea
              </button>
            </div>
          </div>
        )}

        {saveSuccess && (
          <div className={editStyles.successBanner}>
            <strong>Produs actualizat.</strong>

            <div className={editStyles.successActions}>
              <a
                href={`/produs/${saveSuccess.productId}`}
                target="_blank"
                rel="noopener noreferrer"
                className={editStyles.secondaryButton}
              >
                Vezi produsul
              </a>
            </div>
          </div>
        )}

        {saveError && (
          <div className={editStyles.errorBanner}>
            <strong>
              Nu am putut salva modificările.
            </strong>

            <p>{saveError}</p>

            <button
              type="button"
              className={editStyles.primaryButton}
              disabled={saving}
              onClick={handleFormSubmit}
            >
              {saving
                ? "Se reîncearcă..."
                : "Reîncearcă"}
            </button>
          </div>
        )}

        <ProductModalWizard
          form={draft}
          setForm={setDraft}
          quoteSchema={
            Array.isArray(draft?.quoteSchema)
              ? draft.quoteSchema
              : []
          }
          addQuoteField={controller.addQuoteField}
          updateQuoteField={controller.updateQuoteField}
          removeQuoteField={controller.removeQuoteField}
          addQuoteFieldOption={controller.addQuoteFieldOption}
          updateQuoteFieldOption={controller.updateQuoteFieldOption}
          removeQuoteFieldOption={controller.removeQuoteFieldOption}
          saving={saving}
          editingProduct={editingProduct}
          activeStep={controller.activeStep}
          setActiveStep={controller.setActiveStep}
          handleSubmit={handleFormSubmit}
          onClose={() => requestExit("close")}
          draftKey={controller.draftKey}
          getLabelFor={controller.getLabelFor}
          options={controller.options}
          aiImagePreview={controller.aiImagePreview}
          aiImageLoading={controller.aiImageLoading}
          aiLoading={controller.aiLoading}
          uploadInfo={controller.uploadInfo}
          allImagesReadyForAi={controller.allImagesReadyForAi}
          mainImageReadyForAi={controller.mainImageReadyForAi}
          resolveProductImageUrl={controller.resolveProductImageUrl}
          onPasteImages={controller.onPasteImages}
          onFilesPicked={controller.onFilesPicked}
          onDragStart={controller.onDragStart}
          onDragOver={controller.onDragOver}
          onDrop={controller.onDrop}
          setMainImage={controller.setMainImage}
          removeImage={controller.removeImage}
          handleAiAnalyze={controller.handleAiAnalyze}
          handleAiEnhanceImage={controller.handleAiEnhanceImage}
          useAiImage={controller.useAiImage}
          updateField={controller.updateField}
          materialOptions={controller.materialOptions}
          techniqueOptions={controller.techniqueOptions}
          styleOptions={controller.styleOptions}
          occasionOptions={controller.occasionOptions}
          careOptions={controller.careOptions}
          colorOptions={controller.colorOptions}
          uploadingImages={controller.uploadingImages}
          hasPriceWarning={controller.hasPriceWarning}
          priceSuggestion={controller.priceSuggestion}
          priceWarningConfirmed={controller.priceWarningConfirmed}
          onGoToCostsProfit={controller.goToCostsProfit}
          setAiImagePreview={controller.setAiImagePreview}
          setPriceSuggestion={controller.setPriceSuggestion}
          setPriceWarningConfirmed={controller.setPriceWarningConfirmed}
        />
      </div>
    </section>
    </EditModal>
  );
}

/*
 * Dispatcher - păstrează VendorProductCreateWizard (flow-ul de
 * creare din chat, neatins) ca implicit, și rutează explicit
 * mode="edit" către VendorProductEditWizard. Niciun hook nu e apelat
 * aici, deci alegerea condiționată e sigură (fiecare ramură e o
 * componentă separată, cu propria secvență de hook-uri stabilă).
 */
export default function VendorProductWizard({
  mode = "create",
  ...props
}) {
  if (mode === "edit") {
    return <VendorProductEditWizard {...props} />;
  }

  return <VendorProductCreateWizard {...props} />;
}
