// frontend/src/pages/User/Orders/components/OrderCard.jsx

import React, {
  memo,
  useMemo,
} from "react";

import {
  Link,
  useNavigate,
} from "react-router-dom";

import {
  MessageSquare,
} from "lucide-react";

import styles from "../Orders.module.css";
import { humanizeOptionValue } from "../../../../utils/optionLabels";

const STATUS_LABEL = {
  PENDING: "În așteptare",
  PROCESSING:
    "În procesare la artizani",
  SHIPPED:
    "Predată curierului",
  DELIVERED: "Livrată",
  CANCELED: "Anulată",
  RETURNED: "Returnată",
};

function shortId(id = "") {
  if (id.length <= 8) {
    return id;
  }

  return `${id.slice(
    0,
    4
  )}…${id.slice(-4)}`;
}

function money(
  cents = 0,
  currency = "RON"
) {
  const val =
    (Number(cents) || 0) /
    100;

  return new Intl.NumberFormat(
    "ro-RO",
    {
      style: "currency",
      currency,
    }
  ).format(val);
}

function getObjectEntries(
  value
) {
  if (
    !value ||
    typeof value !==
      "object" ||
    Array.isArray(value)
  ) {
    return [];
  }

  return Object.entries(
    value
  ).filter(
    ([, itemValue]) => {
      if (
        itemValue === null ||
        itemValue ===
          undefined
      ) {
        return false;
      }

      if (
        typeof itemValue ===
        "string"
      ) {
        return (
          itemValue.trim() !==
          ""
        );
      }

      return true;
    }
  );
}

function readableValue(
  value
) {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  if (Array.isArray(value)) {
    return value
      .map(
        readableValue
      )
      .filter(Boolean)
      .join(", ");
  }

  if (
    typeof value ===
    "object"
  ) {
    return humanizeOptionValue(
      value.label ||
      value.value ||
      value.name ||
      JSON.stringify(value)
    );
  }

  return humanizeOptionValue(String(value));
}

function readableLabel(key) {
  return String(key || "")
    .replace(
      /[_-]+/g,
      " "
    )
    .replace(
      /\b\w/g,
      (letter) =>
        letter.toUpperCase()
    );
}

function OrderCardBase({
  order,
  onCancel,
  onReorder,
  onContact,
  onReturn,
  busy,
}) {
  const navigate =
    useNavigate();

  const canCancel =
    !!order.cancellable;

  const canReorder =
    order.status !==
    "CANCELED";

  const canReturn =
    !!order.returnEligible &&
    order.status ===
      "DELIVERED";
const deposit =
  order?.deposit ||
  null;

const hasPendingDeposit =
  deposit?.status ===
    "PENDING";

const hasPaidDeposit =
  deposit?.status ===
    "PAID";
  const createdLabel =
    useMemo(() => {
      const created =
        new Date(
          order.createdAt
        );

      return created.toLocaleString(
        "ro-RO",
        {
          dateStyle:
            "medium",
          timeStyle:
            "short",
        }
      );
    }, [order.createdAt]);

 const goToDetails = () => {
  navigate(
    hasPendingDeposit
      ? `/comanda/${order.id}#avans`
      : `/comanda/${order.id}`
  );
};

  const isCompany =
    order.customerType ===
    "PJ";

  const addr =
    order.shippingAddress ||
    {};

  const companyName =
    addr.companyName;

  const items =
    Array.isArray(
      order.items
    )
      ? order.items
      : [];

  const visibleItems =
    items.slice(0, 3);

  const remaining =
    Math.max(
      0,
      items.length -
        visibleItems.length
    );

  return (
    <article
      className={
        styles.card
      }
      role="button"
      tabIndex={0}
      onClick={
        goToDetails
      }
      onKeyDown={(e) => {
        if (
          e.key ===
            "Enter" ||
          e.key === " "
        ) {
          e.preventDefault();

          goToDetails();
        }
      }}
    >
      <header
        className={
          styles.cardHead
        }
      >
        <div
          className={
            styles.cardHeadLeft
          }
        >
          <div
            className={
              styles.orderId
            }
          >
            #
            {order.orderNumber ||
              shortId(
                order.id
              )}
          </div>

          <div
            className={
              styles.dot
            }
          />

          <div
            className={`${styles.badge} ${
              styles[
                `st_${order.status}`
              ]
            }`}
          >
            {STATUS_LABEL[
              order.status
            ] ||
              order.status}
          </div>

          {order
            ?.shippingStage
            ?.label && (
            <>
              <div
                className={
                  styles.dot
                }
              />

              <div
                className={
                  styles.subtle
                }
              >
                {
                  order
                    .shippingStage
                    .label
                }
              </div>
            </>
          )}

          <div
            className={
              styles.dot
            }
          />

          <div
            className={
              styles.date
            }
          >
            {createdLabel}
          </div>
        </div>

        <div
          className={
            styles.total
          }
        >
          Total:{" "}
          <b>
            {money(
              order.totalCents,
              order.currency
            )}
          </b>
        </div>
      </header>
{hasPendingDeposit && (
  <div
    style={{
      marginTop: 10,
      marginBottom: 10,
      padding: "12px 14px",
      borderRadius: 12,
      border:
        "1px solid rgba(190, 130, 25, 0.28)",
      background:
        "rgba(255, 186, 40, 0.08)",
    }}
  >
    <div
      style={{
        fontWeight: 800,
        marginBottom: 4,
      }}
    >
      ⚠️ Avans de achitat
    </div>

    <div
      className={
        styles.subtle
      }
    >
      Artizanul a solicitat
      {deposit?.percent != null
        ? ` un avans de ${deposit.percent}%`
        : " un avans"}
      {deposit?.requestedAmount != null
        ? ` · ${new Intl.NumberFormat(
            "ro-RO",
            {
              style: "currency",
              currency:
                order.currency ||
                "RON",
            }
          ).format(
            Number(
              deposit.requestedAmount
            )
          )}`
        : ""}
      .
    </div>

    <button
      type="button"
      className={
        styles.btnWarn
      }
      style={{
        marginTop: 8,
      }}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();

        navigate(
          `/comanda/${order.id}#avans`
        );
      }}
    >
      Vezi și achită avansul
    </button>
  </div>
)}
{hasPaidDeposit && (
  <div
    style={{
      marginTop: 10,
      marginBottom: 10,
      padding: "10px 12px",
      borderRadius: 10,
      border:
        "1px solid rgba(40, 130, 70, 0.2)",
      background:
        "rgba(40, 130, 70, 0.05)",
      fontWeight: 700,
    }}
  >
    ✓ Avans achitat
    {deposit?.paidAmount != null
      ? ` · ${new Intl.NumberFormat(
          "ro-RO",
          {
            style: "currency",
            currency:
              order.currency ||
              "RON",
          }
        ).format(
          Number(
            deposit.paidAmount
          )
        )}`
      : ""}
  </div>
)}

      {isCompany && (
        <div
          style={{
            marginTop: 4,
            marginBottom: 4,
          }}
        >
          <span
            className={
              styles.subtle
            }
          >
            Facturare pe
            firmă
            {companyName
              ? `: ${companyName}`
              : ""}
          </span>
        </div>
      )}

      <div
        className={
          styles.cardBody
        }
      >
        <ul
          className={
            styles.itemList
          }
        >
          {visibleItems.map(
            (it) => {
              const optionEntries =
                getObjectEntries(
                  it.selectedOptions
                );

              const customEntries =
                getObjectEntries(
                  it.customAnswers
                );

              const repeatedEntries =
                getObjectEntries(
                  it.repeatedGroupAnswers
                );

              return (
                <li
                  className={
                    styles.item
                  }
                  key={
                    it.id
                  }
                >
                  <Link
                    to={
                      it.productId
                        ? `/produs/${it.productId}`
                        : "#"
                    }
                    className={
                      styles.itemThumbLink
                    }
                    onClick={(
                      e
                    ) =>
                      e.stopPropagation()
                    }
                  >
                    <img
                      src={
                        it.image ||
                        "/placeholder.png"
                      }
                      alt={
                        it.title
                      }
                      className={
                        styles.thumb
                      }
                      loading="lazy"
                      decoding="async"
                    />
                  </Link>

                  <div
                    className={
                      styles.itemInfo
                    }
                  >
                    <Link
                      to={
                        it.productId
                          ? `/produs/${it.productId}`
                          : "#"
                      }
                      className={
                        styles.itemTitle
                      }
                      onClick={(
                        e
                      ) =>
                        e.stopPropagation()
                      }
                    >
                      {
                        it.title
                      }
                    </Link>

                    <div
                      className={
                        styles.itemMeta
                      }
                    >
                      Cantitate:{" "}
                      {
                        it.qty
                      }

                      {" · "}

                      {it.hasDiscount &&
                      Number(
                        it.originalPriceCents
                      ) >
                        Number(
                          it.priceCents
                        ) ? (
                        <>
                          <span
                            style={{
                              textDecoration:
                                "line-through",
                              opacity:
                                0.65,
                              marginRight:
                                6,
                            }}
                          >
                            {money(
                              it.originalPriceCents,
                              order.currency
                            )}
                          </span>

                          <strong>
                            {money(
                              it.priceCents,
                              order.currency
                            )}
                          </strong>

                          {Number(
                            it.discountPercent
                          ) >
                            0 && (
                            <span
                              className={
                                styles.badge
                              }
                              style={{
                                marginLeft:
                                  6,
                              }}
                            >
                              -
                              {
                                it.discountPercent
                              }
                              %
                            </span>
                          )}
                        </>
                      ) : (
                        <>
                          {money(
                            it.priceCents,
                            order.currency
                          )}
                        </>
                      )}
                    </div>

                    {optionEntries.length >
                      0 && (
                      <div
                        style={{
                          marginTop:
                            6,
                          fontSize:
                            12,
                          lineHeight:
                            1.45,
                        }}
                      >
                        {optionEntries.map(
                          ([
                            key,
                            value,
                          ]) => (
                            <div
                              key={`option-${key}`}
                            >
                              <strong>
                                {readableLabel(
                                  key
                                )}
                                :
                              </strong>{" "}
                              {readableValue(
                                value
                              )}
                            </div>
                          )
                        )}
                      </div>
                    )}

                    {customEntries.length >
                      0 && (
                      <div
                        style={{
                          marginTop:
                            6,
                          fontSize:
                            12,
                          lineHeight:
                            1.45,
                        }}
                      >
                        {customEntries.map(
                          ([
                            key,
                            value,
                          ]) => (
                            <div
                              key={`custom-${key}`}
                            >
                              <strong>
                                {readableLabel(
                                  key
                                )}
                                :
                              </strong>{" "}
                              {readableValue(
                                value
                              )}
                            </div>
                          )
                        )}
                      </div>
                    )}

                    {repeatedEntries.length >
                      0 && (
                      <div
                        style={{
                          marginTop:
                            8,
                          fontSize:
                            12,
                          lineHeight:
                            1.45,
                        }}
                      >
                        <div
                          style={{
                            fontWeight:
                              700,
                            marginBottom:
                              4,
                          }}
                        >
                          Pentru
                          fiecare
                          membru
                        </div>

                        {repeatedEntries.map(
                          ([
                            groupKey,
                            members,
                          ]) => {
                            if (
                              !Array.isArray(
                                members
                              )
                            ) {
                              return null;
                            }

                            return (
                              <div
                                key={`group-${groupKey}`}
                              >
                                {members.map(
                                  (
                                    member,
                                    memberIndex
                                  ) => {
                                    const entries =
                                      getObjectEntries(
                                        member
                                      );

                                    if (
                                      !entries.length
                                    ) {
                                      return null;
                                    }

                                    return (
                                      <div
                                        key={`${groupKey}-${memberIndex}`}
                                        style={{
                                          marginTop:
                                            6,
                                          paddingLeft:
                                            8,
                                          borderLeft:
                                            "2px solid rgba(0,0,0,0.08)",
                                        }}
                                      >
                                        <div
  style={{
    fontWeight: 700,
  }}
>
  Personalizare{" "}
  {memberIndex + 1}
</div>

                                        {entries.map(
                                          ([
                                            key,
                                            value,
                                          ]) => (
                                            <div
                                              key={`${groupKey}-${memberIndex}-${key}`}
                                            >
                                              {readableLabel(
                                                key
                                              )}
                                              :{" "}
                                              {readableValue(
                                                value
                                              )}
                                            </div>
                                          )
                                        )}
                                      </div>
                                    );
                                  }
                                )}
                              </div>
                            );
                          }
                        )}
                      </div>
                    )}
                  </div>
                </li>
              );
            }
          )}

          {remaining >
            0 && (
            <li
              className={
                styles.subtle
              }
              style={{
                padding:
                  "6px 0",
              }}
            >
              + {remaining}{" "}
              produse (vezi în
              detalii)
            </li>
          )}
        </ul>

        <div
          className={
            styles.cardBodyRight
          }
          onClick={(e) =>
            e.stopPropagation()
          }
        >
          <button
            type="button"
            className={
              styles.btnGhost
            }
            onClick={() =>
              onContact(
                order
              )
            }
            title="Scrie artizanului pentru această comandă"
          >
            <MessageSquare
              size={16}
              style={{
                marginRight:
                  4,
              }}
            />

            Contactează
            artizanul
          </button>
        </div>
      </div>

      <footer
        className={
          styles.actionsRow
        }
        onClick={(e) =>
          e.stopPropagation()
        }
      >
        <button
          type="button"
          className={
            styles.btnGhost
          }
          onClick={
            goToDetails
          }
        >
          Detalii comandă
        </button>

        {canReturn && (
          <button
            type="button"
            className={
              styles.btnGhost
            }
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();

              onReturn?.(
                order
              );
            }}
          >
            Retur
          </button>
        )}

        {canReorder && (
          <button
            type="button"
            className={
              styles.btnPrimary
            }
            disabled={
              busy
            }
            onClick={() =>
              onReorder(
                order.id
              )
            }
          >
            {busy
              ? "Se adaugă…"
              : "Comandă din nou"}
          </button>
        )}

        {canCancel && (
          <button
            type="button"
            className={
              styles.btnWarn
            }
            disabled={
              busy
            }
            onClick={() =>
              onCancel(
                order.id
              )
            }
          >
            {busy
              ? "Se anulează…"
              : "Anulează comanda"}
          </button>
        )}
      </footer>
    </article>
  );
}

export default memo(
  OrderCardBase
);