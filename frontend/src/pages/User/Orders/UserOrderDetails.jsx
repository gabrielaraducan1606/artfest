import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useParams,
  Link,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { api } from "../../../lib/api";
import {
  ArrowLeft,
  Loader2,
  Phone,
  Mail,
  MapPin,
  ExternalLink,
  MessageSquare,
} from "lucide-react";
import styles from "./Orders.module.css";

const ORDER_STATUS_LABEL = {
  PENDING: "În așteptare",
  PROCESSING: "În procesare",
  SHIPPED: "Predată curierului",
  DELIVERED: "Livrată",
  CANCELED: "Anulată",
  RETURNED: "Returnată",
};

const ORDER_STATUS_HELP = {
  PENDING:
    "Comanda a fost înregistrată și urmează să fie preluată de artizani.",
  PROCESSING:
    "Artizanii pregătesc produsele pentru livrare. Vei primi actualizări când pachetele sunt predate curierului.",
  SHIPPED:
    "Cel puțin un pachet a fost predat curierului. Poți urmări statusul din secțiunea Livrare & AWB.",
  DELIVERED:
    "Toate pachetele au fost marcate ca livrate. Sperăm să te bucuri de produse ❤️",
  CANCELED:
    "Comanda a fost anulată. Dacă ai întrebări, contactează-ne pe suport.",
  RETURNED:
    "Comanda a fost returnată / nelivrată. Verifică inbox-ul pentru detalii sau contactează suportul.",
};

const SHIPMENT_STATUS_LABEL = {
  PENDING: "Nouă",
  PREPARING: "În pregătire",
  READY_FOR_PICKUP: "Confirmată pentru predare",
  PICKUP_SCHEDULED: "Ridicare programată",
  AWB: "AWB generat",
  IN_TRANSIT: "În livrare",
  DELIVERED: "Livrată",
  RETURNED: "Returnată / Anulată",
};

const SHIPMENT_STATUS_HELP = {
  PENDING: "Pachetul a fost înregistrat de către artizan.",
  PREPARING: "Artizanul pregătește produsele pentru acest pachet.",
  READY_FOR_PICKUP:
    "Pachetul este gata și urmează să fie preluat de curier.",
  PICKUP_SCHEDULED:
    "Preluarea de la artizan a fost programată. În scurt timp pachetul intră în livrare.",
  AWB:
    "AWB-ul a fost generat, pachetul urmează să fie preluat de curier.",
  IN_TRANSIT:
    "Pachetul este pe drum către tine.",
  DELIVERED:
    "Pachetul a fost livrat.",
  RETURNED:
    "Pachetul a fost returnat sau livrarea a eșuat.",
};

function money(cents = 0, currency = "RON") {
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

function formatDate(d) {
  try {
    const dt =
      new Date(d);

    return new Intl.DateTimeFormat(
      "ro-RO",
      {
        dateStyle: "medium",
        timeStyle: "short",
      }
    ).format(dt);
  } catch {
    return d || "";
  }
}

function moneyAmount(
  amount = 0,
  currency = "RON"
) {
  return new Intl.NumberFormat(
    "ro-RO",
    {
      style: "currency",
      currency,
    }
  ).format(
    Number(
      amount || 0
    )
  );
}

function getDepositStatusLabel(
  status
) {
  switch (status) {
    case "PENDING":
      return "Avans de achitat";

    case "PAID":
      return "Avans achitat";

    case "EXPIRED":
      return "Solicitare expirată";

    case "FAILED":
      return "Plata nu a fost finalizată";

    default:
      return "";
  }
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
        itemValue ===
          null ||
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

  if (
    Array.isArray(value)
  ) {
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
    return (
      value.label ||
      value.value ||
      value.name ||
      JSON.stringify(
        value
      )
    );
  }

  return String(value);
}

function readableLabel(
  key
) {
  return String(
    key || ""
  )
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

function isCustomizationImage(
  value
) {
  if (
    typeof value !==
    "string"
  ) {
    return false;
  }

  const url =
    value.trim();

  if (!url) {
    return false;
  }

  return (
    /^(https?:\/\/|data:image\/|blob:)/i.test(
      url
    ) ||
    url.includes(
      "/customizations/"
    ) ||
    /\.(jpg|jpeg|png|webp|gif|heic|heif|bmp|tiff|avif)(\?.*)?$/i.test(
      url
    )
  );
}

function ProductConfiguration({
  item,
  onPreviewImage,
}) {
  const optionEntries =
    getObjectEntries(
      item
        ?.selectedOptions
    );

  const customEntries =
    getObjectEntries(
      item
        ?.customAnswers
    );

  const repeatedEntries =
    getObjectEntries(
      item
        ?.repeatedGroupAnswers
    );

  const hasAny =
    optionEntries.length >
      0 ||
    customEntries.length >
      0 ||
    repeatedEntries.length >
      0;

  if (!hasAny) {
    return null;
  }

  return (
    <div
      style={{
        marginTop: 8,
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      {optionEntries.length >
        0 && (
        <div>
          <strong>
            Opțiuni
          </strong>

          {optionEntries.map(
            (
              [
                key,
                value,
              ]
            ) => (
              <div
                key={`option-${key}`}
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
      )}

      {customEntries.length >
        0 && (
        <div
          style={{
            marginTop:
              optionEntries.length
                ? 6
                : 0,
          }}
        >
          <strong>
            Personalizare
          </strong>

          {customEntries.map(
            (
              [
                key,
                value,
              ]
            ) => {
              const imageValue =
                isCustomizationImage(
                  value
                );

              return (
                <div
                  key={`custom-${key}`}
                  style={
                    imageValue
                      ? {
                          display:
                            "flex",
                          alignItems:
                            "center",
                          gap: 8,
                          marginTop:
                            4,
                        }
                      : undefined
                  }
                >
                  <span>
                    {readableLabel(
                      key
                    )}
                    :
                  </span>

                  {imageValue ? (
                    <button
                      type="button"
                      onClick={() =>
                        onPreviewImage?.(
                          value
                        )
                      }
                      aria-label={`Deschide poza pentru ${readableLabel(
                        key
                      )}`}
                      title="Deschide poza"
                      style={{
                        display:
                          "inline-flex",
                        alignItems:
                          "center",
                        justifyContent:
                          "center",
                        padding: 0,
                        border: 0,
                        background:
                          "transparent",
                        cursor:
                          "zoom-in",
                        borderRadius:
                          8,
                      }}
                    >
                      <img
                        src={
                          value
                        }
                        alt={`Personalizare ${readableLabel(
                          key
                        )}`}
                        style={{
                          width:
                            54,
                          height:
                            54,
                          objectFit:
                            "cover",
                          borderRadius:
                            8,
                          border:
                            "1px solid #e5e7eb",
                          display:
                            "block",
                        }}
                      />
                    </button>
                  ) : (
                    <>
                      {" "}
                      {readableValue(
                        value
                      )}
                    </>
                  )}
                </div>
              );
            }
          )}
        </div>
      )}

      {repeatedEntries.length >
        0 && (
        <div
          style={{
            marginTop:
              optionEntries.length ||
              customEntries.length
                ? 8
                : 0,
          }}
        >
          <strong>
            Detalii personalizare
          </strong>

          {repeatedEntries.map(
            (
              [
                groupKey,
                members,
              ]
            ) => {
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
                            padding:
                              "7px 9px",
                            border:
                              "1px solid rgba(0,0,0,0.08)",
                            borderRadius:
                              8,
                          }}
                        >
                          <div
                            style={{
                              fontWeight:
                                700,
                              marginBottom:
                                3,
                            }}
                          >
                            Personalizare{" "}
                            {memberIndex +
                              1}
                          </div>

                          {entries.map(
                            (
                              [
                                key,
                                value,
                              ]
                            ) => {
                              const imageValue =
                                isCustomizationImage(
                                  value
                                );

                              return (
                                <div
                                  key={`${groupKey}-${memberIndex}-${key}`}
                                  style={
                                    imageValue
                                      ? {
                                          display:
                                            "flex",
                                          alignItems:
                                            "center",
                                          gap: 8,
                                          marginTop:
                                            4,
                                        }
                                      : undefined
                                  }
                                >
                                  <span>
                                    {readableLabel(
                                      key
                                    )}
                                    :
                                  </span>

                                  {imageValue ? (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        onPreviewImage?.(
                                          value
                                        )
                                      }
                                      aria-label={`Deschide poza pentru ${readableLabel(
                                        key
                                      )}`}
                                      title="Deschide poza"
                                      style={{
                                        display:
                                          "inline-flex",
                                        alignItems:
                                          "center",
                                        justifyContent:
                                          "center",
                                        padding:
                                          0,
                                        border:
                                          0,
                                        background:
                                          "transparent",
                                        cursor:
                                          "zoom-in",
                                        borderRadius:
                                          8,
                                      }}
                                    >
                                      <img
                                        src={
                                          value
                                        }
                                        alt={`Personalizare ${readableLabel(
                                          key
                                        )}`}
                                        style={{
                                          width:
                                            54,
                                          height:
                                            54,
                                          objectFit:
                                            "cover",
                                          borderRadius:
                                            8,
                                          border:
                                            "1px solid #e5e7eb",
                                          display:
                                            "block",
                                        }}
                                      />
                                    </button>
                                  ) : (
                                    <>
                                      {" "}
                                      {readableValue(
                                        value
                                      )}
                                    </>
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
              );
            }
          )}
        </div>
      )}
    </div>
  );
}

export default function MyOrderDetailsPage() {
  const { id } =
    useParams();

  const nav =
    useNavigate();

  const [
    searchParams,
  ] =
    useSearchParams();

  const paymentResult =
    String(
      searchParams.get(
        "payment"
      ) || ""
    )
      .trim()
      .toLowerCase();

  const [
    order,
    setOrder,
  ] =
    useState(null);

  const [
    loading,
    setLoading,
  ] =
    useState(true);

  const [
    err,
    setErr,
  ] =
    useState("");

  const [
    busyAction,
    setBusyAction,
  ] =
    useState(null);

  const [
    busyDepositShipmentId,
    setBusyDepositShipmentId,
  ] =
    useState(null);

  const [
    busyPayment,
    setBusyPayment,
  ] =
    useState(false);

  const [
    imagePreview,
    setImagePreview,
  ] =
    useState(null);

  useEffect(() => {
    if (
      !imagePreview
    ) {
      return;
    }

    const previousOverflow =
      document.body.style
        .overflow;

    const handleKeyDown =
      (event) => {
        if (
          event.key ===
          "Escape"
        ) {
          setImagePreview(
            null
          );
        }
      };

    document.body.style.overflow =
      "hidden";

    window.addEventListener(
      "keydown",
      handleKeyDown
    );

    return () => {
      document.body.style.overflow =
        previousOverflow;

      window.removeEventListener(
        "keydown",
        handleKeyDown
      );
    };
  }, [
    imagePreview,
  ]);

  const load =
    useCallback(
      async () => {
        setLoading(
          true
        );

        setErr("");

        try {
          const res =
            await api(
              `/api/user/orders/${encodeURIComponent(
                id
              )}`
            );

          setOrder(
            res
          );
        } catch (
          e
        ) {
          setErr(
            e?.message ||
              "Nu am putut încărca comanda."
          );
        } finally {
          setLoading(
            false
          );
        }
      },
      [
        id,
      ]
    );

  useEffect(() => {
    load();
  }, [
    load,
  ]);

  const items =
    useMemo(
      () =>
        Array.isArray(
          order?.items
        )
          ? order.items
          : [],
      [
        order,
      ]
    );

  const shipments =
    useMemo(
      () =>
        Array.isArray(
          order?.shipments
        )
          ? order.shipments
          : [],
      [
        order,
      ]
    );

  const addr =
    order
      ?.shippingAddress ||
    {};

  const shipmentBlocks =
    useMemo(() => {
      if (
        !shipments.length
      ) {
        return [];
      }

      return shipments.map(
        (
          shipment,
          index
        ) => {
          const shipmentItems =
            items.filter(
              (
                item
              ) =>
                item.shipmentId ===
                shipment.id
            );

          const itemsTotalCents =
            shipmentItems.reduce(
              (
                sum,
                item
              ) =>
                sum +
                (
                  Number(
                    item.priceCents
                  ) ||
                  0
                ) *
                  (
                    Number(
                      item.qty
                    ) ||
                    0
                  ),
              0
            );

          return {
            ...shipment,

            index:
              index +
              1,

            items:
              shipmentItems,

            itemsTotalCents,
          };
        }
      );
    }, [
      shipments,
      items,
    ]);

  const hasMultipleShipments =
    shipmentBlocks.length >
    1;

  const canCancel =
    Boolean(
      order
        ?.cancellable
    );

  const canReorder =
    Boolean(
      order
    ) &&
    order.status !==
      "CANCELED";

  const paymentMethod =
    String(
      order
        ?.paymentMethod ||
        ""
    )
      .trim()
      .toUpperCase();

  const paymentStatus =
    String(
      order
        ?.paymentStatus ||
        ""
    )
      .trim()
      .toUpperCase();

  const isCardPayment =
    paymentMethod ===
    "CARD";

  const isPaid =
    paymentStatus ===
      "PAID" ||
    Boolean(
      order?.paidAt
    );

  const paymentPending =
    isCardPayment &&
    !isPaid;

  const canRetryPayment =
    paymentPending &&
    order
      ?.canRetryPayment ===
      true;

  async function handleCancel() {
    if (
      !order ||
      !canCancel
    ) {
      return;
    }

    if (
      !window.confirm(
        "Sigur vrei să anulezi această comandă?"
      )
    ) {
      return;
    }

    setBusyAction(
      "cancel"
    );

    try {
      await api(
        `/api/user/orders/${order.id}/cancel`,
        {
          method:
            "POST",
        }
      );

      await load();
    } catch (
      e
    ) {
      alert(
        e?.message ||
          "Nu am putut anula comanda."
      );
    } finally {
      setBusyAction(
        null
      );
    }
  }

  async function handleReorder() {
    if (
      !order
    ) {
      return;
    }

    setBusyAction(
      "reorder"
    );

    try {
      const response =
        await api(
          `/api/user/orders/${order.id}/reorder`,
          {
            method:
              "POST",
          }
        );

      window.dispatchEvent(
        new CustomEvent(
          "cart:changed"
        )
      );

      try {
        sessionStorage.removeItem(
          "cart:ui-cache:v1"
        );

        sessionStorage.removeItem(
          "cart:ui-cache:v2"
        );
      } catch {
        // ignore
      }

      const message =
        response?.message ||
        "Produsele au fost adăugate în coș.";

      if (
        window.confirm(
          `${message}\n\nDeschizi coșul?`
        )
      ) {
        window.location.href =
          "/cos";
      }
    } catch (
      error
    ) {
      const message =
        error?.data
          ?.message ||
        error?.response
          ?.data?.message ||
        error?.message ||
        "Nu am putut re-comanda. Unele produse ar putea să nu mai fie disponibile.";

      alert(message);
    } finally {
      setBusyAction(
        null
      );
    }
  }

  async function handlePayOrder() {
    if (
      !order?.id ||
      busyPayment
    ) {
      return;
    }

    if (
      !canRetryPayment
    ) {
      alert(
        isPaid
          ? "Această comandă este deja achitată."
          : "Plata nu poate fi reluată în starea actuală."
      );

      return;
    }

    try {
      setBusyPayment(
        true
      );

      const response =
        await api(
          `/api/user/orders/${encodeURIComponent(
            order.id
          )}/payment`,
          {
            method:
              "POST",
          }
        );

      const redirectUrl =
        response
          ?.payment
          ?.redirectUrl ||
        response
          ?.payment
          ?.url ||
        null;

      if (
        !redirectUrl
      ) {
        throw new Error(
          "Nu am primit linkul pentru plată."
        );
      }

      window.location.assign(
        redirectUrl
      );
    } catch (
      error
    ) {
      console.error(
        "Retry order payment failed:",
        error
      );

      const message =
        error?.data
          ?.message ||
        error?.response
          ?.data
          ?.message ||
        error?.message ||
        "Nu am putut deschide plata.";

      alert(message);

      await load();
    } finally {
      setBusyPayment(
        false
      );
    }
  }

  async function handlePayDeposit(
    shipment
  ) {
    if (
      !order?.id ||
      !shipment?.id
    ) {
      return;
    }

    const deposit =
      shipment.deposit;

    if (
      !deposit ||
      deposit.status !==
        "PENDING"
    ) {
      alert(
        "Acest avans nu mai este disponibil pentru plată."
      );

      return;
    }

    if (
      deposit.payable ===
      false
    ) {
      alert(
        "Solicitarea de avans a expirat sau nu mai poate fi achitată."
      );

      await load();

      return;
    }

    try {
      setBusyDepositShipmentId(
        shipment.id
      );

      const response =
        await api(
          `/api/user/orders/${encodeURIComponent(
            order.id
          )}/shipments/${encodeURIComponent(
            shipment.id
          )}/pay-deposit`,
          {
            method:
              "POST",
          }
        );

      const checkoutUrl =
        response?.url;

      if (
        !checkoutUrl
      ) {
        throw new Error(
          "Nu am primit linkul pentru plata avansului."
        );
      }

      window.location.assign(
        checkoutUrl
      );
    } catch (
      error
    ) {
      console.error(
        "Pay deposit failed:",
        error
      );

      const message =
        error?.data
          ?.message ||
        error?.response
          ?.data
          ?.message ||
        error?.message ||
        "Nu am putut deschide plata avansului.";

      alert(message);

      await load();
    } finally {
      setBusyDepositShipmentId(
        null
      );
    }
  }

  async function contactVendorForShipment(
    shipment
  ) {
    if (
      !shipment.vendorId
    ) {
      alert(
        "Nu am putut identifica artizanul pentru acest pachet. Te rugăm contactează suportul."
      );

      return;
    }

    try {
      const res =
        await api(
          "/api/user-inbox/ensure-thread",
          {
            method:
              "POST",

            body: {
              vendorId:
                shipment.vendorId,
            },
          }
        );

      const threadId =
        res?.threadId;

      if (
        !threadId
      ) {
        throw new Error(
          "Nu am primit ID-ul conversației."
        );
      }

      window.location.href =
        `/cont/mesaje?thread=${encodeURIComponent(
          threadId
        )}`;
    } catch (
      e
    ) {
      console.error(
        e
      );

      alert(
        e?.message ||
          "Nu am putut deschide conversația cu artizanul. Încearcă din nou sau contactează suportul."
      );
    }
  }

  if (
    loading
  ) {
    return (
      <main
        className={
          styles.page
        }
      >
        <div
          className={
            styles.card
          }
        >
          <Loader2
            className={
              styles.spin
            }
          />{" "}
          Se încarcă…
        </div>
      </main>
    );
  }

  if (
    err
  ) {
    return (
      <main
        className={
          styles.page
        }
      >
        <div
          className={
            styles.card
          }
        >
          <p
            className={
              styles.error
            }
          >
            {err}
          </p>

          <button
            className={
              styles.btnGhost
            }
            onClick={() =>
              nav(-1)
            }
          >
            <ArrowLeft
              size={16}
            />{" "}
            Înapoi
          </button>
        </div>
      </main>
    );
  }

  if (
    !order
  ) {
    return null;
  }

  const mainStatusLabel =
    ORDER_STATUS_LABEL[
      order.status
    ] ||
    order.status;

  const mainStatusHelp =
    ORDER_STATUS_HELP[
      order.status
    ] ||
    "Vezi mai jos detaliile pe pachete și informațiile de livrare.";

  const isCompany =
    order.customerType ===
    "PJ";

      return (
    <main
      className={
        styles.page
      }
    >
      <div
        className={
          styles.head
        }
      >
        <div>
          <h1
            className={
              styles.h1
            }
          >
            Detalii comandă{" "}
            <span
              style={{
                fontWeight:
                  400,
              }}
            >
              #
              {order.orderNumber ||
                order.id.slice(
                  0,
                  8
                ) +
                  "…"}
            </span>
          </h1>

          <p
            className={
              styles.subtle
            }
          >
            Plasată la{" "}
            {formatDate(
              order.createdAt
            )}
          </p>

          <div
            style={{
              marginTop: 8,
              display:
                "flex",
              flexDirection:
                "column",
              gap: 4,
            }}
          >
            <span
              className={`${styles.badge} ${
                styles[
                  `st_${order.status}`
                ] || ""
              }`}
            >
              {
                mainStatusLabel
              }
            </span>

            <span
              className={
                styles.subtle
              }
            >
              {
                mainStatusHelp
              }
            </span>
          </div>
        </div>

        <div
          style={{
            display:
              "flex",
            flexDirection:
              "column",
            gap: 8,
            alignItems:
              "flex-end",
          }}
        >
          <button
            className={
              styles.btnGhost
            }
            onClick={() =>
              nav(-1)
            }
            type="button"
          >
            <ArrowLeft
              size={16}
            />{" "}
            Înapoi la listă
          </button>

          <div
            style={{
              display:
                "flex",
              gap: 8,
              flexWrap:
                "wrap",
            }}
          >
            {canReorder && (
              <button
                type="button"
                className={
                  styles.btnPrimary
                }
                onClick={
                  handleReorder
                }
                disabled={
                  busyAction ===
                  "reorder"
                }
              >
                {busyAction ===
                "reorder" ? (
                  <>
                    <Loader2
                      size={
                        16
                      }
                      className={
                        styles.spin
                      }
                    />{" "}
                    Se adaugă…
                  </>
                ) : (
                  "Comandă din nou"
                )}
              </button>
            )}

            {canCancel && (
              <button
                type="button"
                className={
                  styles.btnWarn
                }
                onClick={
                  handleCancel
                }
                disabled={
                  busyAction ===
                  "cancel"
                }
              >
                {busyAction ===
                "cancel" ? (
                  <>
                    <Loader2
                      size={
                        16
                      }
                      className={
                        styles.spin
                      }
                    />{" "}
                    Se anulează…
                  </>
                ) : (
                  "Anulează comanda"
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      {paymentResult ===
        "cancelled" &&
        paymentPending && (
          <div
            className={
              styles.card
            }
            style={{
              marginBottom:
                12,
              border:
                "1px solid rgba(180, 120, 20, 0.28)",
              background:
                "rgba(190, 140, 40, 0.07)",
            }}
          >
            <strong>
              Plata nu a fost finalizată.
            </strong>

            <p
              className={
                styles.subtle
              }
              style={{
                margin:
                  "6px 0 0",
              }}
            >
              Comanda ta a fost
              păstrată. O poți
              achita oricând
              folosind butonul
              „Achită acum”.
            </p>
          </div>
        )}

      {paymentResult ===
        "success" &&
        isCardPayment && (
          <div
            className={
              styles.card
            }
            style={{
              marginBottom:
                12,
            }}
          >
            {isPaid ? (
              <>
                <strong>
                  Plata a fost
                  confirmată.
                </strong>

                <p
                  className={
                    styles.subtle
                  }
                  style={{
                    margin:
                      "6px 0 0",
                  }}
                >
                  Comanda este
                  achitată și poate
                  fi procesată de
                  artizan.
                </p>
              </>
            ) : (
              <>
                <strong>
                  Verificăm plata…
                </strong>

                <p
                  className={
                    styles.subtle
                  }
                  style={{
                    margin:
                      "6px 0 0",
                  }}
                >
                  Plata a fost
                  trimisă spre
                  confirmare. Dacă
                  statusul nu se
                  actualizează
                  imediat, reîncarcă
                  pagina.
                </p>
              </>
            )}
          </div>
        )}

      {isCardPayment && (
        <section
          className={
            styles.card
          }
          style={{
            marginBottom:
              12,
          }}
        >
          <div
            style={{
              display:
                "flex",
              justifyContent:
                "space-between",
              alignItems:
                "flex-start",
              gap: 16,
              flexWrap:
                "wrap",
            }}
          >
            <div>
              <h3
                style={{
                  marginTop:
                    0,
                  marginBottom:
                    6,
                }}
              >
                Plata comenzii
              </h3>

              <div
                className={
                  styles.itemMeta
                }
              >
                Metodă de
                plată:{" "}
                <strong>
                  Card online
                </strong>
              </div>

              <div
                className={
                  styles.itemMeta
                }
                style={{
                  marginTop:
                    4,
                }}
              >
                Status
                plată:{" "}
                <strong>
                  {isPaid
                    ? "Plătită"
                    : "Plată în așteptare"}
                </strong>
              </div>

              {isPaid &&
                order?.paidAt && (
                  <div
                    className={
                      styles.subtle
                    }
                    style={{
                      marginTop:
                        6,
                    }}
                  >
                    Achitată la{" "}
                    {formatDate(
                      order.paidAt
                    )}
                  </div>
                )}

              {paymentPending && (
                <p
                  className={
                    styles.subtle
                  }
                  style={{
                    margin:
                      "10px 0 0",
                    maxWidth:
                      620,
                  }}
                >
                  Plata online nu
                  a fost încă
                  finalizată.
                  Comanda este
                  păstrată și o
                  poți achita
                  folosind butonul
                  de mai jos.
                </p>
              )}
            </div>

            {canRetryPayment && (
              <button
                type="button"
                className={
                  styles.btnPrimary
                }
                onClick={
                  handlePayOrder
                }
                disabled={
                  busyPayment
                }
              >
                {busyPayment ? (
                  <>
                    <Loader2
                      size={
                        16
                      }
                      className={
                        styles.spin
                      }
                      style={{
                        marginRight:
                          6,
                      }}
                    />
                    Se deschide
                    plata…
                  </>
                ) : (
                  "Achită acum"
                )}
              </button>
            )}
          </div>
        </section>
      )}

      {hasMultipleShipments && (
        <div
          className={
            styles.card
          }
          style={{
            marginBottom:
              12,
          }}
        >
          <p
            className={
              styles.subtle
            }
          >
            Această comandă este
            livrată în{" "}
            <strong>
              {
                shipmentBlocks.length
              }{" "}
              pachete
            </strong>
            . Fiecare pachet poate
            avea un status de
            livrare diferit.
          </p>
        </div>
      )}

      <div
        className={
          styles.list
        }
        style={{
          marginBottom:
            12,
        }}
      >
        <section
          className={
            styles.card
          }
        >
          <h3>
            Adresă de livrare
          </h3>

          <div
            className={
              styles.itemMeta
            }
            style={{
              marginTop: 6,
            }}
          >
            <strong>
              {addr.name ||
                "—"}
            </strong>
          </div>

          <div
            className={
              styles.itemMeta
            }
          >
            <Phone
              size={14}
            />{" "}
            {addr.phone ? (
              <a
                href={`tel:${addr.phone}`}
              >
                {
                  addr.phone
                }
              </a>
            ) : (
              "—"
            )}
          </div>

          <div
            className={
              styles.itemMeta
            }
          >
            <Mail
              size={14}
            />{" "}
            {addr.email ? (
              <a
                href={`mailto:${addr.email}`}
              >
                {
                  addr.email
                }
              </a>
            ) : (
              "—"
            )}
          </div>

          <div
            className={
              styles.itemMeta
            }
          >
            <MapPin
              size={14}
            />{" "}
            <span>
              {addr.street && (
                <>
                  {
                    addr.street
                  }
                  ,{" "}
                </>
              )}

              {addr.city}

              {addr.postalCode &&
                ` (${addr.postalCode})`}

              {addr.county &&
                `, ${addr.county}`}
            </span>
          </div>

          {isCompany && (
            <>
              <div
                style={{
                  marginTop:
                    10,
                }}
              >
                <strong>
                  Facturare pe
                  firmă
                </strong>
              </div>

              <div
                className={
                  styles.itemMeta
                }
              >
                Denumire
                firmă:{" "}
                <strong>
                  {order
                    ?.billingAddress
                    ?.companyName ||
                    addr.companyName ||
                    "—"}
                </strong>
              </div>

              <div
                className={
                  styles.itemMeta
                }
              >
                CUI:{" "}
                <strong>
                  {order
                    ?.billingAddress
                    ?.companyCui ||
                    addr.companyCui ||
                    "—"}
                </strong>
              </div>

              {(order
                ?.billingAddress
                ?.companyRegCom ||
                addr.companyRegCom) && (
                <div
                  className={
                    styles.itemMeta
                  }
                >
                  Nr. Reg.
                  Comerțului:{" "}
                  <strong>
                    {order
                      ?.billingAddress
                      ?.companyRegCom ||
                      addr.companyRegCom}
                  </strong>
                </div>
              )}
            </>
          )}
        </section>

        <section
          className={
            styles.card
          }
        >
          <h3>
            Livrare & AWB
            (per pachet)
          </h3>

          {shipments.length ===
            0 && (
            <p
              className={
                styles.itemMeta
              }
            >
              Nu există încă
              informații de
              transport.
            </p>
          )}

          {shipments.length >
            0 && (
            <div
              className={
                styles.tableWrap
              }
            >
              <table
                className={
                  styles.table
                }
              >
                <thead>
                  <tr>
                    <th>
                      Pachet
                    </th>
                    <th>
                      Status
                      livrare
                    </th>
                    <th>
                      Curier
                    </th>
                    <th>
                      AWB
                    </th>
                    <th>
                      Tracking
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {shipmentBlocks.map(
                    (
                      shipment
                    ) => (
                      <tr
                        key={
                          shipment.id
                        }
                      >
                        <td>
                          #{" "}
                          {
                            shipment.index
                          }
                        </td>

                        <td>
                          <div>
                            <strong>
                              {SHIPMENT_STATUS_LABEL[
                                shipment
                                  .status
                              ] ||
                                shipment.status ||
                                "—"}
                            </strong>

                            {SHIPMENT_STATUS_HELP[
                              shipment
                                .status
                            ] && (
                              <div
                                className={
                                  styles.subtle
                                }
                              >
                                {
                                  SHIPMENT_STATUS_HELP[
                                    shipment
                                      .status
                                  ]
                                }
                              </div>
                            )}
                          </div>
                        </td>

                        <td>
                          {shipment.provider ||
                            "—"}

                          {shipment.service && (
                            <div
                              className={
                                styles.itemMeta
                              }
                            >
                              {
                                shipment.service
                              }
                            </div>
                          )}
                        </td>

                        <td>
                          {shipment.awb ||
                            "—"}
                        </td>

                        <td>
                          {shipment.trackingUrl ? (
                            <a
                              href={
                                shipment.trackingUrl
                              }
                              target="_blank"
                              rel="noreferrer"
                              className={
                                styles.itemMeta
                              }
                            >
                              <ExternalLink
                                size={
                                  14
                                }
                              />{" "}
                              urmărește
                            </a>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {shipmentBlocks.length >
      0 ? (
        <>
          {shipmentBlocks.map(
            (
              shipment
            ) => (
              <section
                className={
                  styles.card
                }
                key={
                  shipment.id
                }
              >
                <div
                  style={{
                    display:
                      "flex",
                    justifyContent:
                      "space-between",
                    gap: 8,
                    alignItems:
                      "center",
                    marginBottom:
                      6,
                    flexWrap:
                      "wrap",
                  }}
                >
                  <div>
                    <h3>
                      Pachet{" "}
                      {
                        shipment.index
                      }{" "}
                      ·{" "}
                      {SHIPMENT_STATUS_LABEL[
                        shipment
                          .status
                      ] ||
                        shipment.status ||
                        "—"}
                    </h3>

                    {(shipment.vendorName ||
                      shipment.vendorId) && (
                      <>
                        <p
                          className={
                            styles.subtle
                          }
                        >
                          De la
                          artizan:{" "}
                          <strong>
                            {shipment.vendorName ||
                              "Artizan"}
                          </strong>
                        </p>

                        {shipment.storeAddress && (
                          <p
                            className={
                              styles.itemMeta
                            }
                          >
                            <MapPin
                              size={
                                14
                              }
                              style={{
                                marginRight:
                                  4,
                              }}
                            />

                            {[
                              shipment
                                .storeAddress
                                .street,

                              shipment
                                .storeAddress
                                .city,

                              shipment
                                .storeAddress
                                .county,

                              shipment
                                .storeAddress
                                .country,
                            ]
                              .filter(
                                Boolean
                              )
                              .join(
                                ", "
                              )}
                          </p>
                        )}
                      </>
                    )}
                  </div>

                  {(shipment.vendorId ||
                    shipment.vendorName) && (
                    <button
                      type="button"
                      className={
                        styles.btnGhost
                      }
                      onClick={() =>
                        contactVendorForShipment(
                          shipment
                        )
                      }
                      title="Scrie artizanului pentru acest pachet"
                    >
                      <MessageSquare
                        size={
                          16
                        }
                        style={{
                          marginRight:
                            4,
                        }}
                      />

                      Contactează
                      artizanul
                    </button>
                  )}
                </div>

                {shipment.items.length ===
                  0 && (
                  <p
                    className={
                      styles.itemMeta
                    }
                  >
                    Nu există
                    produse asociate
                    acestui pachet.
                  </p>
                )}

                {shipment.deposit &&
                  shipment.deposit
                    .status !==
                    "NOT_REQUESTED" && (
                    <div
                      id={
                        shipment
                          .deposit
                          ?.status ===
                        "PENDING"
                          ? "avans"
                          : undefined
                      }
                      style={{
                        marginBottom:
                          16,
                        padding:
                          16,
                        borderRadius:
                          14,

                        border:
                          shipment
                            .deposit
                            .status ===
                          "PAID"
                            ? "1px solid rgba(40, 130, 70, 0.22)"
                            : shipment
                                  .deposit
                                  .status ===
                                "PENDING"
                              ? "1px solid rgba(170, 120, 30, 0.28)"
                              : "1px solid rgba(120, 120, 120, 0.18)",

                        background:
                          shipment
                            .deposit
                            .status ===
                          "PAID"
                            ? "rgba(40, 130, 70, 0.06)"
                            : shipment
                                  .deposit
                                  .status ===
                                "PENDING"
                              ? "rgba(190, 140, 40, 0.07)"
                              : "rgba(120, 120, 120, 0.05)",
                      }}
                    >
                      <div
                        style={{
                          display:
                            "flex",
                          justifyContent:
                            "space-between",
                          gap: 12,
                          alignItems:
                            "flex-start",
                          flexWrap:
                            "wrap",
                        }}
                      >
                        <div>
                          <div
                            style={{
                              fontWeight:
                                800,
                              fontSize:
                                16,
                              marginBottom:
                                4,
                            }}
                          >
                            {getDepositStatusLabel(
                              shipment
                                .deposit
                                .status
                            )}
                          </div>

                          {shipment
                            .deposit
                            .status ===
                            "PENDING" && (
                            <p
                              className={
                                styles.subtle
                              }
                              style={{
                                margin:
                                  0,
                                maxWidth:
                                  620,
                              }}
                            >
                              Artizanul a
                              solicitat
                              un avans
                              pentru
                              confirmarea
                              și
                              pregătirea
                              comenzii.
                            </p>
                          )}

                          {shipment
                            .deposit
                            .status ===
                            "PAID" && (
                            <p
                              className={
                                styles.subtle
                              }
                              style={{
                                margin:
                                  0,
                              }}
                            >
                              Plata
                              avansului a
                              fost
                              înregistrată
                              cu succes.
                            </p>
                          )}

                          {shipment
                            .deposit
                            .status ===
                            "EXPIRED" && (
                            <p
                              className={
                                styles.subtle
                              }
                              style={{
                                margin:
                                  0,
                              }}
                            >
                              Termenul
                              pentru plata
                              acestui
                              avans a
                              expirat. Poți
                              contacta
                              artizanul dacă
                              dorești o
                              solicitare
                              nouă.
                            </p>
                          )}

                          {shipment
                            .deposit
                            .status ===
                            "FAILED" && (
                            <p
                              className={
                                styles.subtle
                              }
                              style={{
                                margin:
                                  0,
                              }}
                            >
                              Plata nu a
                              fost
                              finalizată.
                              Dacă
                              solicitarea
                              este încă
                              activă, poți
                              încerca din
                              nou.
                            </p>
                          )}
                        </div>

                        {shipment
                          .deposit
                          .percent !=
                          null && (
                          <span
                            className={
                              styles.badge
                            }
                          >
                            {
                              shipment
                                .deposit
                                .percent
                            }
                            % avans
                          </span>
                        )}
                      </div>

                      <div
                        style={{
                          display:
                            "grid",
                          gridTemplateColumns:
                            "repeat(auto-fit, minmax(160px, 1fr))",
                          gap: 10,
                          marginTop:
                            14,
                        }}
                      >
                        {shipment
                          .deposit
                          .requestedAmount !=
                          null && (
                          <div>
                            <div
                              className={
                                styles.subtle
                              }
                            >
                              Avans
                              solicitat
                            </div>

                            <strong>
                              {moneyAmount(
                                shipment
                                  .deposit
                                  .requestedAmount,
                                order.currency
                              )}
                            </strong>
                          </div>
                        )}

                        {shipment
                          .deposit
                          .paidAmount !=
                          null && (
                          <div>
                            <div
                              className={
                                styles.subtle
                              }
                            >
                              Avans
                              achitat
                            </div>

                            <strong>
                              {moneyAmount(
                                shipment
                                  .deposit
                                  .paidAmount,
                                order.currency
                              )}
                            </strong>
                          </div>
                        )}

                        {shipment
                          .deposit
                          .remainingCodAmount !=
                          null && (
                          <div>
                            <div
                              className={
                                styles.subtle
                              }
                            >
                              Rest de
                              achitat la
                              livrare
                            </div>

                            <strong>
                              {moneyAmount(
                                shipment
                                  .deposit
                                  .remainingCodAmount,
                                order.currency
                              )}
                            </strong>
                          </div>
                        )}

                        {shipment
                          .deposit
                          .expiresAt &&
                          shipment
                            .deposit
                            .status ===
                            "PENDING" && (
                            <div>
                              <div
                                className={
                                  styles.subtle
                                }
                              >
                                Plata este
                                disponibilă
                                până la
                              </div>

                              <strong>
                                {formatDate(
                                  shipment
                                    .deposit
                                    .expiresAt
                                )}
                              </strong>
                            </div>
                          )}
                      </div>

                      {shipment
                        .deposit
                        .status ===
                        "PENDING" && (
                        <div
                          style={{
                            marginTop:
                              16,
                          }}
                        >
                          <button
                            type="button"
                            className={
                              styles.btnPrimary
                            }
                            disabled={
                              busyDepositShipmentId ===
                                shipment.id ||
                              !shipment
                                .deposit
                                .payable
                            }
                            onClick={() =>
                              handlePayDeposit(
                                shipment
                              )
                            }
                          >
                            {busyDepositShipmentId ===
                            shipment.id ? (
                              <>
                                <Loader2
                                  size={
                                    16
                                  }
                                  className={
                                    styles.spin
                                  }
                                  style={{
                                    marginRight:
                                      6,
                                  }}
                                />
                                Se
                                deschide
                                plata…
                              </>
                            ) : shipment
                                .deposit
                                .payable ? (
                              "Plătește avansul"
                            ) : (
                              "Avans expirat"
                            )}
                          </button>

                          <p
                            className={
                              styles.subtle
                            }
                            style={{
                              margin:
                                "8px 0 0",
                              fontSize:
                                12,
                            }}
                          >
                            Plata online
                            este procesată
                            securizat.
                            După achitarea
                            avansului,
                            restul indicat
                            mai sus rămâne
                            de achitat
                            conform
                            comenzii.
                          </p>
                        </div>
                      )}

                      {shipment
                        .deposit
                        .status ===
                        "PAID" &&
                        shipment
                          .deposit
                          .paidAt && (
                          <p
                            className={
                              styles.subtle
                            }
                            style={{
                              margin:
                                "12px 0 0",
                              fontSize:
                                12,
                            }}
                          >
                            Achitat
                            la{" "}
                            {formatDate(
                              shipment
                                .deposit
                                .paidAt
                            )}
                          </p>
                        )}
                    </div>
                  )}

                                  {shipment.items.length >
                  0 && (
                  <ul
                    className={
                      styles.itemList
                    }
                  >
                    {shipment.items.map(
                      (
                        item
                      ) => {
                        const lineTotalCents =
                          (
                            Number(
                              item.priceCents
                            ) ||
                            0
                          ) *
                          (
                            Number(
                              item.qty
                            ) ||
                            0
                          );

                        return (
                          <li
                            className={
                              styles.item
                            }
                            key={
                              item.id
                            }
                          >
                            {item.productId ? (
                              <Link
                                to={`/produs/${item.productId}`}
                                className={
                                  styles.itemThumbLink
                                }
                              >
                                <img
                                  src={
                                    item.image ||
                                    "/placeholder.png"
                                  }
                                  alt={
                                    item.title
                                  }
                                  className={
                                    styles.thumb
                                  }
                                  loading="lazy"
                                />
                              </Link>
                            ) : (
                              <div
                                className={
                                  styles.itemThumbLink
                                }
                              >
                                <img
                                  src={
                                    item.image ||
                                    "/placeholder.png"
                                  }
                                  alt={
                                    item.title
                                  }
                                  className={
                                    styles.thumb
                                  }
                                  loading="lazy"
                                />
                              </div>
                            )}

                            <div
                              className={
                                styles.itemInfo
                              }
                            >
                              <div
                                className={
                                  styles.itemTitle
                                }
                              >
                                {item.productId ? (
                                  <Link
                                    to={`/produs/${item.productId}`}
                                    className={
                                      styles.itemTitleLink
                                    }
                                  >
                                    {
                                      item.title
                                    }
                                  </Link>
                                ) : (
                                  item.title
                                )}
                              </div>

                              <div
                                className={
                                  styles.itemMeta
                                }
                              >
                                Cantitate:{" "}
                                <b>
                                  {
                                    item.qty
                                  }
                                </b>
                              </div>

                              <div
                                className={
                                  styles.itemMeta
                                }
                              >
                                Preț
                                unitar:{" "}

                                {item.hasDiscount &&
                                Number(
                                  item.originalPriceCents
                                ) >
                                  Number(
                                    item.priceCents
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
                                        item.originalPriceCents,
                                        order.currency
                                      )}
                                    </span>

                                    <strong>
                                      {money(
                                        item.priceCents,
                                        order.currency
                                      )}
                                    </strong>

                                    {Number(
                                      item.discountPercent
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
                                          item.discountPercent
                                        }
                                        %
                                      </span>
                                    )}
                                  </>
                                ) : (
                                  <strong>
                                    {money(
                                      item.priceCents,
                                      order.currency
                                    )}
                                  </strong>
                                )}
                              </div>

                              <ProductConfiguration
                                item={
                                  item
                                }
                                onPreviewImage={
                                  setImagePreview
                                }
                              />

                              <div
                                className={
                                  styles.itemMeta
                                }
                              >
                                Total
                                linie:{" "}
                                <strong>
                                  {money(
                                    lineTotalCents,
                                    order.currency
                                  )}
                                </strong>
                              </div>
                            </div>
                          </li>
                        );
                      }
                    )}
                  </ul>
                )}

                <div
                  className={
                    styles.actionsRow
                  }
                  style={{
                    justifyContent:
                      "flex-end",
                  }}
                >
                  <div>
                    Total produse
                    pachet{" "}
                    {
                      shipment.index
                    }
                    :{" "}
                    <strong>
                      {money(
                        shipment.itemsTotalCents,
                        order.currency
                      )}
                    </strong>
                  </div>
                </div>
              </section>
            )
          )}
        </>
      ) : (
        <section
          className={
            styles.card
          }
        >
          <h3>
            Produse din comandă
          </h3>

          <ul
            className={
              styles.itemList
            }
          >
            {items.map(
              (
                item
              ) => {
                const lineTotalCents =
                  (
                    Number(
                      item.priceCents
                    ) ||
                    0
                  ) *
                  (
                    Number(
                      item.qty
                    ) ||
                    0
                  );

                return (
                  <li
                    className={
                      styles.item
                    }
                    key={
                      item.id
                    }
                  >
                    {item.productId ? (
                      <Link
                        to={`/produs/${item.productId}`}
                        className={
                          styles.itemThumbLink
                        }
                      >
                        <img
                          src={
                            item.image ||
                            "/placeholder.png"
                          }
                          alt={
                            item.title
                          }
                          className={
                            styles.thumb
                          }
                          loading="lazy"
                        />
                      </Link>
                    ) : (
                      <div
                        className={
                          styles.itemThumbLink
                        }
                      >
                        <img
                          src={
                            item.image ||
                            "/placeholder.png"
                          }
                          alt={
                            item.title
                          }
                          className={
                            styles.thumb
                          }
                          loading="lazy"
                        />
                      </div>
                    )}

                    <div
                      className={
                        styles.itemInfo
                      }
                    >
                      <div
                        className={
                          styles.itemTitle
                        }
                      >
                        {item.productId ? (
                          <Link
                            to={`/produs/${item.productId}`}
                            className={
                              styles.itemTitleLink
                            }
                          >
                            {
                              item.title
                            }
                          </Link>
                        ) : (
                          item.title
                        )}
                      </div>

                      <ProductConfiguration
                        item={
                          item
                        }
                        onPreviewImage={
                          setImagePreview
                        }
                      />

                      <div
                        className={
                          styles.itemMeta
                        }
                      >
                        Cantitate:{" "}
                        <b>
                          {
                            item.qty
                          }
                        </b>
                      </div>

                      <div
                        className={
                          styles.itemMeta
                        }
                      >
                        Preț
                        unitar:{" "}

                        {item.hasDiscount &&
                        Number(
                          item.originalPriceCents
                        ) >
                          Number(
                            item.priceCents
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
                                item.originalPriceCents,
                                order.currency
                              )}
                            </span>

                            <strong>
                              {money(
                                item.priceCents,
                                order.currency
                              )}
                            </strong>

                            {Number(
                              item.discountPercent
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
                                  item.discountPercent
                                }
                                %
                              </span>
                            )}
                          </>
                        ) : (
                          <strong>
                            {money(
                              item.priceCents,
                              order.currency
                            )}
                          </strong>
                        )}
                      </div>

                      <div
                        className={
                          styles.itemMeta
                        }
                      >
                        Total
                        linie:{" "}
                        <strong>
                          {money(
                            lineTotalCents,
                            order.currency
                          )}
                        </strong>
                      </div>
                    </div>
                  </li>
                );
              }
            )}
          </ul>
        </section>
      )}

      <section
        className={
          styles.card
        }
      >
        <h3>
          Sumar costuri
        </h3>

        <div
          className={
            styles.actionsRow
          }
          style={{
            justifyContent:
              "flex-end",
          }}
        >
          <div>
            Subtotal:{" "}
            <strong>
              {money(
                order.subtotalCents,
                order.currency
              )}
            </strong>
          </div>

          <div>
            Transport:{" "}
            <strong>
              {money(
                order.shippingCents,
                order.currency
              )}
            </strong>
          </div>

          <div>
            Total:{" "}
            <strong>
              {money(
                order.totalCents,
                order.currency
              )}
            </strong>
          </div>
        </div>
      </section>

      <div
        className={
          styles.loadMoreWrap
        }
      >
        <button
          className={
            styles.btnGhost
          }
          onClick={() =>
            nav(-1)
          }
          type="button"
        >
          <ArrowLeft
            size={16}
          />{" "}
          Înapoi la listă
        </button>
      </div>

      {imagePreview && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Previzualizare imagine"
          onMouseDown={(
            event
          ) => {
            if (
              event.target ===
              event.currentTarget
            ) {
              setImagePreview(
                null
              );
            }
          }}
          style={{
            position:
              "fixed",
            inset: 0,
            zIndex:
              999999,
            display:
              "flex",
            alignItems:
              "center",
            justifyContent:
              "center",
            padding:
              20,
            background:
              "rgba(0,0,0,0.86)",
          }}
        >
          <div
            onMouseDown={(
              event
            ) =>
              event.stopPropagation()
            }
            style={{
              position:
                "relative",
              display:
                "flex",
              alignItems:
                "center",
              justifyContent:
                "center",
              maxWidth:
                "95vw",
              maxHeight:
                "92vh",
            }}
          >
            <button
              type="button"
              onClick={() =>
                setImagePreview(
                  null
                )
              }
              aria-label="Închide imaginea"
              title="Închide"
              style={{
                position:
                  "absolute",
                top: 10,
                right: 10,
                zIndex: 2,
                width: 38,
                height:
                  38,
                display:
                  "inline-flex",
                alignItems:
                  "center",
                justifyContent:
                  "center",
                padding:
                  0,
                border:
                  0,
                borderRadius:
                  "50%",
                background:
                  "rgba(0,0,0,0.76)",
                color:
                  "#fff",
                fontSize:
                  24,
                lineHeight:
                  1,
                cursor:
                  "pointer",
              }}
            >
              ×
            </button>

            <img
              src={
                imagePreview
              }
              alt="Imagine personalizare"
              style={{
                display:
                  "block",
                maxWidth:
                  "95vw",
                maxHeight:
                  "92vh",
                objectFit:
                  "contain",
                borderRadius:
                  12,
              }}
            />
          </div>
        </div>
      )}
    </main>
  );
}