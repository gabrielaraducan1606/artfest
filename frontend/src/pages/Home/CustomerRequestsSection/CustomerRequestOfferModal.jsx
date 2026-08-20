import React, {
  useMemo,
  useState,
} from "react";

import {
  api,
} from "../../../lib/api.js";

import styles from "./CustomerRequestOfferModal.module.css";

/* =========================================================
   HELPERS
========================================================= */

function leiToCents(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const number =
    Number(
      String(value)
        .replace(
          ",",
          "."
        )
    );

  if (
    !Number.isFinite(number) ||
    number < 0
  ) {
    return null;
  }

  return Math.round(
    number * 100
  );
}

function formatLeiFromCents(
  cents
) {
  if (
    cents === null ||
    cents === undefined
  ) {
    return "";
  }

  const number =
    Number(cents);

  if (
    !Number.isFinite(number)
  ) {
    return "";
  }

  return new Intl.NumberFormat(
    "ro-RO",
    {
      style: "currency",
      currency: "RON",
      maximumFractionDigits: 2,
    }
  ).format(
    number / 100
  );
}

function formatDateInput(
  value
) {
  if (!value) {
    return "";
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return "";
  }

  return date
    .toISOString()
    .slice(
      0,
      10
    );
}

/* =========================================================
   COMPONENT
========================================================= */

export default function CustomerRequestOfferModal({
  open,
  request,
  onClose,
  onSent,
}) {
  const [
    unitPrice,
    setUnitPrice,
  ] =
    useState("");

  const [
    shippingPrice,
    setShippingPrice,
  ] =
    useState("");

  const [
    productionDays,
    setProductionDays,
  ] =
    useState("");

  const [
    totalPrice,
    setTotalPrice,
  ] =
    useState("");

  const [
    message,
    setMessage,
  ] =
    useState("");

  const [
    validUntil,
    setValidUntil,
  ] =
    useState("");

  const [
    submitting,
    setSubmitting,
  ] =
    useState(false);

  const [
    error,
    setError,
  ] =
    useState("");

  const requestQuantity =
    Number(
      request?.quantity
    );

  const hasQuantity =
    Number.isInteger(
      requestQuantity
    ) &&
    requestQuantity > 0;

  /* =========================================================
     CALCULATED TOTAL
  ========================================================= */

  const calculatedTotalCents =
    useMemo(() => {
      if (!hasQuantity) {
        return null;
      }

      const unitCents =
        leiToCents(
          unitPrice
        );

      const shippingCents =
        shippingPrice ===
        ""
          ? 0
          : leiToCents(
              shippingPrice
            );

      if (
        unitCents === null ||
        shippingCents === null
      ) {
        return null;
      }

      return (
        requestQuantity *
        unitCents
      ) +
        shippingCents;
    }, [
      hasQuantity,
      requestQuantity,
      unitPrice,
      shippingPrice,
    ]);

  const canSubmit =
    useMemo(() => {
      const unitCents =
        leiToCents(
          unitPrice
        );

      const shippingCents =
        shippingPrice ===
        ""
          ? 0
          : leiToCents(
              shippingPrice
            );

      const days =
        Number(
          productionDays
        );

      if (
        unitCents === null ||
        unitCents <= 0
      ) {
        return false;
      }

      if (
        shippingCents ===
          null ||
        shippingCents < 0
      ) {
        return false;
      }

      if (
        !Number.isInteger(
          days
        ) ||
        days <= 0
      ) {
        return false;
      }

      if (
        !hasQuantity
      ) {
        const totalCents =
          leiToCents(
            totalPrice
          );

        if (
          totalCents ===
            null ||
          totalCents <= 0
        ) {
          return false;
        }
      }

      return !submitting;
    }, [
      unitPrice,
      shippingPrice,
      productionDays,
      totalPrice,
      hasQuantity,
      submitting,
    ]);

  if (!open) {
    return null;
  }

  /* =========================================================
     CLOSE
  ========================================================= */

  function handleClose() {
    if (submitting) {
      return;
    }

    onClose?.();
  }

  function handleBackdrop(
    event
  ) {
    if (
      event.target ===
        event.currentTarget &&
      !submitting
    ) {
      onClose?.();
    }
  }

  /* =========================================================
     SUBMIT
  ========================================================= */

  async function handleSubmit(
    event
  ) {
    event.preventDefault();

    if (
      submitting ||
      !request?.id
    ) {
      return;
    }

    const unitPriceCents =
      leiToCents(
        unitPrice
      );

    const shippingCents =
      shippingPrice ===
      ""
        ? 0
        : leiToCents(
            shippingPrice
          );

    const days =
      Number(
        productionDays
      );

    const explicitTotalPriceCents =
      hasQuantity
        ? null
        : leiToCents(
            totalPrice
          );

    /* =====================================================
       VALIDARE PREȚ UNITAR
    ===================================================== */

    if (
      unitPriceCents ===
        null ||
      unitPriceCents <= 0
    ) {
      setError(
        "Introdu un preț pe bucată valid."
      );

      return;
    }

    /* =====================================================
       VALIDARE TRANSPORT
    ===================================================== */

    if (
      shippingCents ===
        null ||
      shippingCents < 0
    ) {
      setError(
        "Costul transportului nu este valid."
      );

      return;
    }

    /* =====================================================
       VALIDARE ZILE
    ===================================================== */

    if (
      !Number.isInteger(
        days
      ) ||
      days <= 0
    ) {
      setError(
        "Introdu numărul de zile necesare pentru producție."
      );

      return;
    }

    /* =====================================================
       TOTAL DACĂ NU AVEM CANTITATE
    ===================================================== */

    if (
      !hasQuantity &&
      (
        explicitTotalPriceCents ===
          null ||
        explicitTotalPriceCents <=
          0
      )
    ) {
      setError(
        "Introdu și prețul total al ofertei."
      );

      return;
    }

    /* =====================================================
       VALIDARE VALABILITATE
    ===================================================== */

    if (validUntil) {
      const validDate =
        new Date(
          `${validUntil}T23:59:59`
        );

      if (
        Number.isNaN(
          validDate.getTime()
        ) ||
        validDate <=
          new Date()
      ) {
        setError(
          "Valabilitatea ofertei trebuie să fie o dată viitoare."
        );

        return;
      }
    }

    /* =====================================================
       PAYLOAD
    ===================================================== */

    const payload = {
      unitPriceCents,

      shippingCents,

      productionDays:
        days,

      message:
        message.trim() ||
        null,

      validUntil:
        validUntil ||
        null,

      images: [],
    };

    if (
      !hasQuantity &&
      explicitTotalPriceCents !==
        null
    ) {
      payload.totalPriceCents =
        explicitTotalPriceCents;
    }

    try {
      setSubmitting(
        true
      );

      setError("");

      const result =
        await api(
          `/customer-requests/${request.id}/offers`,
          {
            method:
              "POST",

            body:
              payload,
          }
        );

      onSent?.(
        result?.offer ||
        null
      );

      onClose?.();
    } catch (err) {
      console.error(
        "[CustomerRequestOfferModal] send failed:",
        err
      );

      setError(
        err?.message ||
          "Oferta nu a putut fi trimisă."
      );
    } finally {
      setSubmitting(
        false
      );
    }
  }

  /* =========================================================
     RENDER
  ========================================================= */

  return (
    <div
      className={
        styles.backdrop
      }
      onMouseDown={
        handleBackdrop
      }
    >
      <div
        className={
          styles.modal
        }
        role="dialog"
        aria-modal="true"
        aria-label="Trimite ofertă"
      >
        {/* ==================================================
            HEADER
        ================================================== */}

        <div
          className={
            styles.header
          }
        >
          <div>
            <span
              className={
                styles.eyebrow
              }
            >
              OFERTĂ ARTFEST
            </span>

            <h2
              className={
                styles.title
              }
            >
              Trimite ofertă
            </h2>

            <p
              className={
                styles.subtitle
              }
            >
              Completează oferta pentru cererea clientului.
            </p>
          </div>

          <button
            type="button"
            className={
              styles.closeButton
            }
            disabled={
              submitting
            }
            onClick={
              handleClose
            }
            aria-label="Închide"
          >
            ×
          </button>
        </div>

        {/* ==================================================
            REQUEST SUMMARY
        ================================================== */}

        <div
          className={
            styles.requestCard
          }
        >
          <span
            className={
              styles.requestLabel
            }
          >
            CERERE CLIENT
          </span>

          <strong>
            {request?.title ||
              "Cerere Artfest"}
          </strong>

          {request?.quantity !=
            null && (
            <span
              className={
                styles.requestMeta
              }
            >
              📦{" "}
              {
                request.quantity
              }{" "}
              buc.
            </span>
          )}

          {request
            ?.deliveryDeadline && (
            <span
              className={
                styles.requestMeta
              }
            >
              📅 Termen client:{" "}
              {formatDateInput(
                request
                  .deliveryDeadline
              )}
            </span>
          )}
        </div>

        {/* ==================================================
            FORM
        ================================================== */}

        <form
          className={
            styles.form
          }
          onSubmit={
            handleSubmit
          }
        >
          {/* ==================================================
              PRICE
          ================================================== */}

          <div
            className={
              styles.field
            }
          >
            <label
              className={
                styles.label
              }
            >
              Preț pe bucată *
            </label>

            <div
              className={
                styles.moneyInput
              }
            >
              <input
                type="number"
                min="0.01"
                step="0.01"
                inputMode="decimal"
                value={
                  unitPrice
                }
                disabled={
                  submitting
                }
                onChange={(
                  event
                ) => {
                  setUnitPrice(
                    event.target
                      .value
                  );

                  setError("");
                }}
                placeholder="Ex: 8.50"
              />

              <span>
                lei
              </span>
            </div>

            <p
              className={
                styles.help
              }
            >
              Introdu prețul final pentru o bucată, fără transport.
            </p>
          </div>

          {/* ==================================================
              SHIPPING
          ================================================== */}

          <div
            className={
              styles.field
            }
          >
            <label
              className={
                styles.label
              }
            >
              Transport
            </label>

            <div
              className={
                styles.moneyInput
              }
            >
              <input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={
                  shippingPrice
                }
                disabled={
                  submitting
                }
                onChange={(
                  event
                ) => {
                  setShippingPrice(
                    event.target
                      .value
                  );

                  setError("");
                }}
                placeholder="0"
              />

              <span>
                lei
              </span>
            </div>

            <p
              className={
                styles.help
              }
            >
              Dacă transportul este gratuit, lasă 0.
            </p>
          </div>

          {/* ==================================================
              TOTAL AUTO
          ================================================== */}

          {hasQuantity ? (
            <div
              className={
                styles.totalCard
              }
            >
              <div>
                <span>
                  Total ofertă
                </span>

                <small>
                  {requestQuantity} buc. × preț + transport
                </small>
              </div>

              <strong>
                {calculatedTotalCents !==
                null
                  ? formatLeiFromCents(
                      calculatedTotalCents
                    )
                  : "—"}
              </strong>
            </div>
          ) : (
            <div
              className={
                styles.field
              }
            >
              <label
                className={
                  styles.label
                }
              >
                Preț total ofertă *
              </label>

              <div
                className={
                  styles.moneyInput
                }
              >
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  inputMode="decimal"
                  value={
                    totalPrice
                  }
                  disabled={
                    submitting
                  }
                  onChange={(
                    event
                  ) => {
                    setTotalPrice(
                      event.target
                        .value
                    );

                    setError("");
                  }}
                  placeholder="Ex: 500"
                />

                <span>
                  lei
                </span>
              </div>

              <p
                className={
                  styles.help
                }
              >
                Cererea nu are o cantitate specificată, așa că introdu și valoarea totală a ofertei.
              </p>
            </div>
          )}

          {/* ==================================================
              PRODUCTION DAYS
          ================================================== */}

          <div
            className={
              styles.field
            }
          >
            <label
              className={
                styles.label
              }
            >
              Timp de producție *
            </label>

            <div
              className={
                styles.daysInput
              }
            >
              <input
                type="number"
                min="1"
                step="1"
                value={
                  productionDays
                }
                disabled={
                  submitting
                }
                onChange={(
                  event
                ) => {
                  setProductionDays(
                    event.target
                      .value
                  );

                  setError("");
                }}
                placeholder="Ex: 7"
              />

              <span>
                zile
              </span>
            </div>

            <p
              className={
                styles.help
              }
            >
              Spune în câte zile poți pregăti comanda.
            </p>
          </div>

          {/* ==================================================
              MESSAGE
          ================================================== */}

          <div
            className={
              styles.field
            }
          >
            <label
              className={
                styles.label
              }
            >
              Mesaj pentru client
            </label>

            <textarea
              className={
                styles.textarea
              }
              rows={5}
              maxLength={3000}
              value={
                message
              }
              disabled={
                submitting
              }
              onChange={(
                event
              ) => {
                setMessage(
                  event.target
                    .value
                );

                setError("");
              }}
              placeholder="Ex: Pot realiza modelul în culorile dorite. Personalizarea este inclusă în preț."
            />

            <div
              className={
                styles.messageFooter
              }
            >
              <span>
                Nu include telefon, WhatsApp, email sau alte date de contact.
              </span>

              <span>
                {message.length}/3000
              </span>
            </div>
          </div>

          {/* ==================================================
              VALID UNTIL
          ================================================== */}

          <div
            className={
              styles.field
            }
          >
            <label
              className={
                styles.label
              }
            >
              Oferta este valabilă până la
            </label>

            <input
              type="date"
              className={
                styles.input
              }
              value={
                validUntil
              }
              disabled={
                submitting
              }
              min={
                new Date(
                  Date.now() +
                    24 *
                      60 *
                      60 *
                      1000
                )
                  .toISOString()
                  .slice(
                    0,
                    10
                  )
              }
              onChange={(
                event
              ) => {
                setValidUntil(
                  event.target
                    .value
                );

                setError("");
              }}
            />

            <p
              className={
                styles.help
              }
            >
              Opțional. Dacă nu alegi o dată, oferta rămâne valabilă cât timp cererea este deschisă.
            </p>
          </div>

          {/* ==================================================
              INFO
          ================================================== */}

          <div
            className={
              styles.infoBox
            }
          >
            <span>
              💜
            </span>

            <p>
              Clientul va putea vedea oferta ta în Artfest și o va putea accepta direct din platformă.
            </p>
          </div>

          {/* ==================================================
              ERROR
          ================================================== */}

          {error && (
            <div
              className={
                styles.error
              }
            >
              {error}
            </div>
          )}

          {/* ==================================================
              FOOTER
          ================================================== */}

          <div
            className={
              styles.footer
            }
          >
            <button
              type="button"
              className={
                styles.secondaryButton
              }
              disabled={
                submitting
              }
              onClick={
                handleClose
              }
            >
              Renunță
            </button>

            <button
              type="submit"
              className={
                styles.primaryButton
              }
              disabled={
                !canSubmit
              }
            >
              {submitting
                ? "Se trimite oferta..."
                : "💜 Trimite oferta"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}