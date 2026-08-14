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

export default function ThankYou() {
  const [
    params,
  ] = useSearchParams();

  const {
    me,
  } = useAuth();

  const orderId =
    params.get("order");

  const orderNoFromUrl =
    params.get(
      "orderNo"
    );

  /*
   * Pentru comenzile guest,
   * Checkout-ul pune tokenul
   * în URL-ul /multumim.
   */
  const guestToken =
    params.get(
      "token"
    );

  const isGuest =
    !me &&
    Boolean(
      guestToken
    );

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
    orderId &&
    guestToken
      ? `/comanda-guest/${encodeURIComponent(
          orderId
        )}?token=${encodeURIComponent(
          guestToken
        )}`
      : null;

  const orderDetailsPath =
    me?.role === "VENDOR"
      ? ordersListPath
      : isGuest
        ? guestOrderPath || "/"
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
          const cached =
            sessionStorage.getItem(
              `orderNo:${orderId}`
            );

          if (cached) {
            return cached;
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

  React.useEffect(() => {
    if (!orderId) {
      return;
    }

    let cancelled =
      false;

    setLoading(
      true
    );

    (async () => {
      try {
        let data;

        /* ================================================
           USER AUTENTIFICAT
        ================================================ */

        if (me) {
          data =
            await api(
              `/api/user/orders/${encodeURIComponent(
                orderId
              )}`
            );
        }

        /* ================================================
           GUEST
        ================================================ */

        else if (
          guestToken
        ) {
          data =
            await api(
              `/api/guest/orders/${encodeURIComponent(
                orderId
              )}?token=${encodeURIComponent(
                guestToken
              )}`
            );
        }

        /* ================================================
           FĂRĂ ACCES
        ================================================ */

        else {
          throw new Error(
            "order_access_missing"
          );
        }

        /* =====================================================
           ITEMS
        ===================================================== */

        const items =
          Array.isArray(
            data?.items
          )
            ? data.items
            : [];

        /* =====================================================
           TOTAL
        ===================================================== */

        const total =
          Number(
            data?.total ||
              data?.totalPrice ||
              data?.totalAmount ||
              data?.grandTotal ||
              data?.finalTotal ||
              data?.amount ||
              data?.totals?.total ||
              data?.pricing?.total ||
              data?.order?.total ||
              data?.order?.totalPrice ||
              items.reduce(
                (
                  sum,
                  item
                ) => {
                  const price =
                    Number(
                      item?.price ||
                        item?.unitPrice ||
                        item?.product?.price ||
                        item?.productPrice ||
                        0
                    );

                  const quantity =
                    Number(
                      item?.quantity ||
                        item?.qty ||
                        1
                    );

                  return (
                    sum +
                    price *
                      quantity
                  );
                },
                0
              )
          );

        /* =====================================================
           CURRENCY
        ===================================================== */

        const currency =
          data?.currency ||
          "RON";

        /* =====================================================
           ORDER NUMBER
        ===================================================== */

        const orderNumber =
          data?.orderNumber ||
          orderNoFromUrl ||
          orderId;

        /* =====================================================
           PAYMENT STATE REAL DIN BACKEND
        ===================================================== */

        /*
         * În schema Prisma:
         *
         * paymentMethod:
         * COD | CARD
         */
        const paymentMethod =
          String(
            data?.paymentMethod ||
              ""
          )
            .trim()
            .toUpperCase();

        /*
         * Acesta este statusul REAL
         * al Order-ului din Prisma:
         *
         * PENDING
         * PAID
         * CANCELLED
         * FULFILLED
         */
        const orderStatus =
          String(
            data?.orderStatus ||
              ""
          )
            .trim()
            .toUpperCase();

        /*
         * Momentul în care Stripe
         * a confirmat plata.
         */
        const paidAt =
          data?.paidAt ||
          null;

        /* =====================================================
           DECIZIE PURCHASE
        ===================================================== */

        /*
         * COD:
         *
         * Considerăm Purchase în
         * momentul în care comanda
         * a fost plasată cu succes.
         */
        const isCodPurchase =
          paymentMethod ===
          "COD";

        /*
         * CARD:
         *
         * Nu raportăm Purchase doar
         * pentru că s-a creat comanda.
         *
         * Trebuie să existe dovadă
         * că plata a fost confirmată:
         *
         * - Order.status === PAID
         * SAU
         * - paidAt există.
         */
        const isPaidCardPurchase =
          paymentMethod ===
            "CARD" &&
          (
            orderStatus ===
              "PAID" ||
            Boolean(
              paidAt
            )
          );

        const shouldTrackPurchase =
          isCodPurchase ||
          isPaidCardPurchase;

        /* =====================================================
           PURCHASE
        ===================================================== */

        if (
          shouldTrackPurchase &&
          !purchaseTrackedRef.current
        ) {
          purchaseTrackedRef.current =
            true;

         trackPurchase({
  id:
    orderId,

  total,

  currency,

  items,
});

          console.log(
            "[PURCHASE] tracked",
            {
              orderId,
              orderNumber,
              total,
              currency,
              paymentMethod,
              orderStatus,
              paidAt,
            }
          );
        } else if (
          !purchaseTrackedRef.current
        ) {
          console.log(
            "[PURCHASE] not tracked",
            {
              orderId,
              orderNumber,
              total,
              currency,
              paymentMethod,
              orderStatus,
              paidAt,
            }
          );
        }

        /* =====================================================
           UI
        ===================================================== */

        if (
          !cancelled
        ) {
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
  }, [
    orderId,
    orderNoFromUrl,
    guestToken,
    me,
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
          Mulțumim pentru comandă! 🎉
        </h1>

        <p
          className={
            styles.thankYouLead
          }
        >
          Comanda ta a fost
          primită și a fost
          trimisă către
          magazinul(ele)
          vânzător.
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