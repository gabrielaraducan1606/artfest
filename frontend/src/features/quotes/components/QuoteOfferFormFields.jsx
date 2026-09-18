// src/features/quotes/components/QuoteOfferFormFields.jsx

/*
 * Extras MINIM din QuoteOfferModal (frontend/src/pages/Vendor/Mesaje/Messages.jsx)
 * - EXACT aceleași câmpuri, aceeași validare vizuală, același markup -
 * ca formularul "Trimite ofertă" să poată fi reutilizat identic și
 * în Asistentul Vendor (AssistantMessage.jsx), fără al doilea flow
 * de ofertare.
 *
 * Singura diferență față de originalul din QuoteOfferModal: prop-ul
 * `onClose` a devenit `onCancel` (numele generic, indiferent dacă
 * wrapper-ul e un modal sau un card inline în chat) - restul e
 * copiat 1:1, inclusiv clasele CSS (import din Messages.module.css,
 * NU o copie a stilurilor - același modul CSS, aceeași aparență).
 *
 * Nu conține propria stare (form/sending/error vin din afară) - nu
 * e un endpoint nou, nu e o validare nouă, doar markup + interacțiune
 * cu callback-uri primite ca props.
 */

import { Loader2, Send } from "lucide-react";
import styles from "../../../pages/Vendor/Mesaje/Messages.module.css";

export default function QuoteOfferFormFields({
  quoteRequest,
  form,
  setForm,
  sending,
  error,
  onSubmit,
  onCancel,
}) {
  const quantity =
    Number(
      quoteRequest?.quantity
    ) || 0;

  const unitPrice =
    Number(
      String(
        form.unitPrice || "0"
      ).replace(",", ".")
    ) || 0;

  const shippingPrice =
    Number(
      String(
        form.shippingPrice ||
          "0"
      ).replace(",", ".")
    ) || 0;

  const productsTotal =
    unitPrice * quantity;

  const finalTotal =
    productsTotal +
    shippingPrice;

  return (
    <form
      className={
        styles.quoteOfferForm
      }
      onSubmit={onSubmit}
    >
      <div
        className={
          styles.quoteFormGrid
        }
      >
        <label>
          <span>
            Preț unitar
          </span>

          <div
            className={
              styles.quoteMoneyInput
            }
          >
            <input
              type="number"
              min="0"
              step="0.01"
              value={
                form.unitPrice
              }
              autoFocus
              required
              onChange={(event) =>
                setForm(
                  (current) => ({
                    ...current,
                    unitPrice:
                      event.target
                        .value,
                  })
                )
              }
            />

            <span>RON</span>
          </div>
        </label>

        <label>
          <span>
            Transport
          </span>

          <div
            className={
              styles.quoteMoneyInput
            }
          >
            <input
              type="number"
              min="0"
              step="0.01"
              value={
                form.shippingPrice
              }
              required
              onChange={(event) =>
                setForm(
                  (current) => ({
                    ...current,
                    shippingPrice:
                      event.target
                        .value,
                  })
                )
              }
            />

            <span>RON</span>
          </div>
        </label>

        <label>
          <span>
            Termen producție
          </span>

          <div
            className={
              styles.quoteDaysInput
            }
          >
            <input
              type="number"
              min="1"
              step="1"
              value={
                form.productionDays
              }
              required
              onChange={(event) =>
                setForm(
                  (current) => ({
                    ...current,
                    productionDays:
                      event.target
                        .value,
                  })
                )
              }
            />

            <span>zile</span>
          </div>
        </label>
      </div>

      <label
        className={
          styles.quoteNotesLabel
        }
      >
        <span>
          Observații pentru client
        </span>

        <textarea
          rows={4}
          value={form.notes}
          placeholder="Ex: prețul include personalizarea și ambalarea..."
          onChange={(event) =>
            setForm(
              (current) => ({
                ...current,
                notes:
                  event.target
                    .value,
              })
            )
          }
        />
      </label>

      <div
        className={
          styles.quoteOfferSummary
        }
      >
        <span>
          Produse:
          <strong>
            {productsTotal.toFixed(
              2
            )}{" "}
            RON
          </strong>
        </span>

        <span>
          Transport:
          <strong>
            {shippingPrice.toFixed(
              2
            )}{" "}
            RON
          </strong>
        </span>

        <span>
          Total:
          <strong>
            {finalTotal.toFixed(
              2
            )}{" "}
            RON
          </strong>
        </span>
      </div>

      {error && (
        <div
          className={
            styles.quoteOfferError
          }
        >
          {error}
        </div>
      )}

      <div
        className={
          styles.quoteOfferActions
        }
      >
        <button
          type="button"
          className={
            styles.quoteSecondaryBtn
          }
          disabled={sending}
          onClick={onCancel}
        >
          Renunță
        </button>

        <button
          type="submit"
          className={
            styles.quotePrimaryBtn
          }
          disabled={sending}
        >
          {sending ? (
            <>
              <Loader2
                size={16}
                className={
                  styles.spin
                }
              />

              Se trimite…
            </>
          ) : (
            <>
              <Send size={16} />
              Trimite oferta
            </>
          )}
        </button>
      </div>
    </form>
  );
}
