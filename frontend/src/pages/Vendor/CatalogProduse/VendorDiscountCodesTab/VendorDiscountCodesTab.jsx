import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { api } from "../../../../lib/api.js";
import {
  getDiscountCodeStatusLabel,
  isDiscountCodeEffectivelyActive,
} from "../../../../utils/discountCodeStatus.js";

import styles from "./VendorDiscountCodesTab.module.css";
import DiscountProductPicker, { MAX_CODE_PRODUCTS } from "./DiscountProductPicker.jsx";

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
// „Doar anumite produse din magazinul meu” (scope SELECTED_PRODUCTS, finanțat de magazin)
const MODE_SELECTED_PRODUCTS = "SELECTED_PRODUCTS";

/*
 * Pasul 2 - „Alege produsele eligibile”: cele 4 opțiuni, fiecare mapată
 * EXACT pe modurile/scope-urile existente (fără reguli noi de finanțare):
 *  - own        -> OWN_PRODUCTS        (VENDOR_ALL_PRODUCTS, magazinul, 0-50%)
 *  - selected   -> SELECTED_PRODUCTS   (SELECTED_PRODUCTS, magazinul, 0-50%)
 *  - collection -> ALL_ARTFEST + colecție (VENDOR_COLLECTION, magazinul, 0-50%)
 *  - artfest    -> ALL_ARTFEST          (ALL_PRODUCTS, Artfest, 0-5%)
 */
const SOURCE_OPTIONS = [
  {
    value: "store",
    title: "Din magazinul meu",
    hint: "Toate produsele tale sau doar anumite produse.",
  },
  {
    value: "collection",
    title: "O colecție proprie",
    hint: "Produsele din colecția aleasă.",
  },
  {
    value: "artfest",
    title: "Toate produsele Artfest",
    hint: "Reducere finanțată de Artfest, pe produsele tuturor creatorilor.",
  },
];

// „Din magazinul meu”: cele două variante (aceleași moduri ca până acum)
const STORE_OPTIONS = [
  { value: "own", label: "Toate produsele mele" },
  { value: "selected", label: "Doar anumite produse" },
];

const ELIGIBILITY_LABELS = {
  own: "Toate produsele din magazinul meu",
  selected: "Doar anumite produse din magazinul meu",
  collection: "O colecție proprie",
  artfest: "Toate produsele Artfest",
};

function eligibilityOf(form) {
  if (form.promotionMode === MODE_OWN_PRODUCTS) return "own";
  if (form.promotionMode === MODE_SELECTED_PRODUCTS) return "selected";
  return form.scope === SCOPE_COLLECTION ? "collection" : "artfest";
}

/* titlu de pas (01 / 02) - același stil ca la Colecții */
function StepHeading({ number, title, subtitle }) {
  return (
    <div className={styles.step}>
      <span className={styles.stepNumber} aria-hidden="true">
        {number}
      </span>
      <div className={styles.stepText}>
        <h4>{title}</h4>
        <p>{subtitle}</p>
      </div>
    </div>
  );
}

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

  // „Doar anumite produse”: selecția din Pasul 2 (trimisă ca productIds la salvare)
  const [selectedProducts, setSelectedProducts] = useState(() => new Map());
  const [selectedProductsLoading, setSelectedProductsLoading] = useState(false);

  // schimbare de produse care ar depăși plafonul reducerii deja completate: { next, max }
  const [pendingEligibility, setPendingEligibility] = useState(null);

  /*
   * Modalul de cod (Portal în document.body): cât e deschis, pagina din spate
   * nu se mai derulează, iar overlay-ul ocupă EXACT zona vizibilă
   * (visualViewport) - pe mobil, cu tastatura deschisă, butoanele de jos
   * rămân deasupra tastaturii. Și lățimea vine de aici: dacă pagina din spate
   * e mai lată decât ecranul, modalul nu iese în afara lui.
   */
  const codeOverlayRef = useRef(null);

  useEffect(() => {
    if (!formOpen) return undefined;

    const body = document.body;
    const previousOverflow = body.style.overflow;
    body.style.overflow = "hidden";

    const viewport = window.visualViewport;
    const fit = () => {
      const el = codeOverlayRef.current;
      if (!el || !viewport) return;
      el.style.top = `${viewport.offsetTop}px`;
      el.style.left = `${viewport.offsetLeft}px`;
      el.style.width = `${viewport.width}px`;
      el.style.height = `${viewport.height}px`;

      // tastatura s-a deschis: câmpul activ - deasupra barei de butoane (scroll-padding)
      const active = document.activeElement;
      if (active && el.contains(active) && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) {
        window.requestAnimationFrame(() => active.scrollIntoView({ block: "nearest" }));
      }
    };
    fit();
    viewport?.addEventListener("resize", fit);
    viewport?.addEventListener("scroll", fit);

    return () => {
      body.style.overflow = previousOverflow;
      viewport?.removeEventListener("resize", fit);
      viewport?.removeEventListener("scroll", fit);
    };
  }, [formOpen]);

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
    setSelectedProducts(new Map());
    setPendingEligibility(null);

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
        : code.promotionMode === MODE_SELECTED_PRODUCTS
          ? MODE_SELECTED_PRODUCTS
          : MODE_ALL_ARTFEST;

    // produsele codului (cu starea lor) - doar pentru „Doar anumite produse”
    setSelectedProducts(new Map());
    if (promotionMode === MODE_SELECTED_PRODUCTS && code.id) {
      setSelectedProductsLoading(true);
      api(`/api/vendor/discount-codes/${encodeURIComponent(code.id)}`)
        .then((data) => {
          const list = Array.isArray(data?.discountCode?.selectedProducts) ? data.discountCode.selectedProducts : [];
          setSelectedProducts(new Map(list.map((p) => [p.id, p])));
        })
        .catch(() => setError("Nu am putut încărca produsele acestui cod."))
        .finally(() => setSelectedProductsLoading(false));
    }

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

  /*
   * Pasul 1: produsele eligibile -> modul + scope-ul existente (aceleași
   * reguli financiare). Reducerea deja completată NU se mai șterge în tăcere:
   *  - dacă e compatibilă cu noul plafon (50% magazin / 5% Artfest), rămâne;
   *  - dacă îl depășește, cerem confirmare și o aducem la plafon.
   * Colecția aleasă și produsele bifate rămân în formular dacă revii la ele
   * (se trimit doar pentru opțiunea lor).
   */
  function eligibilityMax(next) {
    return next === "artfest" ? maxArtfestDiscountPercent : maxTotalDiscountPercent;
  }

  function applyEligibility(next, { clampTo = null } = {}) {
    setPendingEligibility(null);
    setForm((current) => ({
      ...current,
      promotionMode:
        next === "own" ? MODE_OWN_PRODUCTS : next === "selected" ? MODE_SELECTED_PRODUCTS : MODE_ALL_ARTFEST,
      scope: next === "collection" ? SCOPE_COLLECTION : SCOPE_ALL_PRODUCTS,
      discountPercent: clampTo === null ? current.discountPercent : Math.min(Number(current.discountPercent) || 0, clampTo),
    }));
  }

  function changeEligibility(next) {
    if (next === eligibilityOf(form)) return;
    const max = eligibilityMax(next);
    if ((Number(form.discountPercent) || 0) > max) {
      setPendingEligibility({ next, max });
      return;
    }
    applyEligibility(next);
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
    const isSelectedProducts = form.promotionMode === MODE_SELECTED_PRODUCTS;

    /*
     * Produsele care au ajuns între timp la ALT magazin nu mai primesc
     * reducerea și nu mai pot fi salvate pe cod (backend-ul le respinge) -
     * le scoatem din lista trimisă; restul selecției rămâne neschimbată.
     */
    const productIdsToSave = [...selectedProducts.values()]
      .filter((p) => p.status !== "other_store")
      .map((p) => p.id);

    if (isSelectedProducts && !productIdsToSave.length) {
      setError("Alege cel puțin un produs în Pasul 2.");

      return;
    }

    if (isSelectedProducts && selectedProducts.size > MAX_CODE_PRODUCTS) {
      setError(`Un cod poate avea maximum ${MAX_CODE_PRODUCTS} de produse.`);

      return;
    }

    if (
      !isOwnProducts &&
      !isSelectedProducts &&
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
      !isSelectedProducts &&
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
      isOwnProducts || isSelectedProducts || form.scope === SCOPE_COLLECTION;

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

      // „Doar anumite produse”: lista completă (backend-ul o verifică strict)
      ...(isSelectedProducts ? { productIds: productIdsToSave } : {}),

      vendorCollectionId:
        !isOwnProducts &&
        !isSelectedProducts &&
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
              Creează un cod de reducere pentru clienții tăi. Îl poți aplica tuturor produselor tale, doar anumitor produse, unei colecții create de tine sau tuturor produselor Artfest (reducere finanțată de Artfest).
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

                      {/* status efectiv din backend (effectiveStatus), nu din isActive */}
                      <span
                        className={
                          isDiscountCodeEffectivelyActive(code)
                            ? styles.activeBadge
                            : styles.inactiveBadge
                        }
                      >
                        {getDiscountCodeStatusLabel(
                          code
                        )}
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
                          : code.promotionMode === MODE_SELECTED_PRODUCTS
                          ? "Anumite produse ale tale · susținută integral de magazinul tău"
                          : code.scope === SCOPE_COLLECTION && code.fundingSource === "VENDOR"
                          ? "Colecția ta · susținută integral de magazinul tău"
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
                            : code.promotionMode === MODE_SELECTED_PRODUCTS
                            ? code.selectedProductsCount === 1
                              ? "1 produs ales"
                              : `${code.selectedProductsCount || 0} produse alese`
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

        {formOpen && createPortal(
          <div
            ref={codeOverlayRef}
            className={`${styles.formOverlay} ${styles.codeOverlay}`}
            onMouseDown={
              closeForm
            }
          >
            <div
              className={`${styles.formSheet} ${styles.codeSheet}`}
              role="dialog"
              aria-modal="true"
              aria-label={editCode ? `Editează ${editCode.code}` : "Creează un cod de reducere"}
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

              <form onSubmit={saveCode} className={styles.form}>
                {/* =============================================
                    PASUL 1 - produsele (decid plafonul și cine suportă reducerea)
                ============================================= */}
                <StepHeading
                  number="01"
                  title="Pasul 1 — Alege produsele"
                  subtitle="Alege produsele pentru care va fi valabil codul de reducere."
                />

                <section className={styles.stepCard} aria-label="Pasul 1">
                  <div className={styles.sourceGrid} role="radiogroup" aria-label="Produse eligibile">
                    {SOURCE_OPTIONS.map((option) => {
                      const current = eligibilityOf(form);
                      const active =
                        option.value === "store" ? current === "own" || current === "selected" : current === option.value;
                      /*
                       * La editare, tipul de bază nu se schimbă (regula existentă);
                       * un cod Artfest poate trece între colecție și toate produsele.
                       */
                      const locked =
                        Boolean(editCode) &&
                        !active &&
                        !(form.promotionMode === MODE_ALL_ARTFEST && option.value !== "store");

                      return (
                        <button
                          key={option.value}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          disabled={locked}
                          className={active ? styles.eligibilityActive : styles.eligibility}
                          onClick={() =>
                            option.value === "store"
                              ? !active && changeEligibility("own")
                              : changeEligibility(option.value)
                          }
                        >
                          <span className={styles.eligibilityDot} aria-hidden="true" />
                          <span className={styles.eligibilityText}>
                            <strong>{option.title}</strong>
                            <span>{option.hint}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {eligibilityOf(form) === "own" || eligibilityOf(form) === "selected" ? (
                    <div className={styles.storeChoice} role="radiogroup" aria-label="Produsele din magazinul meu">
                      {STORE_OPTIONS.map((option) => {
                        const active = eligibilityOf(form) === option.value;
                        return (
                          <button
                            key={option.value}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            disabled={Boolean(editCode) && !active}
                            className={active ? styles.storeChoiceActive : styles.storeChoiceItem}
                            onClick={() => changeEligibility(option.value)}
                          >
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}

                  {pendingEligibility ? (
                    <div className={styles.confirmChange} role="alertdialog" aria-live="assertive">
                      <p>
                        <strong>Schimbi produsele eligibile?</strong> Reducerea completată ({form.discountPercent}%)
                        depășește maximul de {pendingEligibility.max}% pentru „
                        {ELIGIBILITY_LABELS[pendingEligibility.next]}”. Dacă continui, reducerea devine{" "}
                        {pendingEligibility.max}%. Celelalte setări ale codului rămân neschimbate.
                      </p>
                      <div className={styles.confirmActions}>
                        <button type="button" className={styles.secondaryButton} onClick={() => setPendingEligibility(null)}>
                          Păstrează alegerea curentă
                        </button>
                        <button
                          type="button"
                          className={styles.primaryButton}
                          onClick={() =>
                            applyEligibility(pendingEligibility.next, { clampTo: pendingEligibility.max })
                          }
                        >
                          Continuă cu {pendingEligibility.max}%
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {editCode && form.promotionMode !== MODE_ALL_ARTFEST ? (
                    <small className={styles.lockedNote}>
                      Tipul codului nu se mai poate schimba după creare. Pentru alt tip, creează un cod nou.
                    </small>
                  ) : null}

                  {eligibilityOf(form) === "own" ? (
                    <div className={styles.infoBox}>
                      Reducerea se aplică tuturor produselor tale, inclusiv celor publicate de acum înainte, și e
                      suportată de magazinul tău. Artfest îți reduce comisionul de la 12% la 5% pentru aceste vânzări:
                      ai un avantaj de 7 puncte procentuale, pe care îl poți transforma în reducere pentru clienți
                      sau îl poți păstra în marja ta. Peste 7%, diferența e suportată din marja magazinului.
                    </div>
                  ) : null}

                  {eligibilityOf(form) === "selected" ? (
                    <>
                      <div className={styles.infoBox}>
                        Doar produsele bifate primesc reducerea, suportată de magazinul tău; comisionul Artfest e 5%
                        pentru aceste vânzări, ca la „Toate produsele din magazinul meu”. Codul nu reduce niciodată
                        produsele altor magazine și nu se aplică cererilor personalizate fără produs.
                      </div>
                      {selectedProductsLoading ? (
                        <div className={styles.infoBox}>Se încarcă produsele codului…</div>
                      ) : (
                        <DiscountProductPicker
                          selected={selectedProducts}
                          onChange={setSelectedProducts}
                          maxProducts={MAX_CODE_PRODUCTS}
                        />
                      )}
                    </>
                  ) : null}

                  {eligibilityOf(form) === "collection" ? (
                    <>
                      <label className={styles.field}>
                        <span>Colecție *</span>
                        <select
                          value={form.vendorCollectionId}
                          onChange={(event) =>
                            setForm((current) => ({ ...current, vendorCollectionId: event.target.value }))
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
                          <small>Nu ai încă nicio colecție. Creează mai întâi o colecție sau alege altă opțiune.</small>
                        )}
                      </label>
                      <div className={styles.infoBox}>
                        <strong>Beneficiu Artfest.</strong> Reducerea se aplică doar produselor din colecția aleasă
                        și e suportată de magazinul tău. Pentru produsele tale cumpărate din colecție, comisionul
                        Artfest este 5%. Pentru produsele altor creatori din colecție, vânzătorul rămâne pe comisionul
                        lui normal, iar tu primești un comision de recomandare separat.
                      </div>
                    </>
                  ) : null}

                  {eligibilityOf(form) === "artfest" ? (
                    <div className={styles.infoBox}>
                      <strong>Finanțat de Artfest.</strong> Reducerea, de maximum {maxArtfestDiscountPercent}%, e
                      suportată integral de Artfest și se aplică produselor <strong>tuturor creatorilor Artfest</strong>,
                      nu doar alor tale. Nici magazinul tău, nici vânzătorul altui produs nu suportă vreun cost.
                    </div>
                  ) : null}
                </section>

                {/* =============================================
                    PASUL 2 - codul: valoare, perioadă, condiții
                ============================================= */}
                <StepHeading
                  number="02"
                  title="Pasul 2 — Creează codul de reducere"
                  subtitle="Configurează codul, reducerea, perioada și condițiile de utilizare."
                />

                <section className={styles.stepCard} aria-label="Pasul 2">
                  <div className={styles.formGrid}>
                    <label className={`${styles.field} ${styles.codeFieldWrap}`}>
                      <span>Cod *</span>
                      <input
                        className={styles.codeInput}
                        value={form.code}
                        maxLength={32}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            code: event.target.value.toUpperCase().replace(/\s+/g, ""),
                          }))
                        }
                        placeholder="Ex: MAGAZIN5"
                      />
                    </label>

                    <label className={styles.field}>
                      <span>Nume</span>
                      <input
                        value={form.name}
                        onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                        placeholder="Ex: Cod comunitatea mea"
                      />
                    </label>
                  </div>

                  {/* reducerea: plafonul depinde de produsele eligibile (Pasul 2), ca înainte */}
                  {eligibilityOf(form) === "artfest" ? (
                    <label className={styles.field}>
                      <span>Reducere oferită de Artfest</span>
                      <select
                        value={form.discountPercent}
                        onChange={(event) =>
                          setForm((current) => ({ ...current, discountPercent: Number(event.target.value) }))
                        }
                      >
                        {Array.from({ length: maxArtfestDiscountPercent + 1 }, (_, percent) => percent).map(
                          (percent) => (
                            <option key={percent} value={percent}>
                              {percent}%
                            </option>
                          )
                        )}
                      </select>
                      <small>
                        Între 0% și {maxArtfestDiscountPercent}%, suportată integral de Artfest (ai ales „Toate
                        produsele Artfest” la Pasul 1).
                      </small>
                    </label>
                  ) : (
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
                                    Math.min(maxTotalDiscountPercent, Math.round(Number(event.target.value) || 0))
                                  ),
                          }))
                        }
                      />
                      <small>
                        Între 0% și {maxTotalDiscountPercent}%, suportată de magazinul tău (ai ales „
                        {ELIGIBILITY_LABELS[eligibilityOf(form)]}” la Pasul 1).
                      </small>
                    </label>
                  )}

                  <div className={styles.formGrid}>
                    <label className={styles.field}>
                      <span>Începe la</span>
                      <input
                        type="datetime-local"
                        value={form.startsAt}
                        onChange={(event) => setForm((current) => ({ ...current, startsAt: event.target.value }))}
                      />
                    </label>

                    <label className={styles.field}>
                      <span>Expiră la</span>
                      <input
                        type="datetime-local"
                        value={form.endsAt}
                        onChange={(event) => setForm((current) => ({ ...current, endsAt: event.target.value }))}
                      />
                    </label>
                  </div>

                  <div className={styles.formGrid}>
                    <label className={styles.field}>
                      <span>Limită totală</span>
                      <input
                        type="number"
                        min="1"
                        max="10000"
                        value={form.usageLimit}
                        onChange={(event) => setForm((current) => ({ ...current, usageLimit: event.target.value }))}
                        placeholder="Nelimitat"
                      />
                    </label>

                    <label className={styles.field}>
                      <span>Utilizări / client</span>
                      <input
                        type="number"
                        min="1"
                        max="10"
                        value={form.usageLimitPerUser}
                        onChange={(event) =>
                          setForm((current) => ({ ...current, usageLimitPerUser: event.target.value }))
                        }
                      />
                    </label>
                  </div>

                  <div className={styles.formGrid}>
                    <label className={styles.field}>
                      <span>Comandă minimă</span>
                      <div className={styles.moneyInput}>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={form.minimumOrderLei}
                          onChange={(event) =>
                            setForm((current) => ({ ...current, minimumOrderLei: event.target.value }))
                          }
                          placeholder="0"
                        />
                        <span>lei</span>
                      </div>
                    </label>

                    <label className={styles.field}>
                      <span>Reducere maximă</span>
                      <div className={styles.moneyInput}>
                        <input
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={form.maxDiscountLei}
                          onChange={(event) =>
                            setForm((current) => ({ ...current, maxDiscountLei: event.target.value }))
                          }
                          placeholder="Fără limită"
                        />
                        <span>lei</span>
                      </div>
                    </label>
                  </div>

                  <label className={styles.field}>
                    <span>Descriere</span>
                    <textarea
                      rows={3}
                      value={form.description}
                      onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                      placeholder="Opțional..."
                    />
                  </label>
                </section>

                <div className={styles.formActions}>
                  <button type="submit" className={styles.primaryButton} disabled={saving || selectedProductsLoading}>
                    {saving ? "Se salvează…" : editCode ? "Salvează modificările" : "Creează codul"}
                  </button>

                  <button type="button" className={styles.secondaryButton} disabled={saving} onClick={closeForm}>
                    Anulează
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body
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