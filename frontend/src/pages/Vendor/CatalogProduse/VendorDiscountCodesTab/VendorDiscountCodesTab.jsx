import {
  useCallback,
  useEffect,
  useState,
} from "react";

import { api } from "../../../../lib/api.js";

import styles from "./VendorDiscountCodesTab.module.css";

const SCOPE_ALL_PRODUCTS =
  "ALL_PRODUCTS";

const SCOPE_COLLECTION =
  "VENDOR_COLLECTION";

/*
 * "Ce vrei să promovezi?" - regula finală de business (audit
 * 2026-09-14). Un cod e ORICE din cele două, niciodată un mix -
 * înlocuiește split-ul Artfest/Vendor pe același cod (audit
 * 2026-09-13, rundă anterioară).
 */
const MODE_OWN_PRODUCTS = "OWN_PRODUCTS";
const MODE_ALL_ARTFEST = "ALL_ARTFEST";

const EMPTY_FORM = {
  code: "",
  name: "",
  description: "",
  promotionMode: MODE_OWN_PRODUCTS,
  scope:
    SCOPE_ALL_PRODUCTS,
  vendorCollectionId:
    "",
  discountPercent: 0,
  startsAt: "",
  endsAt: "",
  usageLimit: "",
  usageLimitPerUser: 1,
  minimumOrderLei: "",
  maxDiscountLei: "",
};

export default function VendorDiscountCodesTab() {
  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    discountCodes,
    setDiscountCodes,
  ] = useState([]);

  const [
    collections,
    setCollections,
  ] = useState([]);

  const [
    maxArtfestDiscountPercent,
    setMaxArtfestDiscountPercent,
  ] = useState(5);

  const [
    maxTotalDiscountPercent,
    setMaxTotalDiscountPercent,
  ] = useState(50);

  const [
    error,
    setError,
  ] = useState("");

  const [
    success,
    setSuccess,
  ] = useState("");

  const [
    formOpen,
    setFormOpen,
  ] = useState(false);

  const [
    editCode,
    setEditCode,
  ] = useState(null);

  const [
    form,
    setForm,
  ] = useState(
    EMPTY_FORM
  );

  const [
    saving,
    setSaving,
  ] = useState(false);

  const [
    busyId,
    setBusyId,
  ] = useState("");

  const [
    copiedId,
    setCopiedId,
  ] = useState("");

  /* =========================================================
     DRAWER COMENZI PE COD
  ========================================================= */

  const [ordersDrawerCode, setOrdersDrawerCode] = useState(null);
  const [ordersDrawerItems, setOrdersDrawerItems] = useState([]);
  const [ordersDrawerLoading, setOrdersDrawerLoading] = useState(false);
  const [ordersDrawerError, setOrdersDrawerError] = useState("");

  async function openOrdersDrawer(code) {
    setOrdersDrawerCode(code);
    setOrdersDrawerItems([]);
    setOrdersDrawerError("");
    setOrdersDrawerLoading(true);

    try {
      const res = await api(
        `/api/vendor/discount-codes/${encodeURIComponent(code.id)}/orders`
      );
      setOrdersDrawerItems(Array.isArray(res?.items) ? res.items : []);
    } catch (err) {
      setOrdersDrawerError(
        err?.data?.message ||
          err?.message ||
          "Nu am putut încărca comenzile pentru acest cod."
      );
    } finally {
      setOrdersDrawerLoading(false);
    }
  }

  function closeOrdersDrawer() {
    setOrdersDrawerCode(null);
    setOrdersDrawerItems([]);
    setOrdersDrawerError("");
  }

  /* =========================================================
     ESC PENTRU FORMULAR
  ========================================================= */

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key !== "Escape" || !formOpen) {
        return;
      }

      setFormOpen(false);
      setEditCode(null);
      setForm({ ...EMPTY_FORM });
    }

    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [formOpen]);

  /* =========================================================
     LOAD
  ========================================================= */

  const loadData =
    useCallback(
      async () => {
        setLoading(
          true
        );

        setError(
          ""
        );

        try {
          const [
            codesData,
            collectionsData,
          ] =
            await Promise.all([
              api(
                "/api/vendor/discount-codes"
              ),

              api(
                "/api/vendor/collections"
              ),
            ]);

          setDiscountCodes(
            Array.isArray(
              codesData
                ?.discountCodes
            )
              ? codesData
                  .discountCodes
              : []
          );

          setMaxArtfestDiscountPercent(
            Number(
              codesData
                ?.maxArtfestDiscountPercent ||
                5
            )
          );

          setMaxTotalDiscountPercent(
            Number(
              codesData
                ?.maxTotalDiscountPercent ||
                50
            )
          );

          setCollections(
            Array.isArray(
              collectionsData
                ?.collections
            )
              ? collectionsData
                  .collections
              : []
          );
        } catch (err) {
          setError(
            err?.data
              ?.message ||
              err?.message ||
              "Nu am putut încărca codurile de reducere."
          );
        } finally {
          setLoading(
            false
          );
        }
      },
      []
    );

  useEffect(() => {
    loadData();
  }, [
    loadData,
  ]);

  /* =========================================================
     FORM
  ========================================================= */

  function resetForm() {
    setForm({ ...EMPTY_FORM });

    setEditCode(
      null
    );
  }

  function openCreate() {
    resetForm();

    setFormOpen(
      true
    );

    setError(
      ""
    );

    setSuccess(
      ""
    );
  }

  function openEdit(
    code
  ) {
    setEditCode(
      code
    );

    /*
     * promotionMode NU e editabil (fixat la creare, vezi
     * vendorDiscountCodesRoutes.js) - citit direct din serializare
     * (derivePromotionMode), nu recalculat aici.
     */
    const promotionMode =
      code.promotionMode === MODE_OWN_PRODUCTS
        ? MODE_OWN_PRODUCTS
        : MODE_ALL_ARTFEST;

    const scope =
      code.scope ===
      SCOPE_COLLECTION
        ? SCOPE_COLLECTION
        : SCOPE_ALL_PRODUCTS;

    setForm({
      code:
        code.code ||
        "",

      name:
        code.name ||
        "",

      description:
        code.description ||
        "",

      promotionMode,

      scope,

      vendorCollectionId:
        scope ===
        SCOPE_COLLECTION
          ? code.vendorCollectionId ||
            ""
          : "",

      discountPercent: Number(
        code.totalDiscountPercent ?? code.discountPercent ?? 0
      ),

      startsAt:
        toDateTimeLocal(
          code.startsAt
        ),

      endsAt:
        toDateTimeLocal(
          code.endsAt
        ),

      usageLimit:
        code.usageLimit ??
        "",

      usageLimitPerUser:
        code.usageLimitPerUser ??
        1,

      minimumOrderLei:
        code.minimumOrderCents !=
        null
          ? (
              Number(
                code.minimumOrderCents
              ) / 100
            ).toString()
          : "",

      maxDiscountLei:
        code.maxDiscountCents !=
        null
          ? (
              Number(
                code.maxDiscountCents
              ) / 100
            ).toString()
          : "",
    });

    setFormOpen(
      true
    );

    setError(
      ""
    );

    setSuccess(
      ""
    );
  }

  function closeForm() {
    setFormOpen(
      false
    );

    resetForm();
  }

  function changeScope(
    nextScope
  ) {
    setForm(
      (
        current
      ) => ({
        ...current,

        scope:
          nextScope,

        vendorCollectionId:
          nextScope ===
          SCOPE_COLLECTION
            ? current
                .vendorCollectionId
            : "",

        /*
         * Plafonul diferă (0-5% platformă vs 0-50% vendor, vezi
         * audit 2026-09-15) - resetăm ca să nu rămână o valoare
         * validă doar în vechiul mod.
         */
        discountPercent: 0,
      })
    );
  }

  /*
   * Schimbarea modului resetează discountul (plafoanele diferă -
   * 0-50% OWN_PRODUCTS, 0-5% ALL_ARTFEST) și scope-ul (irelevant
   * pentru OWN_PRODUCTS - se aplică mereu tuturor produselor tale).
   */
  function changeMode(nextMode) {
    setForm((current) => ({
      ...current,
      promotionMode: nextMode,
      discountPercent: 0,
      scope: SCOPE_ALL_PRODUCTS,
      vendorCollectionId: "",
    }));
  }

  /* =========================================================
     SAVE
  ========================================================= */

  async function saveCode(
    event
  ) {
    event.preventDefault();

    setError(
      ""
    );

    setSuccess(
      ""
    );

    const cleanCode =
      form.code
        .trim()
        .toUpperCase()
        .replace(
          /\s+/g,
          ""
        );

    if (
      cleanCode.length <
      3
    ) {
      setError(
        "Codul trebuie să aibă minimum 3 caractere."
      );

      return;
    }

    const isOwnProducts = form.promotionMode === MODE_OWN_PRODUCTS;

    if (
      !isOwnProducts &&
      form.scope !==
        SCOPE_ALL_PRODUCTS &&
      form.scope !==
        SCOPE_COLLECTION
    ) {
      setError(
        "Alege unde se aplică reducerea."
      );

      return;
    }

    if (
      !isOwnProducts &&
      form.scope ===
        SCOPE_COLLECTION &&
      !form
        .vendorCollectionId
    ) {
      setError(
        "Alege colecția pe care se aplică acest cod."
      );

      return;
    }

    const discountPercent = Number(form.discountPercent);

    /*
     * VENDOR_COLLECTION (audit 2026-09-15, regula finală de business):
     * finanțat 100% de vendor, ca OWN_PRODUCTS - plafon 0-50%, nu 0-5%.
     * Mirror EXACT al isVendorFunded din vendorDiscountCodesRoutes.js.
     */
    const isVendorFunded =
      isOwnProducts || form.scope === SCOPE_COLLECTION;

    const maxDiscountForMode = isVendorFunded
      ? maxTotalDiscountPercent
      : maxArtfestDiscountPercent;

    if (
      !Number.isInteger(discountPercent) ||
      discountPercent < 0 ||
      discountPercent > maxDiscountForMode
    ) {
      setError(
        isVendorFunded
          ? `Reducerea pentru clienții tăi trebuie să fie între 0% și ${maxDiscountForMode}%.`
          : `Reducerea oferită de Artfest trebuie să fie între 0% și ${maxDiscountForMode}%.`
      );

      return;
    }

    const minimumOrderLei =
      form.minimumOrderLei ===
      ""
        ? null
        : Number(
            form.minimumOrderLei
          );

    const maxDiscountLei =
      form.maxDiscountLei ===
      ""
        ? null
        : Number(
            form.maxDiscountLei
          );

    if (
      minimumOrderLei !==
        null &&
      (
        !Number.isFinite(
          minimumOrderLei
        ) ||
        minimumOrderLei <
          0
      )
    ) {
      setError(
        "Comanda minimă nu este validă."
      );

      return;
    }

    if (
      maxDiscountLei !==
        null &&
      (
        !Number.isFinite(
          maxDiscountLei
        ) ||
        maxDiscountLei <=
          0
      )
    ) {
      setError(
        "Reducerea maximă nu este validă."
      );

      return;
    }

    const body = {
      code:
        cleanCode,

      name:
        form.name.trim() ||
        null,

      description:
        form.description
          .trim() ||
        null,

      /*
       * promotionMode trimis DOAR la creare (backend îl ignoră/nu-l
       * acceptă la editare - modul nu se schimbă după creare, vezi
       * UpdateDiscountCodeSchema din vendorDiscountCodesRoutes.js).
       */
      ...(editCode?.id ? {} : { promotionMode: form.promotionMode }),

      vendorCollectionId:
        !isOwnProducts &&
        form.scope ===
        SCOPE_COLLECTION
          ? form
              .vendorCollectionId
          : null,

      discountPercent,

      startsAt:
        form.startsAt
          ? new Date(
              form.startsAt
            ).toISOString()
          : null,

      endsAt:
        form.endsAt
          ? new Date(
              form.endsAt
            ).toISOString()
          : null,

      usageLimit:
        form.usageLimit !==
        ""
          ? Number(
              form.usageLimit
            )
          : null,

      usageLimitPerUser:
        form
          .usageLimitPerUser !==
        ""
          ? Number(
              form
                .usageLimitPerUser
            )
          : null,

      minimumOrderCents:
        minimumOrderLei !==
        null
          ? Math.round(
              minimumOrderLei *
                100
            )
          : null,

      maxDiscountCents:
        maxDiscountLei !==
        null
          ? Math.round(
              maxDiscountLei *
                100
            )
          : null,
    };

    setSaving(
      true
    );

    try {
      if (
        editCode?.id
      ) {
        await api(
          `/api/vendor/discount-codes/${encodeURIComponent(
            editCode.id
          )}`,
          {
            method:
              "PATCH",

            body,
          }
        );

        setSuccess(
          "Codul de reducere a fost actualizat."
        );
      } else {
        await api(
          "/api/vendor/discount-codes",
          {
            method:
              "POST",

            body,
          }
        );

        setSuccess(
          "Codul de reducere a fost creat."
        );
      }

      closeForm();

      await loadData();
    } catch (err) {
      setError(
        err?.data
          ?.message ||
          err?.message ||
          "Nu am putut salva codul de reducere."
      );
    } finally {
      setSaving(
        false
      );
    }
  }

  /* =========================================================
     TOGGLE
  ========================================================= */

  async function toggleCode(
    code
  ) {
    if (
      !code?.id
    ) {
      return;
    }

    setBusyId(
      code.id
    );

    setError(
      ""
    );

    setSuccess(
      ""
    );

    try {
      const data =
        await api(
          `/api/vendor/discount-codes/${encodeURIComponent(
            code.id
          )}/toggle`,
          {
            method:
              "PATCH",
          }
        );

      setSuccess(
        data?.message ||
          "Statusul codului a fost actualizat."
      );

      await loadData();
    } catch (err) {
      setError(
        err?.data
          ?.message ||
          err?.message ||
          "Nu am putut modifica statusul codului."
      );
    } finally {
      setBusyId(
        ""
      );
    }
  }

  /* =========================================================
     DELETE
  ========================================================= */

  async function deleteCode(
    code
  ) {
    const confirmed =
      window.confirm(
        `Ștergi codul „${code.code}”?`
      );

    if (
      !confirmed
    ) {
      return;
    }

    setBusyId(
      code.id
    );

    setError(
      ""
    );

    setSuccess(
      ""
    );

    try {
      await api(
        `/api/vendor/discount-codes/${encodeURIComponent(
          code.id
        )}`,
        {
          method:
            "DELETE",
        }
      );

      setSuccess(
        "Codul de reducere a fost șters."
      );

      await loadData();
    } catch (err) {
      setError(
        err?.data
          ?.message ||
          err?.message ||
          "Nu am putut șterge codul."
      );
    } finally {
      setBusyId(
        ""
      );
    }
  }

  /* =========================================================
     COPY
  ========================================================= */

  async function copyCode(
    code
  ) {
    try {
      await navigator.clipboard.writeText(
        code.code
      );

      setCopiedId(
        code.id
      );

      window.setTimeout(
        () =>
          setCopiedId(
            ""
          ),
        1500
      );
    } catch {
      setError(
        "Nu am putut copia codul."
      );
    }
  }

  /* =========================================================
     UI
  ========================================================= */

  return (
    <div
      className={
        styles.modal
      }
    >
        <header
          className={
            styles.header
          }
        >
          <div>
            <div
              className={
                styles.eyebrow
              }
            >
              PROMOVARE
            </div>

            <h2>
              Codurile mele de reducere
            </h2>

            <p>
              Creează coduri de reducere pentru clienții și comunitatea ta.
              Artfest poate susține până la{" "}
              <strong>
                {
                  maxArtfestDiscountPercent
                }%
              </strong>
              , iar magazinul tău poate adăuga liber orice procent dorești
              (total maximum{" "}
              <strong>
                {
                  maxTotalDiscountPercent
                }%
              </strong>
              ).
            </p>
          </div>

          <div
            className={
              styles.headerActions
            }
          >
            <button
              type="button"
              className={
                styles.primaryButton
              }
              onClick={
                openCreate
              }
            >
              + Cod nou
            </button>

          </div>
        </header>

        {error && (
          <div
            className={
              styles.errorBox
            }
          >
            {error}
          </div>
        )}

        {success && (
          <div
            className={
              styles.successBox
            }
          >
            {success}
          </div>
        )}

        {loading ? (
          <div
            className={
              styles.centerState
            }
          >
            Se încarcă…
          </div>
        ) : !discountCodes.length ? (
          <div
            className={
              styles.emptyState
            }
          >
            <div
              className={
                styles.emptyIcon
              }
            >
              %
            </div>

            <strong>
              Nu ai creat încă niciun cod
            </strong>

            <p>
              Creează un cod de reducere pentru clienții tăi. Îl poți aplica tuturor produselor Artfest eligibile sau doar unei colecții create de tine.
            </p>

            <button
              type="button"
              className={
                styles.primaryButton
              }
              onClick={
                openCreate
              }
            >
              Creează primul cod
            </button>
          </div>
        ) : (
          <div
            className={
              styles.codeList
            }
          >
            {discountCodes.map(
              (
                code
              ) => (
                <article
                  key={
                    code.id
                  }
                  className={
                    styles.codeCard
                  }
                >
                  <div
                    className={
                      styles.codeMain
                    }
                  >
                    <div
                      className={
                        styles.codeTop
                      }
                    >
                      <strong
                        className={
                          styles.codeText
                        }
                      >
                        {
                          code.code
                        }
                      </strong>

                      <span
                        className={
                          code.isActive
                            ? styles.activeBadge
                            : styles.inactiveBadge
                        }
                      >
                        {code.isActive
                          ? "ACTIV"
                          : "OPRIT"}
                      </span>

                      <span
                        className={
                          styles.percentBadge
                        }
                      >
                        {
                          code.discountPercent
                        }%
                      </span>
                    </div>

                    {code.name && (
                      <div
                        className={
                          styles.codeName
                        }
                      >
                        {
                          code.name
                        }
                      </div>
                    )}

                    <div
                      className={
                        styles.codeMeta
                      }
                    >
                      <span>
                        {code.promotionMode === MODE_OWN_PRODUCTS
                          ? "Doar produsele tale · susținută integral de magazinul tău"
                          : code.vendorDiscountPercent > 0 &&
                            code.artfestDiscountPercent > 0
                          ? `Toate produsele Artfest · Artfest susține ${code.artfestDiscountPercent}%, magazinul tău susține ${code.vendorDiscountPercent}%`
                          : "Toate produsele Artfest · susținută integral de Artfest"}
                      </span>

                      <span>
                        Se aplică la:{" "}
                        <strong>
                          {code.promotionMode === MODE_OWN_PRODUCTS
                            ? "Toate produsele tale"
                            : code.scope === SCOPE_COLLECTION
                            ? code.collection?.title || "Colecție"
                            : "Toate produsele Artfest eligibile"}
                        </strong>
                      </span>

                      <span>
                        Folosit de{" "}
                        {code.usedCount ||
                          0}{" "}
                        ori
                        {code.usageLimit
                          ? ` din ${code.usageLimit}`
                          : ""}
                      </span>

                      {(code.startsAt ||
                        code.endsAt) && (
                        <span>
                          {code.startsAt
                            ? `Din ${formatDateTime(
                                code.startsAt
                              )}`
                            : "Activ imediat"}

                          {code.endsAt
                            ? ` · până la ${formatDateTime(
                                code.endsAt
                              )}`
                            : ""}
                        </span>
                      )}
                    </div>

                    {code.stats && (
                      <div
                        className={styles.codeMeta}
                        style={{ marginTop: 6 }}
                      >
                        <span>
                          <strong>{code.stats.ordersCount}</strong> comenzi
                          generate
                        </span>
                        <span>
                          Vânzări:{" "}
                          <strong>
                            {code.stats.salesValue.toFixed(2)} lei
                          </strong>
                        </span>
                        <span>
                          Reducere totală:{" "}
                          <strong>
                            {code.stats.totalDiscount.toFixed(2)} lei
                          </strong>{" "}
                          (Artfest {code.stats.artfestFunded.toFixed(2)} ·
                          Magazin {code.stats.vendorFunded.toFixed(2)})
                        </span>
                        <span>
                          Net magazin generat:{" "}
                          <strong>
                            {code.stats.vendorNetGenerated.toFixed(2)} lei
                          </strong>
                        </span>
                      </div>
                    )}
                  </div>

                  <div
                    className={
                      styles.codeActions
                    }
                  >
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      onClick={() => openOrdersDrawer(code)}
                    >
                      Vezi comenzile
                    </button>

                    <button
                      type="button"
                      className={
                        styles.secondaryButton
                      }
                      onClick={() =>
                        copyCode(
                          code
                        )
                      }
                    >
                      {copiedId ===
                      code.id
                        ? "Copiat ✓"
                        : "Copiază"}
                    </button>

                    <button
                      type="button"
                      className={
                        styles.secondaryButton
                      }
                      onClick={() =>
                        openEdit(
                          code
                        )
                      }
                    >
                      Editează
                    </button>

                    <button
                      type="button"
                      className={
                        styles.secondaryButton
                      }
                      disabled={
                        busyId ===
                        code.id
                      }
                      onClick={() =>
                        toggleCode(
                          code
                        )
                      }
                    >
                      {code.isActive
                        ? "Oprește"
                        : "Activează"}
                    </button>

                    <button
                      type="button"
                      className={`${styles.secondaryButton} ${styles.dangerButton}`}
                      disabled={
                        busyId ===
                        code.id
                      }
                      onClick={() =>
                        deleteCode(
                          code
                        )
                      }
                    >
                      Șterge
                    </button>
                  </div>
                </article>
              )
            )}
          </div>
        )}

        {/* =====================================================
            CREATE / EDIT
        ===================================================== */}

        {formOpen && (
          <div
            className={
              styles.formOverlay
            }
            onMouseDown={
              closeForm
            }
          >
            <div
              className={
                styles.formSheet
              }
              onMouseDown={(
                event
              ) =>
                event.stopPropagation()
              }
            >
              <div
                className={
                  styles.formHeader
                }
              >
                <div>
                  <div
                    className={
                      styles.eyebrow
                    }
                  >
                    {editCode
                      ? "EDITARE"
                      : "COD NOU"}
                  </div>

                  <h3>
                    {editCode
                      ? `Editează ${editCode.code}`
                      : "Creează un cod de reducere"}
                  </h3>
                </div>

                <button
                  type="button"
                  className={
                    styles.closeButton
                  }
                  onClick={
                    closeForm
                  }
                  disabled={
                    saving
                  }
                >
                  ×
                </button>
              </div>

              <form
                onSubmit={
                  saveCode
                }
                className={
                  styles.form
                }
              >
                <div
                  className={
                    styles.formGrid
                  }
                >
                  <label
                    className={`${styles.field} ${styles.codeFieldWrap}`}
                  >
                    <span>
                      Cod *
                    </span>

                    <input
                      className={
                        styles.codeInput
                      }
                      value={
                        form.code
                      }
                      maxLength={
                        32
                      }
                      onChange={(
                        event
                      ) =>
                        setForm(
                          (
                            current
                          ) => ({
                            ...current,

                            code:
                              event.target
                                .value
                                .toUpperCase()
                                .replace(
                                  /\s+/g,
                                  ""
                                ),
                          })
                        )
                      }
                      placeholder="Ex: MAGAZIN5"
                    />
                  </label>
                </div>

                {/* ===============================================
                    PASUL 1 - CE VREI SĂ PROMOVEZI?
                    (regula finală de business, audit 2026-09-14 -
                    modul NU e editabil după creare)
                =============================================== */}

                <div className={styles.field}>
                  <span>Ce vrei să promovezi? *</span>

                  {editCode ? (
                    <small>
                      {form.promotionMode === MODE_OWN_PRODUCTS
                        ? "Doar produsele mele (nu se poate schimba după creare)"
                        : "Toate produsele Artfest (nu se poate schimba după creare)"}
                    </small>
                  ) : (
                    <div className={styles.modeGrid}>
                      <label className={styles.modeOption}>
                        <input
                          type="radio"
                          name="promotionMode"
                          checked={form.promotionMode === MODE_OWN_PRODUCTS}
                          onChange={() => changeMode(MODE_OWN_PRODUCTS)}
                        />{" "}
                        Doar produsele mele
                      </label>

                      <label className={styles.modeOption}>
                        <input
                          type="radio"
                          name="promotionMode"
                          checked={form.promotionMode === MODE_ALL_ARTFEST}
                          onChange={() => changeMode(MODE_ALL_ARTFEST)}
                        />{" "}
                        Toate produsele Artfest
                      </label>
                    </div>
                  )}
                </div>

                {/* ===============================================
                    DOAR PRODUSELE MELE - un singur câmp, 0-50%,
                    100% suportat de magazin
                =============================================== */}

                {form.promotionMode === MODE_OWN_PRODUCTS && (
                  <>
                    <div className={styles.formGrid}>
                      <label className={styles.field}>
                        <span>Reducere pentru clienții tăi</span>

                        <input
                          type="number"
                          min="0"
                          max={maxTotalDiscountPercent}
                          step="1"
                          value={form.discountPercent}
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              discountPercent:
                                event.target.value === ""
                                  ? 0
                                  : Math.max(
                                      0,
                                      Math.min(
                                        maxTotalDiscountPercent,
                                        Math.round(
                                          Number(event.target.value) || 0
                                        )
                                      )
                                    ),
                            }))
                          }
                        />
                      </label>
                    </div>

                    <div className={styles.infoBox}>
                      Artfest îți reduce comisionul de la 12% la 5% pentru
                      aceste vânzări. Ai un avantaj de 7 puncte procentuale
                      pe care îl poți transforma în reducere pentru
                      clienții tăi sau îl poți păstra în marja ta.
                      <br />
                      <br />
                      Dacă oferi o reducere mai mare de 7%, diferența
                      suplimentară va fi suportată din marja magazinului
                      tău.
                    </div>
                  </>
                )}

                {/* ===============================================
                    TOATE PRODUSELE ARTFEST - un singur câmp, 0-5%,
                    100% suportat de Artfest
                =============================================== */}

                {form.promotionMode === MODE_ALL_ARTFEST && (
                  <>
                    {/* ===============================================
                        SCOPE - "Toate produsele Artfest" e deja
                        stabilit de alegerea de sus (Pasul 1); singura
                        decizie reală rămasă e dacă vrei să restrângi
                        codul la o colecție de-a ta (audit 2026-09-14,
                        eliminare dublură formular). Mutat ÎNAINTEA
                        reducerii (audit 2026-09-15) - finanțarea
                        reducerii depinde acum de acest scop.
                    =============================================== */}

                    <label className={styles.checkboxField}>
                      <input
                        type="checkbox"
                        checked={form.scope === SCOPE_COLLECTION}
                        onChange={(event) =>
                          changeScope(
                            event.target.checked
                              ? SCOPE_COLLECTION
                              : SCOPE_ALL_PRODUCTS
                          )
                        }
                      />
                      <span>Limitează codul la o colecție de-a mea</span>
                    </label>

                    {form.scope !== SCOPE_COLLECTION && (
                      <small>
                        Fără această bifă, codul se aplică tuturor
                        produselor tale eligibile Artfest.
                      </small>
                    )}

                    {/* ===============================================
                        COLLECTION
                    =============================================== */}

                    {form.scope === SCOPE_COLLECTION && (
                      <label className={styles.field}>
                        <span>Colecție *</span>

                        <select
                          value={form.vendorCollectionId}
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              vendorCollectionId: event.target.value,
                            }))
                          }
                        >
                          <option value="">Alege colecția</option>

                          {collections.map((collection) => (
                            <option key={collection.id} value={collection.id}>
                              {collection.title}
                            </option>
                          ))}
                        </select>

                        {!collections.length && (
                          <small>
                            Nu ai încă nicio colecție. Alege „Toate produsele
                            Artfest eligibile” sau creează mai întâi o
                            colecție.
                          </small>
                        )}
                      </label>
                    )}

                    {/* ===============================================
                        REDUCERE - finanțare diferită (audit 2026-09-15):
                        colecție proprie -> 100% vendor, 0-50%, ca la
                        "Doar produsele mele"; altfel -> 100% Artfest,
                        0-5%, neschimbat.
                    =============================================== */}

                    {form.scope === SCOPE_COLLECTION ? (
                      <>
                        <div className={styles.formGrid}>
                          <label className={styles.field}>
                            <span>Reducere pentru clienții tăi</span>

                            <input
                              type="number"
                              min="0"
                              max={maxTotalDiscountPercent}
                              step="1"
                              value={form.discountPercent}
                              onChange={(event) =>
                                setForm((current) => ({
                                  ...current,
                                  discountPercent:
                                    event.target.value === ""
                                      ? 0
                                      : Math.max(
                                          0,
                                          Math.min(
                                            maxTotalDiscountPercent,
                                            Math.round(
                                              Number(event.target.value) || 0
                                            )
                                          )
                                        ),
                                }))
                              }
                            />

                            <small>
                              Opțională (poți lăsa 0%). Reducerea este
                              suportată de magazinul tău.
                            </small>
                          </label>
                        </div>

                        <div className={styles.infoBox}>
                          <strong>Beneficiu Artfest.</strong> Pentru
                          produsele tale cumpărate din această colecție,
                          comisionul Artfest este 5% (indiferent de
                          reducerea pe care o alegi mai sus). Pentru
                          produsele altor vendori incluse în colecția ta,
                          sellerul rămâne pe comisionul lui normal, iar tu
                          primești un comision de recomandare separat.
                        </div>
                      </>
                    ) : (
                      <div className={styles.formGrid}>
                        <label className={styles.field}>
                          <span>Reducere oferită de Artfest</span>

                          <select
                            value={form.discountPercent}
                            onChange={(event) =>
                              setForm((current) => ({
                                ...current,
                                discountPercent: Number(event.target.value),
                              }))
                            }
                          >
                            {Array.from(
                              { length: maxArtfestDiscountPercent + 1 },
                              (_, percent) => percent
                            ).map((percent) => (
                              <option key={percent} value={percent}>
                                {percent}%
                              </option>
                            ))}
                          </select>

                          <small>
                            Reducerea e suportată integral de Artfest -
                            magazinul tău (sau, pe produsul altui vendor,
                            sellerul) nu suportă niciun cost.
                          </small>
                        </label>
                      </div>
                    )}
                  </>
                )}

                <label
                  className={
                    styles.field
                  }
                >
                  <span>
                    Nume
                  </span>

                  <input
                    value={
                      form.name
                    }
                    onChange={(
                      event
                    ) =>
                      setForm(
                        (
                          current
                        ) => ({
                          ...current,

                          name:
                            event.target
                              .value,
                        })
                      )
                    }
                    placeholder="Ex: Cod comunitatea mea"
                  />
                </label>

                <div
                  className={
                    styles.formGrid
                  }
                >
                  <label
                    className={
                      styles.field
                    }
                  >
                    <span>
                      Începe la
                    </span>

                    <input
                      type="datetime-local"
                      value={
                        form.startsAt
                      }
                      onChange={(
                        event
                      ) =>
                        setForm(
                          (
                            current
                          ) => ({
                            ...current,

                            startsAt:
                              event.target
                                .value,
                          })
                        )
                      }
                    />
                  </label>

                  <label
                    className={
                      styles.field
                    }
                  >
                    <span>
                      Expiră la
                    </span>

                    <input
                      type="datetime-local"
                      value={
                        form.endsAt
                      }
                      onChange={(
                        event
                      ) =>
                        setForm(
                          (
                            current
                          ) => ({
                            ...current,

                            endsAt:
                              event.target
                                .value,
                          })
                        )
                      }
                    />
                  </label>
                </div>

                <div
                  className={
                    styles.formGrid
                  }
                >
                  <label
                    className={
                      styles.field
                    }
                  >
                    <span>
                      Limită totală
                    </span>

                    <input
                      type="number"
                      min="1"
                      max="10000"
                      value={
                        form.usageLimit
                      }
                      onChange={(
                        event
                      ) =>
                        setForm(
                          (
                            current
                          ) => ({
                            ...current,

                            usageLimit:
                              event.target
                                .value,
                          })
                        )
                      }
                      placeholder="Nelimitat"
                    />
                  </label>

                  <label
                    className={
                      styles.field
                    }
                  >
                    <span>
                      Utilizări / client
                    </span>

                    <input
                      type="number"
                      min="1"
                      max="10"
                      value={
                        form
                          .usageLimitPerUser
                      }
                      onChange={(
                        event
                      ) =>
                        setForm(
                          (
                            current
                          ) => ({
                            ...current,

                            usageLimitPerUser:
                              event.target
                                .value,
                          })
                        )
                      }
                    />
                  </label>
                </div>

                <div
                  className={
                    styles.formGrid
                  }
                >
                  <label
                    className={
                      styles.field
                    }
                  >
                    <span>
                      Comandă minimă
                    </span>

                    <div
                      className={
                        styles.moneyInput
                      }
                    >
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={
                          form.minimumOrderLei
                        }
                        onChange={(
                          event
                        ) =>
                          setForm(
                            (
                              current
                            ) => ({
                              ...current,

                              minimumOrderLei:
                                event.target
                                  .value,
                            })
                          )
                        }
                        placeholder="0"
                      />

                      <span>
                        lei
                      </span>
                    </div>
                  </label>

                  <label
                    className={
                      styles.field
                    }
                  >
                    <span>
                      Reducere maximă
                    </span>

                    <div
                      className={
                        styles.moneyInput
                      }
                    >
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={
                          form.maxDiscountLei
                        }
                        onChange={(
                          event
                        ) =>
                          setForm(
                            (
                              current
                            ) => ({
                              ...current,

                              maxDiscountLei:
                                event.target
                                  .value,
                            })
                          )
                        }
                        placeholder="Fără limită"
                      />

                      <span>
                        lei
                      </span>
                    </div>
                  </label>
                </div>

                <label
                  className={
                    styles.field
                  }
                >
                  <span>
                    Descriere
                  </span>

                  <textarea
                    rows={
                      3
                    }
                    value={
                      form.description
                    }
                    onChange={(
                      event
                    ) =>
                      setForm(
                        (
                          current
                        ) => ({
                          ...current,

                          description:
                            event.target
                              .value,
                        })
                      )
                    }
                    placeholder="Opțional..."
                  />
                </label>

                <div
                  className={
                    styles.infoBox
                  }
                >
                  {form.scope ===
                  SCOPE_COLLECTION
                    ? "Reducerea se aplică doar produselor din colecția selectată."
                    : "Reducerea se aplică tuturor produselor Artfest eligibile."}
                </div>

                <div
                  className={
                    styles.formActions
                  }
                >
                  <button
                    type="submit"
                    className={
                      styles.primaryButton
                    }
                    disabled={
                      saving
                    }
                  >
                    {saving
                      ? "Se salvează…"
                      : editCode
                        ? "Salvează modificările"
                        : "Creează codul"}
                  </button>

                  <button
                    type="button"
                    className={
                      styles.secondaryButton
                    }
                    disabled={
                      saving
                    }
                    onClick={
                      closeForm
                    }
                  >
                    Anulează
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* =====================================================
            DRAWER COMENZI PE COD
        ===================================================== */}

        {ordersDrawerCode && (
          <div
            className={styles.formOverlay}
            onMouseDown={closeOrdersDrawer}
          >
            <div
              className={styles.formSheet}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className={styles.formHeader}>
                <div>
                  <div className={styles.eyebrow}>COMENZI</div>
                  <h3>Comenzi generate de {ordersDrawerCode.code}</h3>
                </div>

                <button
                  type="button"
                  className={styles.closeButton}
                  onClick={closeOrdersDrawer}
                >
                  ×
                </button>
              </div>

              <div style={{ padding: 20 }}>
                {ordersDrawerLoading ? (
                  <div>Se încarcă…</div>
                ) : ordersDrawerError ? (
                  <div className={styles.errorBox}>{ordersDrawerError}</div>
                ) : !ordersDrawerItems.length ? (
                  <div>Acest cod nu a generat încă nicio comandă.</div>
                ) : (
                  <div style={{ display: "grid", gap: 10 }}>
                    {ordersDrawerItems.map((row) => (
                      <div
                        key={row.shipmentItemId}
                        className={styles.codeCard}
                      >
                        <div className={styles.codeTop}>
                          <strong>
                            Comanda #{row.orderNumber || row.orderId}
                          </strong>
                          <span>{formatDateTime(row.orderDate)}</span>
                        </div>

                        <div className={styles.codeMeta}>
                          <span>
                            {row.productTitle} × {row.qty}
                          </span>
                          <span>Valoare: {row.lineValue.toFixed(2)} lei</span>
                          <span>
                            Reducere: {row.discountAmount.toFixed(2)} lei
                            (Artfest {row.artfestFunded.toFixed(2)} · Vendor{" "}
                            {row.vendorFunded.toFixed(2)})
                          </span>
                          <span>Status comandă: {row.shipmentStatus}</span>
                          {row.vendorNet != null && (
                            <span>
                              Net vendor (componentă):{" "}
                              {row.vendorNet.toFixed(2)} lei
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
    </div>
  );
}

/* =========================================================
   DATE HELPERS
========================================================= */

function toDateTimeLocal(
  value
) {
  if (!value) {
    return "";
  }

  const date =
    new Date(
      value
    );

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return "";
  }

  const offset =
    date.getTimezoneOffset();

  const local =
    new Date(
      date.getTime() -
        offset *
          60 *
          1000
    );

  return local
    .toISOString()
    .slice(
      0,
      16
    );
}

function formatDateTime(
  value
) {
  if (!value) {
    return "";
  }

  const date =
    new Date(
      value
    );

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return "";
  }

  return new Intl.DateTimeFormat(
    "ro-RO",
    {
      dateStyle:
        "medium",

      timeStyle:
        "short",
    }
  ).format(
    date
  );
}