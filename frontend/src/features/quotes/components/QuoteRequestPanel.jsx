// frontend/src/features/quotes/components/QuoteRequestPanel.jsx

/*
 * Extras 1:1 din Messages.jsx (frontend/src/pages/Vendor/Mesaje/Messages.jsx)
 * - cardul "CERERE DE OFERTĂ" afișat vendorului: produs, cantitate,
 * status, cerințele clientului, ultima ofertă (dacă există) și butonul
 * "Trimite ofertă"/"Trimite o ofertă nouă".
 *
 * Pur prezentațională (fără stare proprie, fără fetch) - identică cu
 * originalul din Messages.jsx, inclusiv clasele CSS (Messages.module.css,
 * NU o copie a stilurilor). Reutilizată acum și de mini-fereastra de
 * mesaje (MiniThread.jsx), ca să arate exact același card ca pagina
 * completă.
 */

import styles from "../../../pages/Vendor/Mesaje/Messages.module.css";
import { isConversationQuoteRequest, quoteRequestTitle } from "../conversationOffer.js";

export default function QuoteRequestPanel({
  quoteRequest,
  latestOffer,
  canSendOffer,
  onOpenOffer,
}) {
  // conversație fără cerere de ofertă: doar invitația de a trimite o ofertă
  if (!quoteRequest) {
    if (!canSendOffer) return null;

    return (
      <section className={styles.quotePanel}>
        <div className={styles.quotePanelInfo}>
          <div className={styles.quotePanelEyebrow}>Ofertă personalizată</div>
          <div className={styles.quotePanelMeta}>
            <span>Trimite-i clientului o ofertă direct din conversație. O poate accepta și plăti din Mesaje.</span>
          </div>
        </div>
        <button type="button" className={styles.quotePrimaryBtn} onClick={onOpenOffer}>
          Trimite ofertă
        </button>
      </section>
    );
  }

  const quantity =
    Number(
      quoteRequest?.quantity
    ) || 0;

  const productTitle =
    quoteRequestTitle(
      quoteRequest
    );

  const fromConversation =
    isConversationQuoteRequest(
      quoteRequest
    );

  const productImage =
    Array.isArray(
      quoteRequest?.product
        ?.images
    )
      ? quoteRequest.product
          .images[0] || null
      : null;

  const requestMessage =
    String(
      quoteRequest?.requestData
        ?.message || ""
    ).trim();

  const latestOfferStatus =
    String(
      latestOffer?.status ||
        ""
    )
      .trim()
      .toUpperCase();

  const latestOfferTotal =
    Number(
      latestOffer?.total
    );

  return (
    <section
      className={styles.quotePanel}
    >
      <div
        className={
          styles.quotePanelHead
        }
      >
        <div
          className={
            styles.quotePanelInfo
          }
        >
          <div
            className={
              styles.quotePanelEyebrow
            }
          >
            {fromConversation
              ? "Ofertă din conversație"
              : "Cerere de ofertă"}
          </div>

          <div
            className={
              styles.quotePanelTitle
            }
          >
            {productTitle}
          </div>

          <div
            className={
              styles.quotePanelMeta
            }
          >
            <span>
              Cantitate:{" "}
              <strong>
                {quantity}
              </strong>
            </span>

            <span>
              Status:{" "}
              <strong>
                {quoteRequest?.status ||
                  "SUBMITTED"}
              </strong>
            </span>
          </div>
        </div>

        {productImage && (
          <img
            className={
              styles.quoteProductImage
            }
            src={productImage}
            alt={productTitle}
          />
        )}
      </div>

      {requestMessage && (
        <div
          className={
            styles.quoteRequestText
          }
        >
          <strong>
            Cerințele clientului:
          </strong>

          <p>
            {requestMessage}
          </p>
        </div>
      )}

      {latestOffer && (
        <div
          className={
            styles.quoteExistingOffer
          }
        >
          <div>
            <strong>
              Ultima ofertă
            </strong>

            <span>
              {latestOfferStatus ||
                "SENT"}
            </span>
          </div>

          {Number.isFinite(
            latestOfferTotal
          ) && (
            <strong>
              {latestOfferTotal.toFixed(
                2
              )}{" "}
              {latestOffer?.currency ||
                "RON"}
            </strong>
          )}
        </div>
      )}

      {canSendOffer && (
        <button
          type="button"
          className={
            styles.quotePrimaryBtn
          }
          onClick={onOpenOffer}
        >
          {latestOffer
            ? "Trimite o ofertă nouă"
            : "Trimite ofertă"}
        </button>
      )}
    </section>
  );
}
