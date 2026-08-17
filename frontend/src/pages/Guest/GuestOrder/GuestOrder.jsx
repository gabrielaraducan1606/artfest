// src/pages/GuestOrder/GuestOrderPage.jsx

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Loader2,
  Package,
  RefreshCw,
  ShieldCheck,
  Truck,
} from "lucide-react";

import {
  useParams,
  useSearchParams,
} from "react-router-dom";

import {
  api,
} from "../../../lib/api.js";

/* =========================================================
   Helpers
========================================================= */

function money(
  value,
  currency = "RON"
) {
  return new Intl.NumberFormat(
    "ro-RO",
    {
      style: "currency",
      currency:
        currency || "RON",
    }
  ).format(
    Number(
      value || 0
    )
  );
}

function formatDate(
  value
) {
  if (!value) {
    return "—";
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return "—";
  }

  return new Intl.DateTimeFormat(
    "ro-RO",
    {
      dateStyle:
        "medium",

      timeStyle:
        "short",
    }
  ).format(date);
}

function getStatusLabel(
  status
) {
  switch (status) {
    case "PENDING":
      return "Comandă înregistrată";

    case "PROCESSING":
      return "În pregătire";

    case "SHIPPED":
      return "Expediată";

    case "DELIVERED":
      return "Livrată";

    case "CANCELED":
      return "Anulată";

    case "RETURNED":
      return "Returnată";

    default:
      return (
        status ||
        "Înregistrată"
      );
  }
}

function getDepositTitle(
  status
) {
  switch (status) {
    case "PENDING":
      return "Avans de achitat";

    case "PAID":
      return "Avans achitat";

    case "EXPIRED":
      return "Solicitarea de avans a expirat";

    case "FAILED":
      return "Plata avansului nu a fost finalizată";

    default:
      return "Avans";
  }
}

function getObjectEntries(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return [];
  }

  return Object.entries(value).filter(
    ([, itemValue]) => {
      if (
        itemValue === null ||
        itemValue === undefined
      ) {
        return false;
      }

      if (
        typeof itemValue === "string"
      ) {
        return itemValue.trim() !== "";
      }

      return true;
    }
  );
}

function readableValue(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  if (Array.isArray(value)) {
    return value
      .map(readableValue)
      .filter(Boolean)
      .join(", ");
  }

  if (typeof value === "object") {
    return (
      value.label ||
      value.value ||
      value.name ||
      JSON.stringify(value)
    );
  }

  return String(value);
}

function readableLabel(key) {
  return String(key || "")
    .replace(/[_-]+/g, " ")
    .replace(
      /\b\w/g,
      (letter) =>
        letter.toUpperCase()
    );
}

function isCustomizationImage(value) {
  if (typeof value !== "string") {
    return false;
  }

  const url = value.trim();

  if (!url) {
    return false;
  }

  return (
    /^(https?:\/\/|data:image\/|blob:)/i.test(url) ||
    url.includes("/customizations/") ||
    /\.(jpg|jpeg|png|webp|gif|heic|heif|bmp|tiff|avif)(\?.*)?$/i.test(url)
  );
}

function ProductConfiguration({
  item,
  onPreviewImage,
}) {
  const optionEntries =
    getObjectEntries(
      item?.selectedOptions
    );

  const customEntries =
    getObjectEntries(
      item?.customAnswers
    );

  const repeatedEntries =
    getObjectEntries(
      item?.repeatedGroupAnswers
    );

  const hasAny =
    optionEntries.length > 0 ||
    customEntries.length > 0 ||
    repeatedEntries.length > 0;

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
      {optionEntries.length > 0 && (
        <div>
          <strong>
            Opțiuni
          </strong>

          {optionEntries.map(
            ([key, value]) => (
              <div
                key={`option-${key}`}
              >
                {readableLabel(key)}
                :{" "}
                {readableValue(value)}
              </div>
            )
          )}
        </div>
      )}

      {customEntries.length > 0 && (
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
            ([key, value]) => {
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
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          marginTop: 4,
                        }
                      : undefined
                  }
                >
                  <span>
                    {readableLabel(key)}:
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
                        src={value}
                        alt={`Personalizare ${readableLabel(
                          key
                        )}`}
                        style={{
                          width: 54,
                          height: 54,
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

      {repeatedEntries.length > 0 && (
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
            ([groupKey, members]) => {
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
                            marginTop: 6,
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
                            ([
                              key,
                              value,
                            ]) => {
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
                                        src={value}
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

function getImageUrl(
  item
) {
  if (
    typeof item?.image ===
    "string"
  ) {
    return item.image;
  }

  return (
    item?.image?.url ||
    item?.image?.src ||
    ""
  );
}

/* =========================================================
   Componentă
========================================================= */

export default function GuestOrderPage() {
  const {
    id,
  } = useParams();

  const [
    searchParams,
  ] =
    useSearchParams();

  const depositRef =
    useRef(null);

  const [
    order,
    setOrder,
  ] = useState(null);

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    refreshing,
    setRefreshing,
  ] = useState(false);

  const [
    error,
    setError,
  ] = useState("");

  const [
    busyDepositId,
    setBusyDepositId,
  ] = useState(null);

  const [
    imagePreview,
    setImagePreview,
  ] = useState(null);

  /*
   * Tokenul normal este primit după
   * plasarea comenzii guest.
   */
  const guestToken =
    String(
      searchParams.get(
        "token"
      ) || ""
    ).trim();

  /*
   * Tokenul acesta vine în email dacă
   * vendorul solicită avans.
   */
  const depositToken =
    String(
      searchParams.get(
        "depositToken"
      ) || ""
    ).trim();

  const accessQuery =
    useMemo(() => {
      const params =
        new URLSearchParams();

      if (guestToken) {
        params.set(
          "token",
          guestToken
        );
      } else if (
        depositToken
      ) {
        params.set(
          "depositToken",
          depositToken
        );
      }

      return params.toString();
    }, [
      guestToken,
      depositToken,
    ]);

  useEffect(() => {
    if (!imagePreview) {
      return;
    }

    const previousOverflow =
      document.body.style.overflow;

    const handleKeyDown = (
      event
    ) => {
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
  }, [imagePreview]);

  /* =======================================================
     Load comandă
  ======================================================= */

  const loadOrder =
    useCallback(
      async ({
        silent = false,
      } = {}) => {
        if (!id) {
          setError(
            "Comanda nu a putut fi identificată."
          );

          setLoading(
            false
          );

          return;
        }

        if (
          !guestToken &&
          !depositToken
        ) {
          setError(
            "Linkul acestei comenzi nu este valid sau este incomplet."
          );

          setLoading(
            false
          );

          return;
        }

        try {
          if (silent) {
            setRefreshing(
              true
            );
          } else {
            setLoading(
              true
            );
          }

          setError("");

          const response =
            await api(
              `/api/guest/orders/${encodeURIComponent(
                id
              )}?${accessQuery}`
            );

          setOrder(
            response ||
              null
          );
        } catch (
          requestError
        ) {
          console.error(
            "Guest order load failed:",
            requestError
          );

          const message =
            requestError?.data
              ?.message ||
            requestError
              ?.response
              ?.data
              ?.message ||
            requestError?.message ||
            "Nu am putut încărca această comandă.";

          setError(
            message
          );
        } finally {
          setLoading(
            false
          );

          setRefreshing(
            false
          );
        }
      },
      [
        id,
        guestToken,
        depositToken,
        accessQuery,
      ]
    );

  useEffect(() => {
    loadOrder();
  }, [loadOrder]);

  /* =======================================================
     Scroll către avans
  ======================================================= */

  useEffect(() => {
    if (!order) {
      return;
    }

    if (
      window.location.hash !==
      "#avans"
    ) {
      return;
    }

    const timer =
      window.setTimeout(
        () => {
          depositRef.current?.scrollIntoView(
            {
              behavior:
                "smooth",

              block:
                "center",
            }
          );
        },
        150
      );

    return () =>
      window.clearTimeout(
        timer
      );
  }, [order]);

  /* =======================================================
     Date derivate
  ======================================================= */

  const shipments =
    Array.isArray(
      order?.shipments
    )
      ? order.shipments
      : [];

  const items =
  useMemo(
    () =>
      Array.isArray(
        order?.items
      )
        ? order.items
        : [],
    [order?.items]
  );

  const itemsByShipment =
    useMemo(() => {
      const map =
        new Map();

      for (
        const item of
        items
      ) {
        const shipmentId =
          item?.shipmentId;

        if (!shipmentId) {
          continue;
        }

        if (
          !map.has(
            shipmentId
          )
        ) {
          map.set(
            shipmentId,
            []
          );
        }

        map
          .get(
            shipmentId
          )
          .push(item);
      }

      return map;
    }, [items]);

  const pendingDepositShipment =
    shipments.find(
      (shipment) =>
        shipment?.deposit
          ?.status ===
        "PENDING"
    ) ||
    null;

  const paidDepositShipment =
    shipments.find(
      (shipment) =>
        shipment?.deposit
          ?.status ===
        "PAID"
    ) ||
    null;

  const importantDepositShipment =
    pendingDepositShipment ||
    paidDepositShipment ||
    shipments.find(
      (shipment) =>
        shipment?.deposit &&
        shipment.deposit
          .status !==
          "NOT_REQUESTED"
    ) ||
    null;

  /* =======================================================
     Plată avans
  ======================================================= */

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
      window.alert(
        "Acest avans nu mai este disponibil pentru plată."
      );

      await loadOrder({
        silent:
          true,
      });

      return;
    }

    if (
      deposit.payable ===
      false
    ) {
      window.alert(
        "Termenul pentru plata acestui avans a expirat."
      );

      await loadOrder({
        silent:
          true,
      });

      return;
    }

    try {
      setBusyDepositId(
        shipment.id
      );

      const params =
        new URLSearchParams();

      if (guestToken) {
        params.set(
          "token",
          guestToken
        );
      } else if (
        depositToken
      ) {
        params.set(
          "depositToken",
          depositToken
        );
      }

      const response =
        await api(
          `/api/guest/orders/${encodeURIComponent(
            order.id
          )}/shipments/${encodeURIComponent(
            shipment.id
          )}/pay-deposit?${params.toString()}`,
          {
            method:
              "POST",
          }
        );

      if (
        !response?.url
      ) {
        throw new Error(
          "Nu am primit linkul pentru plata avansului."
        );
      }

      window.location.assign(
        response.url
      );
    } catch (
      paymentError
    ) {
      console.error(
        "Guest deposit payment failed:",
        paymentError
      );

      const message =
        paymentError?.data
          ?.message ||
        paymentError
          ?.response
          ?.data
          ?.message ||
        paymentError?.message ||
        "Nu am putut deschide plata avansului.";

      window.alert(
        message
      );

      await loadOrder({
        silent:
          true,
      });
    } finally {
      setBusyDepositId(
        null
      );
    }
  }

  /* =======================================================
     Stiluri
  ======================================================= */

  const pageStyle = {
    minHeight:
      "70vh",

    background:
      "#f8f7f5",

    padding:
      "32px 16px 56px",
  };

  const shellStyle = {
    width:
      "min(920px, 100%)",

    margin:
      "0 auto",
  };

  const cardStyle = {
    background:
      "#ffffff",

    border:
      "1px solid rgba(65, 45, 35, 0.10)",

    borderRadius:
      18,

    padding:
      20,

    boxShadow:
      "0 8px 30px rgba(50, 35, 25, 0.045)",

    marginBottom:
      16,
  };

  const subtleStyle = {
    color:
      "#74665f",

    fontSize:
      14,

    lineHeight:
      1.55,
  };

  const primaryButtonStyle = {
    border:
      0,

    borderRadius:
      12,

    padding:
      "12px 18px",

    background:
      "#6f4e43",

    color:
      "#ffffff",

    fontWeight:
      800,

    cursor:
      "pointer",

    display:
      "inline-flex",

    alignItems:
      "center",

    justifyContent:
      "center",

    gap:
      7,
  };

  const secondaryButtonStyle = {
    border:
      "1px solid rgba(80, 55, 45, 0.18)",

    borderRadius:
      12,

    padding:
      "10px 14px",

    background:
      "#ffffff",

    color:
      "#533f36",

    fontWeight:
      700,

    cursor:
      "pointer",

    display:
      "inline-flex",

    alignItems:
      "center",

    justifyContent:
      "center",

    gap:
      7,
  };

  /* =======================================================
     Loading
  ======================================================= */

  if (loading) {
    return (
      <div
        style={
          pageStyle
        }
      >
        <div
          style={{
            ...shellStyle,

            ...cardStyle,

            textAlign:
              "center",

            padding:
              40,
          }}
        >
          <Loader2
            size={28}
            style={{
              animation:
                "spin 1s linear infinite",
            }}
          />

          <h2
            style={{
              margin:
                "16px 0 6px",
            }}
          >
            Încărcăm comanda
          </h2>

          <div
            style={
              subtleStyle
            }
          >
            Verificăm linkul securizat și informațiile comenzii.
          </div>
        </div>
      </div>
    );
  }

  /* =======================================================
     Error
  ======================================================= */

  if (
    error ||
    !order
  ) {
    return (
      <div
        style={
          pageStyle
        }
      >
        <div
          style={{
            ...shellStyle,

            ...cardStyle,

            textAlign:
              "center",

            padding:
              36,
          }}
        >
          <AlertTriangle
            size={34}
          />

          <h2
            style={{
              margin:
                "14px 0 8px",
            }}
          >
            Nu am putut deschide comanda
          </h2>

          <p
            style={
              subtleStyle
            }
          >
            {error ||
              "Linkul comenzii nu mai este disponibil."}
          </p>

          <button
            type="button"
            style={{
              ...secondaryButtonStyle,

              marginTop:
                12,
            }}
            onClick={() =>
              loadOrder()
            }
          >
            <RefreshCw
              size={16}
            />

            Încearcă din nou
          </button>
        </div>
      </div>
    );
  }

  /* =======================================================
     Render
  ======================================================= */

  return (
    <div
      style={
        pageStyle
      }
    >
      <div
        style={
          shellStyle
        }
      >
        {/* =================================================
            Header comandă
        ================================================= */}

        <section
          style={
            cardStyle
          }
        >
          <div
            style={{
              display:
                "flex",

              alignItems:
                "flex-start",

              justifyContent:
                "space-between",

              gap:
                16,

              flexWrap:
                "wrap",
            }}
          >
            <div>
              <div
                style={{
                  color:
                    "#8a766c",

                  fontSize:
                    12,

                  fontWeight:
                    800,

                  textTransform:
                    "uppercase",

                  letterSpacing:
                    "0.04em",

                  marginBottom:
                    5,
                }}
              >
                Comanda ta
              </div>

              <h1
                style={{
                  margin:
                    0,

                  fontSize:
                    25,

                  color:
                    "#2f2521",
                }}
              >
                #
                {order.orderNumber ||
                  order.id}
              </h1>

              <p
                style={{
                  ...subtleStyle,

                  margin:
                    "7px 0 0",
                }}
              >
                Plasată la{" "}
                {formatDate(
                  order.createdAt
                )}
              </p>
            </div>

            <div
              style={{
                padding:
                  "8px 12px",

                borderRadius:
                  999,

                background:
                  "#f4f0ed",

                fontWeight:
                  800,

                fontSize:
                  13,

                color:
                  "#57433a",
              }}
            >
              {getStatusLabel(
                order.status
              )}
            </div>
          </div>

          {refreshing && (
            <div
              style={{
                ...subtleStyle,

                marginTop:
                  10,
              }}
            >
              Se actualizează informațiile…
            </div>
          )}

          <div
            style={{
              marginTop:
                18,

              paddingTop:
                16,

              borderTop:
                "1px solid rgba(60, 40, 30, 0.09)",

              display:
                "flex",

              justifyContent:
                "space-between",

              alignItems:
                "center",

              gap:
                12,

              flexWrap:
                "wrap",
            }}
          >
            <div
              style={
                subtleStyle
              }
            >
              Total comandă
            </div>

            <strong
              style={{
                fontSize:
                  21,

                color:
                  "#2f2521",
              }}
            >
              {money(
                order.total,
                order.currency
              )}
            </strong>
          </div>
        </section>

        {/* =================================================
            AVANS
        ================================================= */}

        {importantDepositShipment && (
          <section
            id="avans"
            ref={
              depositRef
            }
            style={{
              ...cardStyle,

              border:
                importantDepositShipment
                  .deposit
                  ?.status ===
                "PAID"
                  ? "1px solid rgba(42, 135, 75, 0.25)"
                  : importantDepositShipment
                        .deposit
                        ?.status ===
                      "PENDING"
                    ? "1px solid rgba(206, 143, 27, 0.34)"
                    : "1px solid rgba(120,120,120,.17)",

              background:
                importantDepositShipment
                  .deposit
                  ?.status ===
                "PAID"
                  ? "#f4fbf6"
                  : importantDepositShipment
                        .deposit
                        ?.status ===
                      "PENDING"
                    ? "#fffaf0"
                    : "#ffffff",
            }}
          >
            {(() => {
              const shipment =
                importantDepositShipment;

              const deposit =
                shipment.deposit ||
                {};

              const isPending =
                deposit.status ===
                "PENDING";

              const isPaid =
                deposit.status ===
                "PAID";

              return (
                <>
                  <div
                    style={{
                      display:
                        "flex",

                      alignItems:
                        "flex-start",

                      gap:
                        12,
                    }}
                  >
                    <div>
                      {isPaid ? (
                        <CheckCircle2
                          size={
                            26
                          }
                        />
                      ) : (
                        <AlertTriangle
                          size={
                            26
                          }
                        />
                      )}
                    </div>

                    <div
                      style={{
                        flex:
                          1,
                      }}
                    >
                      <h2
                        style={{
                          margin:
                            "0 0 6px",

                          fontSize:
                            19,

                          color:
                            "#2f2521",
                        }}
                      >
                        {getDepositTitle(
                          deposit.status
                        )}
                      </h2>

                      {isPending && (
                        <p
                          style={{
                            ...subtleStyle,

                            margin:
                              0,
                          }}
                        >
                          {shipment.vendorName ||
                            "Artizanul"}{" "}
                          a solicitat un avans pentru confirmarea și pregătirea comenzii.
                        </p>
                      )}

                      {isPaid && (
                        <p
                          style={{
                            ...subtleStyle,

                            margin:
                              0,
                          }}
                        >
                          Plata avansului a fost înregistrată cu succes.
                        </p>
                      )}

                      {deposit.status ===
                        "EXPIRED" && (
                        <p
                          style={{
                            ...subtleStyle,

                            margin:
                              0,
                          }}
                        >
                          Termenul de plată al acestui avans a expirat.
                        </p>
                      )}
                    </div>
                  </div>

                  <div
                    style={{
                      display:
                        "grid",

                      gridTemplateColumns:
                        "repeat(auto-fit, minmax(160px, 1fr))",

                      gap:
                        12,

                      marginTop:
                        18,
                    }}
                  >
                    {deposit.requestedAmount !=
                      null && (
                      <div>
                        <div
                          style={
                            subtleStyle
                          }
                        >
                          Avans solicitat
                        </div>

                        <strong>
                          {money(
                            deposit.requestedAmount,
                            order.currency
                          )}
                        </strong>
                      </div>
                    )}

                    {deposit.percent !=
                      null && (
                      <div>
                        <div
                          style={
                            subtleStyle
                          }
                        >
                          Procent avans
                        </div>

                        <strong>
                          {
                            deposit.percent
                          }
                          %
                        </strong>
                      </div>
                    )}

                    {deposit.paidAmount !=
                      null && (
                      <div>
                        <div
                          style={
                            subtleStyle
                          }
                        >
                          Achitat
                        </div>

                        <strong>
                          {money(
                            deposit.paidAmount,
                            order.currency
                          )}
                        </strong>
                      </div>
                    )}

                    {deposit.remainingCodAmount !=
                      null && (
                      <div>
                        <div
                          style={
                            subtleStyle
                          }
                        >
                          Rest la livrare
                        </div>

                        <strong>
                          {money(
                            deposit.remainingCodAmount,
                            order.currency
                          )}
                        </strong>
                      </div>
                    )}
                  </div>

                  {isPending &&
                    deposit.expiresAt && (
                    <div
                      style={{
                        display:
                          "flex",

                        alignItems:
                          "center",

                        gap:
                          7,

                        marginTop:
                          15,

                        ...subtleStyle,
                      }}
                    >
                      <Clock3
                        size={
                          16
                        }
                      />

                      Poți achita până la{" "}
                      <strong>
                        {formatDate(
                          deposit.expiresAt
                        )}
                      </strong>
                    </div>
                  )}

                  {isPending && (
                    <div
                      style={{
                        marginTop:
                          18,
                      }}
                    >
                      <button
                        type="button"
                        style={{
                          ...primaryButtonStyle,

                          opacity:
                            busyDepositId ===
                              shipment.id ||
                            deposit.payable ===
                              false
                              ? 0.6
                              : 1,

                          cursor:
                            busyDepositId ===
                              shipment.id ||
                            deposit.payable ===
                              false
                              ? "not-allowed"
                              : "pointer",
                        }}
                        disabled={
                          busyDepositId ===
                            shipment.id ||
                          deposit.payable ===
                            false
                        }
                        onClick={() =>
                          handlePayDeposit(
                            shipment
                          )
                        }
                      >
                        {busyDepositId ===
                        shipment.id ? (
                          <>
                            <Loader2
                              size={
                                17
                              }
                            />

                            Se deschide plata…
                          </>
                        ) : (
                          <>
                            <ShieldCheck
                              size={
                                17
                              }
                            />

                            Plătește avansul
                          </>
                        )}
                      </button>

                      <p
                        style={{
                          ...subtleStyle,

                          margin:
                            "9px 0 0",

                          fontSize:
                            12,
                        }}
                      >
                        Plata este procesată securizat prin Stripe. Nu trebuie să îți creezi cont Artfest pentru a achita avansul.
                      </p>
                    </div>
                  )}

                  {isPaid &&
                    deposit.paidAt && (
                    <p
                      style={{
                        ...subtleStyle,

                        margin:
                          "15px 0 0",

                        fontSize:
                          12,
                      }}
                    >
                      Achitat la{" "}
                      {formatDate(
                        deposit.paidAt
                      )}
                    </p>
                  )}
                </>
              );
            })()}
          </section>
        )}

        {/* =================================================
            Pachete / artizani
        ================================================= */}

        {shipments.map(
          (shipment) => {
            const shipmentItems =
              itemsByShipment.get(
                shipment.id
              ) ||
              [];

            return (
              <section
                key={
                  shipment.id
                }
                style={
                  cardStyle
                }
              >
                <div
                  style={{
                    display:
                      "flex",

                    alignItems:
                      "center",

                    justifyContent:
                      "space-between",

                    gap:
                      12,

                    marginBottom:
                      16,

                    flexWrap:
                      "wrap",
                  }}
                >
                  <div
                    style={{
                      display:
                        "flex",

                      alignItems:
                        "center",

                      gap:
                        10,
                    }}
                  >
                    <Package
                      size={
                        21
                      }
                    />

                    <div>
                      <strong>
                        {shipment.vendorName ||
                          "Artizan"}
                      </strong>

                      <div
                        style={{
                          ...subtleStyle,

                          fontSize:
                            12,
                        }}
                      >
                        Pachet din această comandă
                      </div>
                    </div>
                  </div>

                  {shipment.trackingUrl && (
                    <a
                      href={
                        shipment.trackingUrl
                      }
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        ...secondaryButtonStyle,

                        textDecoration:
                          "none",
                      }}
                    >
                      <Truck
                        size={
                          16
                        }
                      />

                      Urmărește coletul

                      <ExternalLink
                        size={
                          14
                        }
                      />
                    </a>
                  )}
                </div>

                {shipmentItems.length ===
                  0 && (
                  <div
                    style={
                      subtleStyle
                    }
                  >
                    Nu sunt disponibile detaliile produselor pentru acest pachet.
                  </div>
                )}

                {shipmentItems.map(
                  (item) => {
                    const imageUrl =
                      getImageUrl(
                        item
                      );

                    return (
                      <div
                        key={
                          item.id
                        }
                        style={{
                          display:
                            "grid",

                          gridTemplateColumns:
                            "72px minmax(0, 1fr) auto",

                          gap:
                            12,

                          alignItems:
                            "center",

                          padding:
                            "12px 0",

                          borderTop:
                            "1px solid rgba(60, 40, 30, 0.08)",
                        }}
                      >
                        <div
                          style={{
                            width:
                              72,

                            height:
                              72,

                            borderRadius:
                              10,

                            overflow:
                              "hidden",

                            background:
                              "#f2efed",
                          }}
                        >
                          {imageUrl ? (
                            <img
                              src={
                                imageUrl
                              }
                              alt={
                                item.title ||
                                "Produs"
                              }
                              style={{
                                width:
                                  "100%",

                                height:
                                  "100%",

                                objectFit:
                                  "cover",
                              }}
                            />
                          ) : (
                            <div
                              style={{
                                width:
                                  "100%",

                                height:
                                  "100%",

                                display:
                                  "grid",

                                placeItems:
                                  "center",
                              }}
                            >
                              <Package
                                size={
                                  24
                                }
                              />
                            </div>
                          )}
                        </div>

                        <div>
                          <strong
                            style={{
                              display:
                                "block",

                              marginBottom:
                                5,
                            }}
                          >
                            {item.title ||
                              "Produs"}
                          </strong>

                          <ProductConfiguration
                            item={
                              item
                            }
                            onPreviewImage={
                              setImagePreview
                            }
                          />

                          <div
                            style={{
                              ...subtleStyle,

                              fontSize:
                                13,

                              marginTop:
                                6,
                            }}
                          >
                            Cantitate:{" "}
                            {item.qty}
                          </div>
                        </div>

                        <strong>
                          {money(
                            Number(
                              item.price ||
                                0
                            ) *
                              Number(
                                item.qty ||
                                  0
                              ),
                            order.currency
                          )}
                        </strong>
                      </div>
                    );
                  }
                )}
              </section>
            );
          }
        )}

        {/* =================================================
            Total
        ================================================= */}

        <section
          style={
            cardStyle
          }
        >
          <h2
            style={{
              margin:
                "0 0 14px",

              fontSize:
                18,
            }}
          >
            Sumar comandă
          </h2>

          <div
            style={{
              display:
                "grid",

              gap:
                9,
            }}
          >
            <div
              style={{
                display:
                  "flex",

                justifyContent:
                  "space-between",

                gap:
                  12,
              }}
            >
              <span
                style={
                  subtleStyle
                }
              >
                Produse
              </span>

              <strong>
                {money(
                  order.subtotal,
                  order.currency
                )}
              </strong>
            </div>

            <div
              style={{
                display:
                  "flex",

                justifyContent:
                  "space-between",

                gap:
                  12,
              }}
            >
              <span
                style={
                  subtleStyle
                }
              >
                Transport
              </span>

              <strong>
                {money(
                  order.shippingTotal,
                  order.currency
                )}
              </strong>
            </div>

            <div
              style={{
                display:
                  "flex",

                justifyContent:
                  "space-between",

                gap:
                  12,

                borderTop:
                  "1px solid rgba(60,40,30,.10)",

                marginTop:
                  4,

                paddingTop:
                  12,

                fontSize:
                  17,
              }}
            >
              <span>
                Total
              </span>

              <strong>
                {money(
                  order.total,
                  order.currency
                )}
              </strong>
            </div>
          </div>
        </section>

        {/* =================================================
            Livrare
        ================================================= */}

        <section
          style={
            cardStyle
          }
        >
          <h2
            style={{
              margin:
                "0 0 12px",

              fontSize:
                18,
            }}
          >
            Livrare
          </h2>

          {order.shippingStage && (
            <div
              style={{
                display:
                  "flex",

                alignItems:
                  "center",

                gap:
                  8,

                marginBottom:
                  13,

                fontWeight:
                  700,
              }}
            >
              <Truck
                size={
                  18
                }
              />

              {
                order
                  .shippingStage
                  .label
              }
            </div>
          )}

          <div
            style={
              subtleStyle
            }
          >
            <strong>
              {order.customerName ||
                order.shippingAddress
                  ?.name ||
                "Client"}
            </strong>

            <br />

            {order.shippingAddress
              ?.street ||
              ""}

            {order.shippingAddress
              ?.city
              ? `, ${order.shippingAddress.city}`
              : ""}

            <br />

            {order.shippingAddress
              ?.county ||
              ""}

            {order.customerPhone && (
              <>
                <br />
                Tel:{" "}
                {
                  order.customerPhone
                }
              </>
            )}
          </div>
        </section>

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

              inset:
                0,

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

                  top:
                    10,

                  right:
                    10,

                  zIndex:
                    2,

                  width:
                    38,

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

        {/* =================================================
            Footer guest
        ================================================= */}

        <section
          style={{
            textAlign:
              "center",

            padding:
              "8px 16px 24px",
          }}
        >
          <p
            style={
              subtleStyle
            }
          >
            Această pagină poate fi accesată prin linkul securizat primit pentru comandă. Păstrează linkul pentru a putea reveni la detaliile comenzii.
          </p>

          <button
            type="button"
            style={
              secondaryButtonStyle
            }
            disabled={
              refreshing
            }
            onClick={() =>
              loadOrder({
                silent:
                  true,
              })
            }
          >
            <RefreshCw
              size={
                16
              }
            />

            Actualizează comanda
          </button>
        </section>
      </div>
    </div>
  );
}