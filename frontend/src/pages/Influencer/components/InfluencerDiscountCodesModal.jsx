import {
  useCallback,
  useEffect,
  useState,
} from "react";

import { api } from "../../../lib/api.js";

import styles from "./InfluencerDiscountCodesModal.module.css";

const EMPTY_FORM = {
  code: "",
  name: "",
  description: "",
  influencerCollectionId: "",
  discountPercent: 5,
  startsAt: "",
  endsAt: "",
  usageLimit: "",
  usageLimitPerUser: 1,
  minimumOrderLei: "",
  maxDiscountLei: "",
};

export default function InfluencerDiscountCodesModal({
  onClose,
}) {
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
    maxDiscountPercent,
    setMaxDiscountPercent,
  ] = useState(5);

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
     MODAL
  ========================================================= */

 useEffect(() => {
  const previous =
    document.body.style
      .overflow;

  document.body.style.overflow =
    "hidden";

  function onKeyDown(
    event
  ) {
    if (
      event.key !==
      "Escape"
    ) {
      return;
    }

    if (formOpen) {
      setFormOpen(false);
      setEditCode(null);

      setForm({
        ...EMPTY_FORM,
        discountPercent:
          Math.min(
            5,
            maxDiscountPercent
          ),
      });

      return;
    }

    onClose?.();
  }

  document.addEventListener(
    "keydown",
    onKeyDown
  );

  return () => {
    document.body.style.overflow =
      previous;

    document.removeEventListener(
      "keydown",
      onKeyDown
    );
  };
}, [
  onClose,
  formOpen,
  maxDiscountPercent,
]);

  /* =========================================================
     LOAD
  ========================================================= */
  const loadData =
    useCallback(
      async () => {
        setLoading(true);
        setError("");

        try {
          const [
            codesData,
            collectionsData,
          ] = await Promise.all([
            api(
              "/api/influencer/discount-codes"
            ),

            api(
              "/api/influencer/collections"
            ),
          ]);

          setDiscountCodes(
            Array.isArray(
              codesData?.discountCodes
            )
              ? codesData.discountCodes
              : []
          );

          setMaxDiscountPercent(
            Number(
              codesData?.maxDiscountPercent ||
                5
            )
          );

          setCollections(
            Array.isArray(
              collectionsData?.collections
            )
              ? collectionsData.collections
              : []
          );
        } catch (err) {
          setError(
            err?.data?.message ||
              err?.message ||
              "Nu am putut încărca codurile de reducere."
          );
        } finally {
          setLoading(false);
        }
      },
      []
    );

  useEffect(() => {
    loadData();
  }, [loadData]);

  /* =========================================================
     FORM
  ========================================================= */

  function resetForm() {
    setForm({
      ...EMPTY_FORM,

      discountPercent:
        Math.min(
          5,
          maxDiscountPercent
        ),
    });

    setEditCode(
      null
    );
  }

  function openCreate() {
    resetForm();

    setFormOpen(
      true
    );

    setError("");
    setSuccess("");
  }

  function openEdit(
    code
  ) {
    setEditCode(
      code
    );

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

      influencerCollectionId:
        code.influencerCollectionId ||
        "",

      discountPercent:
        Number(
          code.discountPercent ||
            1
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

    setError("");
    setSuccess("");
  }

  function closeForm() {
    setFormOpen(
      false
    );

    resetForm();
  }

  /* =========================================================
     SAVE
  ========================================================= */

  async function saveCode(
    event
  ) {
    event.preventDefault();

    setError("");
    setSuccess("");

    const cleanCode =
      form.code
        .trim()
        .toUpperCase()
        .replace(
          /\s+/g,
          ""
        );

    if (
      cleanCode.length < 3
    ) {
      setError(
        "Codul trebuie să aibă minimum 3 caractere."
      );

      return;
    }

    if (
      !form.influencerCollectionId
    ) {
      setError(
        "Alege colecția pe care se aplică acest cod."
      );

      return;
    }

    const discountPercent =
      Number(
        form.discountPercent
      );

    if (
      !Number.isInteger(
        discountPercent
      ) ||
      discountPercent < 1 ||
      discountPercent >
        maxDiscountPercent
    ) {
      setError(
        `Reducerea trebuie să fie între 1% și ${maxDiscountPercent}%.`
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
        minimumOrderLei < 0
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
        maxDiscountLei <= 0
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
        form.description.trim() ||
        null,

      influencerCollectionId:
        form.influencerCollectionId,

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
        form.usageLimitPerUser !==
        ""
          ? Number(
              form.usageLimitPerUser
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

    setSaving(true);

    try {
      if (
        editCode?.id
      ) {
        await api(
          `/api/influencer/discount-codes/${editCode.id}`,
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
          "/api/influencer/discount-codes",
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
        err?.data?.message ||
          err?.message ||
          "Nu am putut salva codul de reducere."
      );
    } finally {
      setSaving(false);
    }
  }

  /* =========================================================
     TOGGLE
  ========================================================= */

  async function toggleCode(
    code
  ) {
    if (!code?.id) {
      return;
    }

    setBusyId(
      code.id
    );

    setError("");
    setSuccess("");

    try {
      const data =
        await api(
          `/api/influencer/discount-codes/${code.id}/toggle`,
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
        err?.data?.message ||
          err?.message ||
          "Nu am putut modifica statusul codului."
      );
    } finally {
      setBusyId("");
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

    if (!confirmed) {
      return;
    }

    setBusyId(
      code.id
    );

    setError("");
    setSuccess("");

    try {
      await api(
        `/api/influencer/discount-codes/${code.id}`,
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
        err?.data?.message ||
          err?.message ||
          "Nu am putut șterge codul."
      );
    } finally {
      setBusyId("");
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
        styles.backdrop
      }
      onMouseDown={
        onClose
      }
    >
      <div
        className={
          styles.modal
        }
        onMouseDown={(event) =>
          event.stopPropagation()
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
              Creează coduri de până la{" "}
              <strong>
                {
                  maxDiscountPercent
                }%
              </strong>{" "}
              pentru colecțiile tale Artfest.
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

            <button
              type="button"
              className={
                styles.secondaryButton
              }
              onClick={
                onClose
              }
            >
              Închide
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
              Creează un cod pentru una dintre colecțiile tale și distribuie-l comunității tale.
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
                        Colecție:{" "}
                        <strong>
                          {code.collection
                            ?.title ||
                            "—"}
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
                  </div>

                  <div
                    className={
                      styles.codeActions
                    }
                  >
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
              onMouseDown={(event) =>
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
                    className={
                      styles.field
                    }
                  >
                    <span>
                      Cod *
                    </span>

                    <input
                      value={
                        form.code
                      }
                      maxLength={
                        32
                      }
                      onChange={(event) =>
                        setForm(
                          (
                            current
                          ) => ({
                            ...current,

                            code:
                              event.target.value
                                .toUpperCase()
                                .replace(
                                  /\s+/g,
                                  ""
                                ),
                          })
                        )
                      }
                      placeholder="Ex: HELLEN5"
                    />
                  </label>

                  <label
                    className={
                      styles.field
                    }
                  >
                    <span>
                      Reducere *
                    </span>

                    <select
                      value={
                        form.discountPercent
                      }
                      onChange={(event) =>
                        setForm(
                          (
                            current
                          ) => ({
                            ...current,

                            discountPercent:
                              Number(
                                event.target.value
                              ),
                          })
                        )
                      }
                    >
                      {Array.from(
                        {
                          length:
                            maxDiscountPercent,
                        },
                        (
                          _,
                          index
                        ) =>
                          index +
                          1
                      ).map(
                        (
                          percent
                        ) => (
                          <option
                            key={
                              percent
                            }
                            value={
                              percent
                            }
                          >
                            {
                              percent
                            }%
                          </option>
                        )
                      )}
                    </select>
                  </label>
                </div>

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
                    onChange={(event) =>
                      setForm(
                        (
                          current
                        ) => ({
                          ...current,

                          name:
                            event.target.value,
                        })
                      )
                    }
                    placeholder="Ex: Cod comunitate Hellen"
                  />
                </label>

                <label
                  className={
                    styles.field
                  }
                >
                  <span>
                    Colecție *
                  </span>

                  <select
                    value={
                      form.influencerCollectionId
                    }
                    onChange={(event) =>
                      setForm(
                        (
                          current
                        ) => ({
                          ...current,

                          influencerCollectionId:
                            event.target.value,
                        })
                      )
                    }
                  >
                    <option value="">
                      Alege colecția
                    </option>

                    {collections.map(
                      (
                        collection
                      ) => (
                        <option
                          key={
                            collection.id
                          }
                          value={
                            collection.id
                          }
                        >
                          {
                            collection.title
                          }
                        </option>
                      )
                    )}
                  </select>

                  {!collections.length && (
                    <small>
                      Creează mai întâi o colecție.
                    </small>
                  )}
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
                      onChange={(event) =>
                        setForm(
                          (
                            current
                          ) => ({
                            ...current,

                            startsAt:
                              event.target.value,
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
                      onChange={(event) =>
                        setForm(
                          (
                            current
                          ) => ({
                            ...current,

                            endsAt:
                              event.target.value,
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
                      onChange={(event) =>
                        setForm(
                          (
                            current
                          ) => ({
                            ...current,

                            usageLimit:
                              event.target.value,
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
                        form.usageLimitPerUser
                      }
                      onChange={(event) =>
                        setForm(
                          (
                            current
                          ) => ({
                            ...current,

                            usageLimitPerUser:
                              event.target.value,
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
                        onChange={(event) =>
                          setForm(
                            (
                              current
                            ) => ({
                              ...current,

                              minimumOrderLei:
                                event.target.value,
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
                        onChange={(event) =>
                          setForm(
                            (
                              current
                            ) => ({
                              ...current,

                              maxDiscountLei:
                                event.target.value,
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
                    onChange={(event) =>
                      setForm(
                        (
                          current
                        ) => ({
                          ...current,

                          description:
                            event.target.value,
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
                  Codul poate oferi maximum{" "}
                  <strong>
                    {
                      maxDiscountPercent
                    }%
                  </strong>
                  . Reducerea se aplică doar produselor din colecția selectată și, în această etapă, este suportată de Artfest.
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
                      saving ||
                      !collections.length
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
      </div>
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