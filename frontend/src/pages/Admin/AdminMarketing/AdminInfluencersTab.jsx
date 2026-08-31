import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { api } from "../../../lib/api";
import styles from "./AdminInfluencersTab.module.css";

const INITIAL_FORM = {
  name: "",
  email: "",
};

function formatDate(value) {
  if (!value) {
    return "—";
  }

  try {
    return new Date(value).toLocaleString(
      "ro-RO"
    );
  } catch {
    return "—";
  }
}

function formatMoney(value) {
  const number =
    Number(value || 0);

  return new Intl.NumberFormat(
    "ro-RO",
    {
      style: "currency",
      currency: "RON",
      minimumFractionDigits: 2,
    }
  ).format(number);
}

function getStatusLabel(status) {
  switch (
    String(
      status || ""
    ).toUpperCase()
  ) {
    case "ACTIVE":
      return "Activ";

    case "INVITED":
    case "PENDING":
      return "Invitat";

    case "ACCEPTED":
      return "Acceptat";

    case "EXPIRED":
      return "Expirat";

    case "DISABLED":
    case "INACTIVE":
      return "Dezactivat";

    default:
      return status || "—";
  }
}

function getStatusClass(status) {
  const normalized =
    String(
      status || ""
    ).toUpperCase();

  if (
    normalized === "ACTIVE" ||
    normalized === "ACCEPTED"
  ) {
    return styles.statusActive;
  }

  if (
    normalized === "INVITED" ||
    normalized === "PENDING"
  ) {
    return styles.statusInvited;
  }

  if (
    normalized === "EXPIRED"
  ) {
    return styles.statusExpired;
  }

  return styles.statusDisabled;
}

function getRemunerationLabel(item) {
  if (
    item?.type === "INVITE"
  ) {
    return "—";
  }

  if (
    item?.platformCommissionSharePercent !==
      undefined &&
    item?.platformCommissionSharePercent !==
      null &&
    Number(
      item.platformCommissionSharePercent
    ) > 0
  ) {
    return `${Number(
      item.platformCommissionSharePercent
    ).toLocaleString(
      "ro-RO"
    )}% din comisionul Artfest`;
  }

  if (
    item?.commissionSharePercent !==
      undefined &&
    item?.commissionSharePercent !==
      null &&
    Number(
      item.commissionSharePercent
    ) > 0
  ) {
    return `${Number(
      item.commissionSharePercent
    ).toLocaleString(
      "ro-RO"
    )}% din comisionul Artfest`;
  }

  return "Nesetată";
}

function mapInviteError(
  errorCode,
  fallback
) {
  switch (errorCode) {
    case "email_already_influencer":
      return "Acest email aparține deja unui influencer.";

    case "email_already_invited":
      return "Există deja o invitație activă pentru acest email.";

    case "invite_not_found":
      return "Invitația nu mai există.";

    case "invite_already_used":
      return "Invitația a fost deja acceptată și nu mai poate fi modificată.";

    case "influencer_invite_conflict":
      return "Există deja o invitație care intră în conflict cu aceste date.";

    default:
      return (
        fallback ||
        "Nu am putut procesa invitația."
      );
  }
}

export default function AdminInfluencersTab() {
  const [
    items,
    setItems,
  ] = useState([]);

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    error,
    setError,
  ] = useState("");

  const [
    query,
    setQuery,
  ] = useState("");

  const [
    inviteOpen,
    setInviteOpen,
  ] = useState(false);

  const [
    form,
    setForm,
  ] = useState(
    INITIAL_FORM
  );

  const [
    creating,
    setCreating,
  ] = useState(false);

  const [
    deletingId,
    setDeletingId,
  ] = useState("");

  const [
    inviteResult,
    setInviteResult,
  ] = useState(null);

  const [
    copyState,
    setCopyState,
  ] = useState("");

  const [
    editingInvite,
    setEditingInvite,
  ] = useState(null);

  const isEditing =
    Boolean(
      editingInvite?.id
    );

  const loadInfluencers =
    useCallback(
      async () => {
        setLoading(true);
        setError("");

        try {
          const data =
            await api(
              "/api/admin/influencers"
            );

          if (
            data?.ok === false
          ) {
            throw new Error(
              data?.error ||
                "Nu am putut încărca influencerii."
            );
          }

          const result =
            data?.items ||
            data?.influencers ||
            (
              Array.isArray(
                data
              )
                ? data
                : []
            );

          setItems(
            Array.isArray(
              result
            )
              ? result
              : []
          );
        } catch (err) {
          setItems([]);

          setError(
            err?.message ||
              "Nu am putut încărca influencerii."
          );
        } finally {
          setLoading(false);
        }
      },
      []
    );

  useEffect(() => {
    loadInfluencers();
  }, [loadInfluencers]);

  const closeInviteModal =
    useCallback(() => {
      if (creating) {
        return;
      }

      setInviteOpen(false);
      setInviteResult(null);
      setEditingInvite(null);
      setForm(
        INITIAL_FORM
      );
      setCopyState("");
      setError("");
    }, [creating]);

  useEffect(() => {
    if (!inviteOpen) {
      return;
    }

    function handleEscape(
      event
    ) {
      if (
        event.key ===
        "Escape"
      ) {
        closeInviteModal();
      }
    }

    document.addEventListener(
      "keydown",
      handleEscape
    );

    return () => {
      document.removeEventListener(
        "keydown",
        handleEscape
      );
    };
  }, [
    inviteOpen,
    closeInviteModal,
  ]);

  const filteredItems =
    useMemo(() => {
      const q =
        query
          .trim()
          .toLowerCase();

      if (!q) {
        return items;
      }

      return items.filter(
        (item) => {
          const values = [
            item.name,
            item.email,
            item.status,
          ];

          return values.some(
            (value) =>
              String(
                value || ""
              )
                .toLowerCase()
                .includes(q)
          );
        }
      );
    }, [
      items,
      query,
    ]);

  const stats =
    useMemo(() => {
      const active =
        items.filter(
          (item) => {
            const status =
              String(
                item.status ||
                  ""
              ).toUpperCase();

            return (
              status ===
              "ACTIVE"
            );
          }
        ).length;

      const invited =
        items.filter(
          (item) => {
            const status =
              String(
                item.status ||
                  ""
              ).toUpperCase();

            return (
              status ===
                "INVITED" ||
              status ===
                "PENDING"
            );
          }
        ).length;

      const totalClicks =
        items.reduce(
          (
            sum,
            item
          ) =>
            sum +
            Number(
              item.clicks ||
                0
            ),
          0
        );

      const totalOrders =
        items.reduce(
          (
            sum,
            item
          ) =>
            sum +
            Number(
              item.ordersCount ||
                0
            ),
          0
        );

      return {
        total:
          items.length,

        active,

        invited,

        totalClicks,

        totalOrders,
      };
    }, [items]);

  function openInviteModal() {
    setError("");
    setEditingInvite(null);

    setForm(
      INITIAL_FORM
    );

    setInviteResult(
      null
    );

    setCopyState("");

    setInviteOpen(true);
  }

  function openEditInvite(
    item
  ) {
    if (
      item?.type !==
      "INVITE"
    ) {
      return;
    }

    setError("");
    setInviteResult(null);
    setCopyState("");

    setEditingInvite(
      item
    );

    setForm({
      name:
        item.name ||
        "",

      email:
        item.email ||
        "",
    });

    setInviteOpen(true);
  }

  function updateField(
    field,
    value
  ) {
    setForm(
      (current) => ({
        ...current,

        [field]:
          value,
      })
    );
  }

  async function submitInvite(
    event
  ) {
    event.preventDefault();

    setError("");
    setCopyState("");

    const name =
      form.name.trim();

    const email =
      form.email
        .trim()
        .toLowerCase();

    if (!name) {
      setError(
        "Completează numele influencerului."
      );

      return;
    }

    if (!email) {
      setError(
        "Completează adresa de email."
      );

      return;
    }

    setCreating(true);

    try {
      const endpoint =
        isEditing
          ? `/api/admin/influencers/invite/${encodeURIComponent(
              editingInvite.id
            )}`
          : "/api/admin/influencers/invite";

      const method =
        isEditing
          ? "PATCH"
          : "POST";

      const data =
        await api(
          endpoint,
          {
            method,

            body: {
              name,
              email,
            },
          }
        );

      if (
        data?.ok === false
      ) {
        throw new Error(
          mapInviteError(
            data?.error,
            data?.message
          )
        );
      }

      setInviteResult({
        id:
          data?.invite
            ?.id ||
          data?.id ||
          editingInvite
            ?.id ||
          null,

        name:
          data?.invite
            ?.name ||
          name,

        email:
          data?.invite
            ?.email ||
          email,

        expiresAt:
          data?.invite
            ?.expiresAt ||
          null,

        inviteUrl:
          data?.inviteUrl ||
          data?.invite
            ?.inviteUrl ||
          data?.url ||
          "",

        emailSent:
          data?.emailSent ??
          data?.invite
            ?.emailSent ??
          false,

        emailError:
          data?.emailError ||
          null,

        edited:
          isEditing,
      });

      await loadInfluencers();
    } catch (err) {
      setError(
        mapInviteError(
          err?.code,
          err?.message ||
            (
              isEditing
                ? "Nu am putut modifica invitația."
                : "Nu am putut crea invitația."
            )
        )
      );
    } finally {
      setCreating(false);
    }
  }

  async function deleteInvite(
    item
  ) {
    if (
      item?.type !==
      "INVITE"
    ) {
      return;
    }

    const confirmed =
      window.confirm(
        `Sigur vrei să ștergi invitația pentru ${
          item.name ||
          item.email ||
          "acest influencer"
        }?`
      );

    if (!confirmed) {
      return;
    }

    setDeletingId(
      item.id
    );

    setError("");

    try {
      const data =
        await api(
          `/api/admin/influencers/invite/${encodeURIComponent(
            item.id
          )}`,
          {
            method:
              "DELETE",
          }
        );

      if (
        data?.ok === false
      ) {
        throw new Error(
          mapInviteError(
            data?.error,
            data?.message
          )
        );
      }

      setItems(
        (current) =>
          current.filter(
            (entry) =>
              !(
                entry.type ===
                  "INVITE" &&
                entry.id ===
                  item.id
              )
          )
      );
    } catch (err) {
      setError(
        mapInviteError(
          err?.code,
          err?.message ||
            "Nu am putut șterge invitația."
        )
      );
    } finally {
      setDeletingId("");
    }
  }

  async function copyText(
    text,
    type = "link"
  ) {
    if (!text) {
      return;
    }

    try {
      await navigator.clipboard.writeText(
        text
      );

      setCopyState(
        type
      );

      window.setTimeout(
        () => {
          setCopyState("");
        },
        1800
      );
    } catch {
      setError(
        "Nu am putut copia automat. Selectează și copiază manual."
      );
    }
  }

  async function copyInvite(
    item
  ) {
    const inviteUrl =
      item.inviteUrl ||
      item.invitationUrl ||
      item.invite
        ?.inviteUrl;

    if (!inviteUrl) {
      setError(
        "Linkul original al invitației nu mai este disponibil. Editează invitația pentru a genera un link nou."
      );

      return;
    }

    await copyText(
      inviteUrl,
      `invite-${item.id}`
    );
  }

  return (
    <div
      className={
        styles.root
      }
    >
      <div
        className={
          styles.header
        }
      >
        <div
          className={
            styles.headerText
          }
        >
          <h3
            className={
              styles.title
            }
          >
            Influenceri
          </h3>

          <p
            className={
              styles.subtitle
            }
          >
            Invită influenceri în Artfest, urmărește activarea conturilor și performanța colaborărilor.
          </p>
        </div>

        <button
          type="button"
          onClick={
            openInviteModal
          }
          className={
            styles.primaryButton
          }
        >
          + Invită influencer
        </button>
      </div>

      <div
        className={
          styles.statsGrid
        }
      >
        <StatCard
          label="Total"
          value={
            stats.total
          }
        />

        <StatCard
          label="Activi"
          value={
            stats.active
          }
        />

        <StatCard
          label="Invitați"
          value={
            stats.invited
          }
        />

        <StatCard
          label="Clickuri"
          value={
            stats.totalClicks
          }
        />

        <StatCard
          label="Comenzi"
          value={
            stats.totalOrders
          }
        />
      </div>

      <div
        className={
          styles.card
        }
      >
        <div
          className={
            styles.cardHeader
          }
        >
          <div>
            <div
              className={
                styles.cardTitle
              }
            >
              Influenceri și invitații
            </div>

            <div
              className={
                styles.cardSubtitle
              }
            >
              Conturile active și invitațiile trimise.
            </div>
          </div>

          <div
            className={
              styles.filters
            }
          >
            <input
              type="search"
              value={query}
              placeholder="Caută după nume sau email..."
              onChange={(
                event
              ) =>
                setQuery(
                  event.target
                    .value
                )
              }
              className={
                styles.searchInput
              }
            />

            <button
              type="button"
              onClick={
                loadInfluencers
              }
              disabled={
                loading
              }
              className={
                styles.secondaryButton
              }
            >
              {loading
                ? "Se încarcă..."
                : "Reîncarcă"}
            </button>
          </div>
        </div>

        {error && (
          <div
            className={
              styles.error
            }
          >
            {error}
          </div>
        )}

        {loading ? (
          <div
            className={
              styles.loading
            }
          >
            Se încarcă influencerii…
          </div>
        ) : filteredItems.length ===
          0 ? (
          <EmptyState
            hasQuery={
              Boolean(
                query.trim()
              )
            }
            onInvite={
              openInviteModal
            }
          />
        ) : (
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
                    Nume
                  </th>

                  <th>
                    Email
                  </th>

                  <th>
                    Status
                  </th>

                  <th>
                    Remunerație
                  </th>

                  <th>
                    Clickuri
                  </th>

                  <th>
                    Comenzi
                  </th>

                  <th>
                    Vânzări
                  </th>

                  <th>
                    Creat
                  </th>

                  <th>
                    Acțiuni
                  </th>
                </tr>
              </thead>

              <tbody>
                {filteredItems.map(
                  (item) => {
                    const isInvite =
                      item.type ===
                      "INVITE";

                    const isDeleting =
                      deletingId ===
                      item.id;

                    return (
                      <tr
                        key={`${item.type || "item"}-${item.id}`}
                      >
                        <td>
                          <div
                            className={
                              styles.nameCell
                            }
                          >
                            {item.name ||
                              "—"}
                          </div>
                        </td>

                        <td>
                          {item.email ||
                            "—"}
                        </td>

                        <td>
                          <span
                            className={`${styles.status} ${getStatusClass(
                              item.status
                            )}`}
                          >
                            {getStatusLabel(
                              item.status
                            )}
                          </span>
                        </td>

                        <td>
                          {getRemunerationLabel(
                            item
                          )}
                        </td>

                        <td>
                          {Number(
                            item.clicks ||
                              0
                          ).toLocaleString(
                            "ro-RO"
                          )}
                        </td>

                        <td>
                          {Number(
                            item.ordersCount ||
                              0
                          ).toLocaleString(
                            "ro-RO"
                          )}
                        </td>

                        <td>
                          {formatMoney(
                            item.salesAmount ||
                              item.salesTotal ||
                              0
                          )}
                        </td>

                        <td>
                          {formatDate(
                            item.createdAt
                          )}
                        </td>

                        <td>
                          <div
                            className={
                              styles.actions
                            }
                          >
                            {isInvite && (
                              <>
                                <SmallButton
                                  onClick={() =>
                                    openEditInvite(
                                      item
                                    )
                                  }
                                >
                                  Editează
                                </SmallButton>

                                <SmallButton
                                  onClick={() =>
                                    deleteInvite(
                                      item
                                    )
                                  }
                                  disabled={
                                    isDeleting
                                  }
                                >
                                  {isDeleting
                                    ? "Se șterge..."
                                    : "Șterge"}
                                </SmallButton>
                              </>
                            )}

                            {(item.inviteUrl ||
                              item.invitationUrl ||
                              item.invite
                                ?.inviteUrl) && (
                              <SmallButton
                                onClick={() =>
                                  copyInvite(
                                    item
                                  )
                                }
                              >
                                {copyState ===
                                `invite-${item.id}`
                                  ? "Copiat ✓"
                                  : "Copiază invitația"}
                              </SmallButton>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  }
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {inviteOpen && (
        <div
          role="presentation"
          className={
            styles.modalBackdrop
          }
          onMouseDown={(
            event
          ) => {
            if (
              event.target ===
              event.currentTarget
            ) {
              closeInviteModal();
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="invite-influencer-title"
            className={
              styles.modal
            }
          >
            <div
              className={
                styles.modalHeader
              }
            >
              <div>
                <h3
                  id="invite-influencer-title"
                  className={
                    styles.modalTitle
                  }
                >
                  {isEditing
                    ? "Editează invitația"
                    : "Invită influencer"}
                </h3>

                <p
                  className={
                    styles.modalSubtitle
                  }
                >
                  {isEditing
                    ? "La salvare se generează un link nou, iar invitația este retrimisă automat pe email."
                    : "Invitația va fi trimisă automat pe email și vei primi și linkul privat."}
                </p>
              </div>

              <button
                type="button"
                onClick={
                  closeInviteModal
                }
                disabled={
                  creating
                }
                aria-label="Închide"
                className={
                  styles.closeButton
                }
              >
                ×
              </button>
            </div>

            {!inviteResult ? (
              <form
                onSubmit={
                  submitInvite
                }
                className={
                  styles.form
                }
              >
                <FormField
                  label="Nume"
                  required
                >
                  <input
                    type="text"
                    value={
                      form.name
                    }
                    placeholder="Ex: Dora"
                    onChange={(
                      event
                    ) =>
                      updateField(
                        "name",
                        event.target
                          .value
                      )
                    }
                    className={
                      styles.input
                    }
                    autoComplete="name"
                  />
                </FormField>

                <FormField
                  label="Email"
                  required
                >
                  <input
                    type="email"
                    value={
                      form.email
                    }
                    placeholder="creator@email.ro"
                    onChange={(
                      event
                    ) =>
                      updateField(
                        "email",
                        event.target
                          .value
                      )
                    }
                    className={
                      styles.input
                    }
                    autoComplete="email"
                  />
                </FormField>

                <div
                  className={
                    styles.infoBox
                  }
                >
                  {isEditing
                    ? "Modificarea invitației va invalida linkul vechi și va genera unul nou, valabil 7 zile."
                    : "Remunerația colaborării va putea fi stabilită ulterior, după activarea contului."}
                </div>

                {error && (
                  <div
                    className={
                      styles.error
                    }
                  >
                    {error}
                  </div>
                )}

                <div
                  className={
                    styles.formActions
                  }
                >
                  <button
                    type="button"
                    onClick={
                      closeInviteModal
                    }
                    disabled={
                      creating
                    }
                    className={
                      styles.secondaryButton
                    }
                  >
                    Renunță
                  </button>

                  <button
                    type="submit"
                    disabled={
                      creating
                    }
                    className={
                      styles.primaryButton
                    }
                  >
                    {creating
                      ? (
                          isEditing
                            ? "Se salvează..."
                            : "Se trimite invitația..."
                        )
                      : (
                          isEditing
                            ? "Salvează și retrimite invitația"
                            : "Trimite invitația"
                        )}
                  </button>
                </div>
              </form>
            ) : (
              <div
                className={
                  styles.resultBody
                }
              >
                {inviteResult.emailSent ? (
                  <div
                    className={
                      styles.successBox
                    }
                  >
                    <div
                      className={
                        styles.successTitle
                      }
                    >
                      {inviteResult.edited
                        ? "Invitația a fost actualizată și retrimisă ✓"
                        : "Invitația a fost trimisă ✓"}
                    </div>

                    <div
                      className={
                        styles.successText
                      }
                    >
                      Am trimis automat invitația către{" "}
                      <strong>
                        {inviteResult.email}
                      </strong>
                      . Linkul privat rămâne disponibil mai jos pentru siguranță.
                    </div>
                  </div>
                ) : (
                  <div
                    className={
                      styles.warningBox
                    }
                  >
                    <strong>
                      {inviteResult.edited
                        ? "Invitația a fost actualizată, dar emailul nu a putut fi trimis."
                        : "Invitația a fost creată, dar emailul nu a putut fi trimis."}
                    </strong>

                    <div>
                      Copiază linkul de mai jos și trimite-l manual influencerului.
                    </div>
                  </div>
                )}

                <FormField label="Nume">
                  <div
                    className={
                      styles.readOnlyBox
                    }
                  >
                    {inviteResult.name ||
                      "—"}
                  </div>
                </FormField>

                <div
                  className={
                    styles.spacer
                  }
                />

                <FormField label="Email">
                  <div
                    className={
                      styles.readOnlyBox
                    }
                  >
                    {inviteResult.email}
                  </div>
                </FormField>

                {inviteResult.expiresAt && (
                  <>
                    <div
                      className={
                        styles.spacer
                      }
                    />

                    <FormField label="Invitația expiră la">
                      <div
                        className={
                          styles.readOnlyBox
                        }
                      >
                        {formatDate(
                          inviteResult.expiresAt
                        )}
                      </div>
                    </FormField>
                  </>
                )}

                <div
                  className={
                    styles.spacer
                  }
                />

                <FormField label="Link invitație">
                  {inviteResult.inviteUrl ? (
                    <>
                      <div
                        className={`${styles.readOnlyBox} ${styles.readOnlyBreak}`}
                      >
                        {inviteResult.inviteUrl}
                      </div>

                      <button
                        type="button"
                        onClick={() =>
                          copyText(
                            inviteResult.inviteUrl,
                            "result"
                          )
                        }
                        className={`${styles.secondaryButton} ${styles.copyButton}`}
                      >
                        {copyState ===
                        "result"
                          ? "Copiat ✓"
                          : "Copiază linkul"}
                      </button>
                    </>
                  ) : (
                    <div
                      className={`${styles.readOnlyBox} ${styles.warningBox}`}
                    >
                      Backendul nu a returnat linkul invitației.
                    </div>
                  )}
                </FormField>

                <div
                  className={
                    styles.resultActions
                  }
                >
                  <button
                    type="button"
                    onClick={
                      closeInviteModal
                    }
                    className={
                      styles.primaryButton
                    }
                  >
                    Gata
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
}) {
  return (
    <div
      className={
        styles.statCard
      }
    >
      <div
        className={
          styles.statLabel
        }
      >
        {label}
      </div>

      <div
        className={
          styles.statValue
        }
      >
        {Number(
          value || 0
        ).toLocaleString(
          "ro-RO"
        )}
      </div>
    </div>
  );
}

function EmptyState({
  hasQuery,
  onInvite,
}) {
  return (
    <div
      className={
        styles.emptyState
      }
    >
      <div
        className={
          styles.emptyTitle
        }
      >
        {hasQuery
          ? "Nu am găsit niciun influencer."
          : "Nu ai încă influenceri."}
      </div>

      <div
        className={`${styles.emptyText} ${
          !hasQuery
            ? styles.emptyTextWithButton
            : ""
        }`}
      >
        {hasQuery
          ? "Încearcă o altă căutare."
          : "Trimite prima invitație privată unui influencer."}
      </div>

      {!hasQuery && (
        <button
          type="button"
          onClick={
            onInvite
          }
          className={
            styles.primaryButton
          }
        >
          + Invită influencer
        </button>
      )}
    </div>
  );
}

function SmallButton({
  children,
  onClick,
  disabled = false,
}) {
  return (
    <button
      type="button"
      onClick={
        onClick
      }
      disabled={
        disabled
      }
      className={
        styles.smallButton
      }
    >
      {children}
    </button>
  );
}

function FormField({
  label,
  hint,
  required,
  children,
}) {
  return (
    <label
      className={
        styles.field
      }
    >
      <div
        className={
          styles.fieldLabel
        }
      >
        {label}

        {required && (
          <span
            className={
              styles.required
            }
          >
            *
          </span>
        )}
      </div>

      {children}

      {hint && (
        <div
          className={
            styles.fieldHint
          }
        >
          {hint}
        </div>
      )}
    </label>
  );
}