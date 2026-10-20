// frontend/src/pages/Checkout/ThankYou.jsx

import React from "react";

import {
  Link,
  useSearchParams,
} from "react-router-dom";

import styles from "./Checkout.module.css";

import {
  api,
} from "../../lib/api";

import {
  trackPurchase,
} from "../../../services/analytics.js";

import {
  useAuth,
} from "../Auth/Context/context.js";

import {
  CARD_CONFIRMATION_POLL,
  getGuestOrderPath,
  getOrderApiPath,
  getPurchaseDecision,
  getThankYouOrderAccess,
  shouldPollForCardConfirmation,
  trackPurchaseOnce,
} from "./thankYouPurchase.js";

const wait = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export default function ThankYou() {
  const [
    params,
  ] = useSearchParams();

  const {
    me,
    loading: authLoading,
  } = useAuth();

  const orderId =
    params.get("order");

  const orderNoFromUrl =
    params.get(
      "orderNo"
    );

  /*
   * Întoarcere din Stripe (success_url) - vezi payments/orchestrator.js.
   */
  const paymentReturn =
    params.get(
      "payment"
    );

  /*
   * Acces la comandă: tokenul guest din URL (pus de Checkout sau de
   * Stripe success_url) are prioritate; altfel sesiunea userului.
   */
  const access =
    React.useMemo(
      () =>
        getThankYouOrderAccess(
          params,
          me
        ),
      [params, me]
    );

  const isGuest =
    access?.kind ===
    "guest";

  /* =========================================================
     Linkuri
  ========================================================= */

  const ordersListPath =
    me?.role === "VENDOR"
      ? `/vendor/orders?tab=client${
          orderId
            ? `&order=${encodeURIComponent(
                orderId
              )}`
            : ""
        }`
      : "/comenzile-mele";

  const guestOrderPath =
    getGuestOrderPath(
      access
    );

  const orderDetailsPath =
    isGuest
      ? guestOrderPath || "/"
      : me?.role === "VENDOR"
        ? ordersListPath
        : orderId
          ? `/comanda/${encodeURIComponent(
              orderId
            )}`
          : "/comenzile-mele";

  /* =========================================================
     Număr comandă
  ========================================================= */

  const [
    displayNo,
    setDisplayNo,
  ] =
    React.useState(
      () => {
        if (
          orderNoFromUrl
        ) {
          return orderNoFromUrl;
        }

        if (orderId) {
          try {
            const cached =
              sessionStorage.getItem(
                `orderNo:${orderId}`
              );

            if (cached) {
              return cached;
            }
          } catch {
            // ignore
          }
        }

        return null;
      }
    );

  const [
    loading,
    setLoading,
  ] =
    React.useState(
      false
    );

  /*
   * Starea plății afișată clientului:
   * null | "cod" | "paid" | "confirming" | "pending"
   */
  const [
    paymentState,
    setPaymentState,
  ] =
    React.useState(
      null
    );

  /*
   * Protecție împotriva trimiterii
   * de două ori a Purchase în aceeași
   * montare a paginii.
   */
  const purchaseTrackedRef =
    React.useRef(
      false
    );

  /* =========================================================
     Tracking + încărcare comandă
  ========================================================= */

  const accessKey =
    access
      ? `${access.kind}:${access.orderId}:${access.token || ""}`
      : "";

  React.useEffect(() => {
    if (!orderId) {
      return;
    }

    /*
     * Userul revenit din Stripe: pagina se reîncarcă complet, iar
     * sesiunea se citește asincron - așteptăm, altfel cererea ar pleca
     * fără acces și achiziția nu ar mai fi raportată.
     */
    if (
      !access &&
      authLoading
    ) {
      return;
    }

    let cancelled =
      false;

    setLoading(
      true
    );

    (async () => {
      try {
        const path =
          getOrderApiPath(
            access
          );

        if (!path) {
          throw new Error(
            "order_access_missing"
          );
        }

        let data =
          await api(
            path
          );

        let decision =
          getPurchaseDecision(
            data
          );

        /*
         * CARD: Stripe a trimis clientul înapoi înaintea webhook-ului.
         * Reîncercăm de câteva ori până backend-ul confirmă plata -
         * Purchase se raportează DOAR cu plata confirmată.
         */
        let attempt = 0;

        while (
          !cancelled &&
          shouldPollForCardConfirmation(
            decision,
            {
              paymentReturn,
              attempt,
            }
          )
        ) {
          setPaymentState(
            "confirming"
          );

          await wait(
            CARD_CONFIRMATION_POLL.intervalMs
          );

          attempt += 1;

          if (cancelled) {
            return;
          }

          data =
            await api(
              path
            );

          decision =
            getPurchaseDecision(
              data
            );
        }

        if (cancelled) {
          return;
        }

        /* =====================================================
           PURCHASE - o singură dată per comandă
        ===================================================== */

        trackPurchaseOnce({
          orderId,
          data,
          trackedRef:
            purchaseTrackedRef,
          track:
            trackPurchase,
        });

        /* =====================================================
           UI
        ===================================================== */

        setPaymentState(
          decision.isCod
            ? "cod"
            : decision.isPaidCard
              ? "paid"
              : decision.isPendingCard
                ? "pending"
                : null
        );

        const orderNumber =
          data?.orderNumber ||
          orderNoFromUrl ||
          orderId;

        setDisplayNo(
          orderNumber
        );

        try {
          sessionStorage.setItem(
            `orderNo:${orderId}`,
            orderNumber
          );
        } catch {
          // ignore
        }
      } catch (
        error
      ) {
        console.warn(
          "ThankYou order load failed:",
          error
        );

        if (
          !cancelled
        ) {
          setDisplayNo(
            orderNoFromUrl ||
              orderId
          );
        }
      } finally {
        if (
          !cancelled
        ) {
          setLoading(
            false
          );
        }
      }
    })();

    return () => {
      cancelled =
        true;
    };
    // `access` e derivat din accessKey + me; accessKey e cheia stabilă
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    orderId,
    orderNoFromUrl,
    accessKey,
    authLoading,
    paymentReturn,
  ]);

  /* =========================================================
     Număr afișat
  ========================================================= */

  const shownNo =
    loading
      ? "..."
      : displayNo ||
        orderId ||
        "-";

  const cardPending =
    paymentState ===
      "confirming" ||
    paymentState ===
      "pending";

  /* =========================================================
     Render
  ========================================================= */

  return (
    <div
      className={
        styles.container
      }
    >
      <div
        className={
          styles.thankYouCard
        }
      >
        <h1
          className={
            styles.pageTitle
          }
        >
          {cardPending
            ? "Comanda ta a fost înregistrată"
            : "Mulțumim pentru comandă! 🎉"}
        </h1>

        <p
          className={
            styles.thankYouLead
          }
        >
          {cardPending
            ? "Așteptăm confirmarea plății cu cardul de la procesatorul de plăți."
            : "Comanda ta a fost primită și a fost trimisă către magazinul(ele) vânzător."}
        </p>

        {orderId && (
          <p
            className={
              styles.thankYouOrderRow
            }
          >
            <strong>
              Număr comandă:
            </strong>{" "}
            <code>
              {shownNo}
            </code>
          </p>
        )}

        {/* =================================================
            STARE PLATĂ CARD
        ================================================= */}

        {paymentState ===
          "paid" && (
          <p
            className={
              styles.muted
            }
            role="status"
          >
            Plata cu cardul a fost confirmată.
          </p>
        )}

        {paymentState ===
          "confirming" && (
          <p
            className={
              styles.muted
            }
            role="status"
            aria-live="polite"
          >
            Se confirmă plata… durează de obicei doar câteva secunde.
          </p>
        )}

        {paymentState ===
          "pending" && (
          <div
            role="status"
            style={{
              marginTop:
                14,

              padding:
                "12px 14px",

              borderRadius:
                10,

              background:
                "#fff8e7",

              border:
                "1px solid #f0d99b",

              fontSize:
                14,

              lineHeight:
                1.5,
            }}
          >
            Nu am primit încă confirmarea plății. Dacă plata a reușit,
            comanda se actualizează automat în câteva minute. Dacă nu, o
            poți finaliza din{" "}
            <Link
              to={
                orderDetailsPath
              }
            >
              pagina comenzii
            </Link>
            .
          </div>
        )}

        {/* =================================================
            GUEST
        ================================================= */}

        {isGuest ? (
          <>
            <div
              style={{
                marginTop:
                  18,

                padding:
                  "14px 16px",

                borderRadius:
                  12,

                background:
                  "#fffaf0",

                border:
                  "1px solid rgba(180,130,40,0.2)",

                lineHeight:
                  1.55,
              }}
            >
              <strong>
                Comandă plasată fără
                cont
              </strong>

              <p
                style={{
                  margin:
                    "7px 0 0",
                }}
              >
                Ți-am trimis pe
                email detaliile
                comenzii. Poți
                urmări comanda și
                fără să îți creezi
                cont Artfest.
              </p>

              <p
                style={{
                  margin:
                    "7px 0 0",

                  fontSize:
                    13,

                  opacity:
                    0.8,
                }}
              >
                Păstrează emailul
                primit: linkul din
                el îți oferă acces
                securizat la această
                comandă.
              </p>
            </div>

            <p
              className={
                styles.muted
              }
              style={{
                marginTop:
                  16,
              }}
            >
              Dacă artizanul îți
              solicită un avans,
              vei primi un email cu
              un link securizat de
              unde îl poți achita
              online.
            </p>
          </>
        ) : (
          /*
           * USER CU CONT
           */
          <p
            className={
              styles.muted
            }
            style={{
              marginTop:
                16,
            }}
          >
            Vei primi un email cu
            detaliile comenzii. Poți
            urmări statusul ei din
            secțiunea{" "}
            <Link
              to={
                ordersListPath
              }
            >
              „Comenzile mele”
            </Link>
            .
          </p>
        )}

        {/* =================================================
            ACȚIUNI
        ================================================= */}

        <div
          className={
            styles.thankYouActions
          }
        >
          {orderId &&
            orderDetailsPath && (
              <Link
                to={
                  orderDetailsPath
                }
                className={
                  styles.primaryBtn
                }
              >
                Vezi comanda
              </Link>
            )}

          <Link
            to="/produse"
            className={
              styles.secondaryBtn
            }
          >
            Continuă cumpărăturile
          </Link>
        </div>

        {isGuest && (
          <p
            className={
              styles.muted
            }
            style={{
              marginTop:
                14,

              fontSize:
                12,
            }}
          >
            Nu este necesar să te
            autentifici pentru a
            vedea această comandă.
          </p>
        )}
      </div>
    </div>
  );
}
