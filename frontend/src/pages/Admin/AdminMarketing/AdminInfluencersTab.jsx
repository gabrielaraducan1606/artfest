import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { api } from "../../../lib/api";
import styles from "./AdminInfluencersTab.module.css";
import AdminInfluencerResourcesTab from "./AdminInfluencerResourcesTab.jsx";
import AdminInfluencerPayoutsTab from "./AdminInfluencerPayoutsTab.jsx";
import ExtendCollaborationModal from "./ExtendCollaborationModal.jsx";

const SUB_TABS = [
  { id: "overview", label: "Overview" },
  { id: "influencers", label: "Influenceri" },
  { id: "promotion", label: "Promovare" },
  { id: "orders", label: "Comenzi" },
  { id: "resources", label: "Resurse" },
  { id: "payouts", label: "Fiscalizare & plăți" },
];

const INITIAL_FORM = {
  firstName: "",
  lastName: "",
  email: "",
};

/*
 * InfluencerInvite ține azi doar `name` (legacy, un singur câmp) - vezi
 * raportul de standardizare Prenume/Nume. Split best-effort, folosit
 * DOAR pentru precompletarea formularului de editare a unei invitații
 * existente (care are deja doar `name` salvat, nu firstName/lastName
 * separat) - nu inventează o structură nouă, doar afișează invitația
 * veche într-un formular cu două câmpuri.
 */
function splitFullName(fullName) {
  const trimmed = String(fullName || "").trim();

  if (!trimmed) {
    return { firstName: "", lastName: "" };
  }

  const parts = trimmed.split(/\s+/);
  const firstName = parts.shift() || "";
  const lastName = parts.join(" ");

  return { firstName, lastName };
}

const INITIAL_COMMISSION_FORM = {
  commissionPercent: "",
};

/* =========================================================
   FORMATTERS
========================================================= */

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

function formatPercent(value) {
  const number =
    Number(value);

  if (
    !Number.isFinite(number)
  ) {
    return "—";
  }

  return `${number.toLocaleString(
    "ro-RO",
    {
      maximumFractionDigits: 2,
    }
  )}%`;
}

/* =========================================================
   STATUS
========================================================= */

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

/* =========================================================
   COLABORARE (Status colaborare / Început / Expiră la)

   Sursa datelor: STRICT item.collaboration, calculat o singură
   dată în backend (services/influencerCollaboration.js), la
   fel ca in dashboardul influencerului (GET /api/influencer/me).
   Nu se recalculează nimic aici.
========================================================= */

const COLLABORATION_STATUS_LABEL = {
  ACTIVE: "Activă",
  EXPIRED: "Expirată",
  DISABLED: "Dezactivată",
};

function getCollaborationStatusLabel(collaborationStatus) {
  return (
    COLLABORATION_STATUS_LABEL[collaborationStatus] ||
    collaborationStatus ||
    "—"
  );
}

function getCollaborationStatusClass(collaborationStatus) {
  if (collaborationStatus === "ACTIVE") {
    return styles.statusActive;
  }

  if (collaborationStatus === "EXPIRED") {
    return styles.statusExpired;
  }

  return styles.statusDisabled;
}

function formatCollaborationDate(value) {
  if (!value) {
    return "—";
  }

  try {
    return new Date(value).toLocaleDateString("ro-RO", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return "—";
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

/* =========================================================
   REMUNERAȚIE
========================================================= */

function getActiveCommissionPercent(
  item
) {
  if (
    item?.platformCommissionSharePercent !==
      undefined &&
    item?.platformCommissionSharePercent !==
      null
  ) {
    return Number(
      item.platformCommissionSharePercent
    );
  }

  if (
    item?.commissionSharePercent !==
      undefined &&
    item?.commissionSharePercent !==
      null
  ) {
    return Number(
      item.commissionSharePercent
    );
  }

  if (
    item?.commissionBps !==
      undefined &&
    item?.commissionBps !==
      null
  ) {
    return (
      Number(
        item.commissionBps
      ) / 100
    );
  }

  return 0;
}

function getPendingCommissionPercent(
  item
) {
  if (
    item?.pendingCommissionPercent !==
      undefined &&
    item?.pendingCommissionPercent !==
      null
  ) {
    return Number(
      item.pendingCommissionPercent
    );
  }

  if (
    item
      ?.pendingCommissionAgreement
      ?.commissionPercent !==
      undefined &&
    item
      ?.pendingCommissionAgreement
      ?.commissionPercent !==
      null
  ) {
    return Number(
      item
        .pendingCommissionAgreement
        .commissionPercent
    );
  }

  if (
    item
      ?.pendingCommissionAgreement
      ?.commissionBps !==
      undefined &&
    item
      ?.pendingCommissionAgreement
      ?.commissionBps !==
      null
  ) {
    return (
      Number(
        item
          .pendingCommissionAgreement
          .commissionBps
      ) / 100
    );
  }

  return null;
}

function getRemunerationLabel(
  item
) {
  if (
    item?.type === "INVITE"
  ) {
    return "—";
  }

  const activePercent =
    getActiveCommissionPercent(
      item
    );

  const pendingPercent =
    getPendingCommissionPercent(
      item
    );

  if (
    pendingPercent !==
    null
  ) {
    if (
      activePercent > 0
    ) {
      return `${formatPercent(
        activePercent
      )} activ · ${formatPercent(
        pendingPercent
      )} în așteptare`;
    }

    return `${formatPercent(
      pendingPercent
    )} · așteaptă acceptarea`;
  }

  if (
    activePercent > 0
  ) {
    return `${formatPercent(
      activePercent
    )} din comisionul Artfest`;
  }

  return "Nesetată";
}

function getCommissionStatusLabel(
  item
) {
  if (
    item?.type === "INVITE"
  ) {
    return null;
  }

  if (
    item
      ?.hasPendingCommissionAgreement ||
    item
      ?.pendingCommissionAgreement
  ) {
    return "Așteaptă acceptarea";
  }

  if (
    getActiveCommissionPercent(
      item
    ) > 0
  ) {
    return "Acceptată";
  }

  return "Nesetată";
}

/* =========================================================
   ERRORS
========================================================= */

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

function mapCommissionError(
  errorCode,
  fallback
) {
  switch (errorCode) {
    case "influencer_not_found":
      return "Influencerul nu a fost găsit.";

    case "influencer_not_active":
      return "Remunerația poate fi stabilită doar pentru un influencer activ.";

    case "commission_already_active":
      return "Această remunerație este deja activă.";

    case "invalid_commission_payload":
    case "invalid_commission_bps":
      return "Procentul de remunerație nu este valid.";

    case "commission_agreement_create_failed":
      return "Nu am putut trimite propunerea de remunerație.";

    case "commission_agreement_not_found":
      return "Propunerea de remunerație nu mai există.";

    case "commission_agreement_not_pending":
      return "Această propunere nu mai este în așteptare.";

    case "commission_agreement_cancel_failed":
      return "Nu am putut retrage propunerea.";

    default:
      return (
        fallback ||
        "Nu am putut procesa remunerația."
      );
  }
}

/* =========================================================
   COMPONENT
========================================================= */

export default function AdminInfluencersTab() {
  const [
    subTab,
    setSubTab,
  ] = useState("overview");

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
    selectedInfluencer,
    setSelectedInfluencer,
  ] = useState(null);

  const [
    resendingInviteId,
    setResendingInviteId,
  ] = useState("");

  /* =========================================================
     INVITE MODAL
  ========================================================= */

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

  /* =========================================================
     COMMISSION MODAL
  ========================================================= */

  const [
    commissionOpen,
    setCommissionOpen,
  ] = useState(false);

  const [
    commissionTarget,
    setCommissionTarget,
  ] = useState(null);

  const [
    commissionForm,
    setCommissionForm,
  ] = useState(
    INITIAL_COMMISSION_FORM
  );

  const [
    commissionSaving,
    setCommissionSaving,
  ] = useState(false);

  const [
    commissionSuccess,
    setCommissionSuccess,
  ] = useState("");

  const [
    withdrawingAgreement,
    setWithdrawingAgreement,
  ] = useState(false);

  /* =========================================================
     EXTEND COLLABORATION MODAL
  ========================================================= */

  const [
    extendTarget,
    setExtendTarget,
  ] = useState(null);

  /* =========================================================
     LOAD
  ========================================================= */

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
            throw Object.assign(
              new Error(
                data?.message ||
                  data?.error ||
                  "Nu am putut încărca influencerii."
              ),
              {
                code:
                  data?.error,
              }
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

          return data;
        } catch (err) {
          setItems([]);

          setError(
            err?.message ||
              "Nu am putut încărca influencerii."
          );

          return null;
        } finally {
          setLoading(false);
        }
      },
      []
    );

  useEffect(() => {
    loadInfluencers();
  }, [loadInfluencers]);

  /* =========================================================
     CLOSE INVITE
  ========================================================= */

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

  /* =========================================================
     CLOSE COMMISSION
  ========================================================= */

  const closeCommissionModal =
    useCallback(() => {
      if (
        commissionSaving ||
        withdrawingAgreement
      ) {
        return;
      }

      setCommissionOpen(
        false
      );

      setCommissionTarget(
        null
      );

      setCommissionForm(
        INITIAL_COMMISSION_FORM
      );

      setCommissionSuccess(
        ""
      );

      setError("");
    }, [
      commissionSaving,
      withdrawingAgreement,
    ]);

  /* =========================================================
     ESC
  ========================================================= */

  useEffect(() => {
    if (
      !inviteOpen &&
      !commissionOpen
    ) {
      return;
    }

    function handleEscape(
      event
    ) {
      if (
        event.key !==
        "Escape"
      ) {
        return;
      }

      if (
        commissionOpen
      ) {
        closeCommissionModal();
        return;
      }

      if (
        inviteOpen
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
    commissionOpen,
    closeInviteModal,
    closeCommissionModal,
  ]);

  /* =========================================================
     FILTER
  ========================================================= */

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
            getCommissionStatusLabel(
              item
            ),
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

  /* =========================================================
     STATS
  ========================================================= */

  const stats =
    useMemo(() => {
      const active =
        items.filter(
          (item) =>
            String(
              item.status ||
                ""
            ).toUpperCase() ===
            "ACTIVE"
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

      const commissionPending =
        items.filter(
          (item) =>
            item?.type ===
              "PROFILE" &&
            (
              item
                ?.hasPendingCommissionAgreement ||
              item
                ?.pendingCommissionAgreement
            )
        ).length;

      return {
        total:
          items.length,

        active,

        invited,

        totalClicks,

        totalOrders,

        commissionPending,
      };
    }, [items]);

  /* =========================================================
     INVITE
  ========================================================= */

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

    const { firstName, lastName } =
      splitFullName(item.name);

    setForm({
      firstName,
      lastName,

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

    const firstName =
      form.firstName.trim();

    const lastName =
      form.lastName.trim();

    const email =
      form.email
        .trim()
        .toLowerCase();

    if (!firstName) {
      setError(
        "Completează prenumele influencerului."
      );

      return;
    }

    if (!lastName) {
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

    const name =
      `${firstName} ${lastName}`.trim();

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
              firstName,
              lastName,
              email,
            },
          }
        );

      if (
        data?.ok === false
      ) {
        throw Object.assign(
          new Error(
            data?.message ||
              data?.error
          ),
          {
            code:
              data?.error,
          }
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
          err?.code ||
            err?.data
              ?.error,
          err?.data
            ?.message ||
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
        throw Object.assign(
          new Error(
            data?.message ||
              data?.error
          ),
          {
            code:
              data?.error,
          }
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
          err?.code ||
            err?.data
              ?.error,

          err?.data
            ?.message ||
            err?.message ||
            "Nu am putut șterge invitația."
        )
      );
    } finally {
      setDeletingId("");
    }
  }

  async function resendInvite(
    item
  ) {
    if (
      item?.type !==
        "INVITE" ||
      !item?.id
    ) {
      return;
    }

    const confirmed =
      window.confirm(
        `Sigur vrei să retrimiți invitația către ${
          item.email ||
          item.name ||
          "acest influencer"
        }? Linkul vechi va fi înlocuit cu unul nou.`
      );

    if (!confirmed) {
      return;
    }

    setResendingInviteId(
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
              "PATCH",

            body: {
              name:
                item.name ||
                "",

              email:
                item.email ||
                "",
            },
          }
        );

      if (
        data?.ok === false
      ) {
        throw Object.assign(
          new Error(
            data?.message ||
              data?.error
          ),
          {
            code:
              data?.error,
          }
        );
      }

      const refreshed =
        await loadInfluencers();

      const refreshedItems =
        refreshed?.items ||
        refreshed?.influencers ||
        [];

      const updatedItem =
        refreshedItems.find(
          (entry) =>
            entry.type ===
              "INVITE" &&
            entry.id ===
              item.id
        );

      if (
        updatedItem
      ) {
        setSelectedInfluencer(
          updatedItem
        );
      }

      if (
        data?.emailSent === false
      ) {
        window.alert(
          "Linkul a fost regenerat, dar emailul nu a putut fi trimis."
        );
      } else {
        window.alert(
          "Invitația a fost retrimisă."
        );
      }
    } catch (err) {
      setError(
        mapInviteError(
          err?.code ||
            err?.data
              ?.error,

          err?.data
            ?.message ||
            err?.message ||
            "Nu am putut retrimite invitația."
        )
      );
    } finally {
      setResendingInviteId(
        ""
      );
    }
  }

  /* =========================================================
     COMMISSION
  ========================================================= */

  function openCommissionModal(
    item
  ) {
    if (
      item?.type !==
      "PROFILE"
    ) {
      return;
    }

    setError("");
    setCommissionSuccess("");

    setCommissionTarget(
      item
    );

    const pending =
      getPendingCommissionPercent(
        item
      );

    const active =
      getActiveCommissionPercent(
        item
      );

    setCommissionForm({
      commissionPercent:
        pending !== null
          ? String(
              pending
            )
          : active > 0
            ? String(
                active
              )
            : "",
    });

    setCommissionOpen(
      true
    );
  }

  async function submitCommission(
    event
  ) {
    event.preventDefault();

    if (
      !commissionTarget?.id
    ) {
      return;
    }

    const commissionPercent =
      Number(
        commissionForm.commissionPercent
      );

    if (
      !Number.isFinite(
        commissionPercent
      ) ||
      commissionPercent <= 0 ||
      commissionPercent > 100
    ) {
      setError(
        "Introdu un procent între 0,01% și 100%."
      );

      return;
    }

    setCommissionSaving(
      true
    );

    setCommissionSuccess("");
    setError("");

    try {
      const data =
        await api(
          `/api/admin/influencers/${encodeURIComponent(
            commissionTarget.id
          )}/commission-agreement`,
          {
            method:
              "POST",

            body: {
              commissionPercent,
            },
          }
        );

      if (
        data?.ok === false
      ) {
        throw Object.assign(
          new Error(
            data?.message ||
              data?.error
          ),
          {
            code:
              data?.error,
          }
        );
      }

      setCommissionSuccess(
        "Propunerea de remunerație a fost trimisă influencerului."
      );

      const refreshed =
        await loadInfluencers();

      const refreshedItems =
        refreshed?.items ||
        [];

      const updatedTarget =
        refreshedItems.find(
          (item) =>
            item.type ===
              "PROFILE" &&
            item.id ===
              commissionTarget.id
        );

      if (
        updatedTarget
      ) {
        setCommissionTarget(
          updatedTarget
        );
      }
    } catch (err) {
      setError(
        mapCommissionError(
          err?.code ||
            err?.data
              ?.error,

          err?.data
            ?.message ||
            err?.message
        )
      );
    } finally {
      setCommissionSaving(
        false
      );
    }
  }

  async function withdrawCommissionProposal() {
    const agreementId =
      commissionTarget
        ?.pendingCommissionAgreement
        ?.id;

    if (
      !commissionTarget?.id ||
      !agreementId
    ) {
      return;
    }

    const confirmed =
      window.confirm(
        "Sigur vrei să retragi propunerea de remunerație aflată în așteptare?"
      );

    if (!confirmed) {
      return;
    }

    setWithdrawingAgreement(
      true
    );

    setCommissionSuccess("");
    setError("");

    try {
      const data =
        await api(
          `/api/admin/influencers/${encodeURIComponent(
            commissionTarget.id
          )}/commission-agreement/${encodeURIComponent(
            agreementId
          )}`,
          {
            method:
              "DELETE",
          }
        );

      if (
        data?.ok === false
      ) {
        throw Object.assign(
          new Error(
            data?.message ||
              data?.error
          ),
          {
            code:
              data?.error,
          }
        );
      }

      setCommissionSuccess(
        "Propunerea a fost retrasă."
      );

      const refreshed =
        await loadInfluencers();

      const refreshedItems =
        refreshed?.items ||
        [];

      const updatedTarget =
        refreshedItems.find(
          (item) =>
            item.type ===
              "PROFILE" &&
            item.id ===
              commissionTarget.id
        );

      if (
        updatedTarget
      ) {
        setCommissionTarget(
          updatedTarget
        );

        const active =
          getActiveCommissionPercent(
            updatedTarget
          );

        setCommissionForm({
          commissionPercent:
            active > 0
              ? String(
                  active
                )
              : "",
        });
      }
    } catch (err) {
      setError(
        mapCommissionError(
          err?.code ||
            err?.data
              ?.error,

          err?.data
            ?.message ||
            err?.message
        )
      );
    } finally {
      setWithdrawingAgreement(
        false
      );
    }
  }

  /* =========================================================
     COPY
  ========================================================= */

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

  /* =========================================================
     PAGE
  ========================================================= */

  return (
    <div
      className={
        styles.root
      }
    >
      {/* =====================================================
          HEADER
      ===================================================== */}

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
            Invită influenceri în Artfest, stabilește remunerația colaborării și urmărește performanța.
          </p>
        </div>

        {subTab === "influencers" && (
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
        )}
      </div>

      {/* =====================================================
          SUB-TABURI
      ===================================================== */}

      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          marginBottom: 20,
        }}
      >
        {SUB_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setSubTab(tab.id)}
            className={
              subTab === tab.id
                ? styles.primaryButton
                : styles.secondaryButton
            }
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* =====================================================
          STATS (OVERVIEW)
      ===================================================== */}

      {subTab === "overview" && (
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

        <StatCard
          label="Remunerații în așteptare"
          value={
            stats.commissionPending
          }
        />
      </div>
      )}

      {/* =====================================================
          PROMOVARE (placeholder)
      ===================================================== */}

      {subTab === "promotion" && (
        <div className={styles.card}>
          <div className={styles.cardTitle}>
            Promovare
          </div>

          <div className={styles.cardSubtitle}>
            Administrarea campaniilor de promovare pentru
            influenceri nu există încă ca funcționalitate
            separată - urmează într-o iterație viitoare.
          </div>
        </div>
      )}

      {/* =====================================================
          COMENZI (sumar din datele deja încărcate)
      ===================================================== */}

      {subTab === "orders" && (
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <div className={styles.cardTitle}>
                Comenzi pe influencer
              </div>

              <div className={styles.cardSubtitle}>
                Sumar din aceleași date încărcate în tab-ul
                Influenceri - nu există încă un model dedicat
                de comenzi per influencer.
              </div>
            </div>
          </div>

          {items.filter((item) => item.type === "PROFILE")
            .length === 0 ? (
            <div className={styles.emptyState}>
              <div className={styles.emptyTitle}>
                Nu există încă influenceri activi.
              </div>
            </div>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Nume</th>
                    <th>Comenzi</th>
                    <th>Vânzări</th>
                    <th>Câștig confirmat</th>
                  </tr>
                </thead>

                <tbody>
                  {items
                    .filter((item) => item.type === "PROFILE")
                    .map((item) => (
                      <tr key={item.id}>
                        <td>{item.name || "—"}</td>

                        <td>
                          {Number(
                            item.ordersCount || 0
                          ).toLocaleString("ro-RO")}
                        </td>

                        <td>
                          {formatMoney(
                            item.salesAmount || 0
                          )}
                        </td>

                        <td>
                          {formatMoney(
                            item.earningsAmount || 0
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* =====================================================
          RESURSE
      ===================================================== */}

      {subTab === "resources" && (
        <AdminInfluencerResourcesTab />
      )}

      {/* =====================================================
          FISCALIZARE & PLĂȚI
      ===================================================== */}

      {subTab === "payouts" && (
        <AdminInfluencerPayoutsTab />
      )}

      {/* =====================================================
          TABLE CARD (INFLUENCERI)
      ===================================================== */}

      {subTab === "influencers" && (
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
              Conturile active, invitațiile și remunerațiile colaborărilor.
            </div>
          </div>

          <div
            className={
              styles.filters
            }
          >
            <input
              type="search"
              value={
                query
              }
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
                  <th>Nume</th>
                  <th>Email</th>
                  <th>Status</th>
                  <th>Status colaborare</th>
                  <th>Început</th>
                  <th>Expiră la</th>
                  <th>Remunerație</th>
                  <th>Stare remunerație</th>
                  <th>Clickuri</th>
                  <th>Comenzi</th>
                  <th>Vânzări</th>
                  <th>Creat</th>
                </tr>
              </thead>

              <tbody>
                {filteredItems.map(
                  (item) => {
                    const isProfile =
                      item.type ===
                      "PROFILE";

                    return (
                      <tr
                        key={`${item.type || "item"}-${item.id}`}
                        className={
                          styles.clickableRow
                        }
                        onClick={() =>
                          setSelectedInfluencer(
                            item
                          )
                        }
                        tabIndex={0}
                        role="button"
                        onKeyDown={(event) => {
                          if (
                            event.key ===
                              "Enter" ||
                            event.key ===
                              " "
                          ) {
                            event.preventDefault();

                            setSelectedInfluencer(
                              item
                            );
                          }
                        }}
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
                          {item.collaboration ? (
                            <>
                              <span
                                className={`${styles.status} ${getCollaborationStatusClass(
                                  item.collaboration
                                    .collaborationStatus
                                )}`}
                              >
                                {getCollaborationStatusLabel(
                                  item.collaboration
                                    .collaborationStatus
                                )}
                              </span>

                              {item.collaboration
                                .expiringSoon && (
                                <span
                                  className={
                                    styles.collaborationExpiringSoon
                                  }
                                >
                                  Expiră în curând
                                </span>
                              )}
                            </>
                          ) : (
                            "—"
                          )}
                        </td>

                        <td>
                          {item.collaboration
                            ? formatCollaborationDate(
                                item.collaboration
                                  .collaborationStart
                              )
                            : "—"}
                        </td>

                        <td>
                          {item.collaboration
                            ? formatCollaborationDate(
                                item.collaboration
                                  .collaborationEnd
                              )
                            : "—"}
                        </td>

                        <td>
                          <div>
                            <strong>
                              {getRemunerationLabel(
                                item
                              )}
                            </strong>
                          </div>
                        </td>

                        <td>
                          {isProfile ? (
                            <CommissionStatus
                              item={
                                item
                              }
                            />
                          ) : (
                            "—"
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

                      </tr>
                    );
                  }
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
      )}

      {/* =====================================================
          INVITE MODAL
      ===================================================== */}

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
                  label="Prenume"
                  required
                >
                  <input
                    type="text"
                    value={
                      form.firstName
                    }
                    placeholder="Ex: Dora"
                    onChange={(
                      event
                    ) =>
                      updateField(
                        "firstName",
                        event.target
                          .value
                      )
                    }
                    className={
                      styles.input
                    }
                    autoComplete="given-name"
                  />
                </FormField>

                <FormField
                  label="Nume"
                  required
                >
                  <input
                    type="text"
                    value={
                      form.lastName
                    }
                    placeholder="Ex: Popescu"
                    onChange={(
                      event
                    ) =>
                      updateField(
                        "lastName",
                        event.target
                          .value
                      )
                    }
                    className={
                      styles.input
                    }
                    autoComplete="family-name"
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
                      .
                    </div>
                  </div>
                ) : (
                  <div
                    className={
                      styles.warningBox
                    }
                  >
                    <strong>
                      Emailul nu a putut fi trimis.
                    </strong>

                    <div>
                      Copiază linkul și trimite-l manual influencerului.
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
                      className={
                        styles.readOnlyBox
                      }
                    >
                      Link indisponibil.
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

      {/* =====================================================
          COMMISSION MODAL
      ===================================================== */}

      {commissionOpen &&
        commissionTarget && (
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
                closeCommissionModal();
              }
            }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="commission-influencer-title"
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
                    id="commission-influencer-title"
                    className={
                      styles.modalTitle
                    }
                  >
                    Remunerație influencer
                  </h3>

                  <p
                    className={
                      styles.modalSubtitle
                    }
                  >
                    {commissionTarget.name ||
                      commissionTarget.email}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={
                    closeCommissionModal
                  }
                  disabled={
                    commissionSaving ||
                    withdrawingAgreement
                  }
                  aria-label="Închide"
                  className={
                    styles.closeButton
                  }
                >
                  ×
                </button>
              </div>

              <div
                className={
                  styles.resultBody
                }
              >
                {/* CURRENT */}

                <div
                  className={
                    styles.infoBox
                  }
                >
                  <strong>
                    Remunerație activă
                  </strong>

                  <div
                    style={{
                      marginTop:
                        6,
                    }}
                  >
                    {getActiveCommissionPercent(
                      commissionTarget
                    ) > 0
                      ? `${formatPercent(
                          getActiveCommissionPercent(
                            commissionTarget
                          )
                        )} din comisionul Artfest`
                      : "Nu există încă o remunerație acceptată."}
                  </div>
                </div>

                {/* PENDING */}

                {commissionTarget
                  ?.pendingCommissionAgreement && (
                  <div
                    className={
                      styles.warningBox
                    }
                  >
                    <strong>
                      Propunere în așteptare
                    </strong>

                    <div
                      style={{
                        marginTop:
                          6,
                      }}
                    >
                      {formatPercent(
                        getPendingCommissionPercent(
                          commissionTarget
                        )
                      )}{" "}
                      din comisionul Artfest
                    </div>

                    <div
                      style={{
                        marginTop:
                          6,
                      }}
                    >
                      Trimisă la{" "}
                      {formatDate(
                        commissionTarget
                          .pendingCommissionAgreement
                          .proposedAt
                      )}
                    </div>

                    <button
                      type="button"
                      className={
                        styles.secondaryButton
                      }
                      style={{
                        marginTop:
                          12,
                      }}
                      disabled={
                        withdrawingAgreement ||
                        commissionSaving
                      }
                      onClick={
                        withdrawCommissionProposal
                      }
                    >
                      {withdrawingAgreement
                        ? "Se retrage..."
                        : "Retrage propunerea"}
                    </button>
                  </div>
                )}

                {commissionSuccess && (
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
                      ✓ Gata
                    </div>

                    <div
                      className={
                        styles.successText
                      }
                    >
                      {commissionSuccess}
                    </div>
                  </div>
                )}

                {/* FORM */}

                <form
                  onSubmit={
                    submitCommission
                  }
                  className={
                    styles.form
                  }
                >
                  <FormField
                    label="Procent din comisionul Artfest"
                    hint="Exemplu: dacă introduci 20, influencerul va primi 20% din comisionul Artfest aferent comenzilor eligibile, nu 20% din valoarea totală a comenzii."
                    required
                  >
                    <div
                      style={{
                        display:
                          "flex",
                        alignItems:
                          "center",
                        gap:
                          8,
                      }}
                    >
                      <input
                        type="number"
                        min="0.01"
                        max="100"
                        step="0.01"
                        value={
                          commissionForm.commissionPercent
                        }
                        onChange={(
                          event
                        ) =>
                          setCommissionForm(
                            {
                              commissionPercent:
                                event.target
                                  .value,
                            }
                          )
                        }
                        placeholder="Ex: 20"
                        className={
                          styles.input
                        }
                      />

                      <strong>
                        %
                      </strong>
                    </div>
                  </FormField>

                  <div
                    className={
                      styles.infoBox
                    }
                  >
                    <strong>
                      Cum funcționează
                    </strong>

                    <div
                      style={{
                        marginTop:
                          6,
                        lineHeight:
                          1.55,
                      }}
                    >
                      Noua valoare nu devine activă imediat. Influencerul primește propunerea în dashboard și trebuie să o accepte.
                    </div>
                  </div>

                  <div
                    className={
                      styles.formActions
                    }
                  >
                    <button
                      type="button"
                      className={
                        styles.secondaryButton
                      }
                      disabled={
                        commissionSaving ||
                        withdrawingAgreement
                      }
                      onClick={
                        closeCommissionModal
                      }
                    >
                      Închide
                    </button>

                    <button
                      type="submit"
                      className={
                        styles.primaryButton
                      }
                      disabled={
                        commissionSaving ||
                        withdrawingAgreement
                      }
                    >
                      {commissionSaving
                        ? "Se trimite..."
                        : commissionTarget
                            ?.pendingCommissionAgreement
                          ? "Trimite propunere nouă"
                          : getActiveCommissionPercent(
                                commissionTarget
                              ) > 0
                            ? "Propune modificarea"
                            : "Trimite propunerea"}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}

      {selectedInfluencer && (
        <InfluencerDetailsDrawer
          item={
            selectedInfluencer
          }
          copyState={
            copyState
          }
          resending={
            resendingInviteId ===
            selectedInfluencer.id
          }
          deleting={
            deletingId ===
            selectedInfluencer.id
          }
          onClose={() =>
            setSelectedInfluencer(
              null
            )
          }
          onCopyInvite={
            copyInvite
          }
          onResendInvite={
            resendInvite
          }
          onEditInvite={(item) => {
            setSelectedInfluencer(
              null
            );

            openEditInvite(
              item
            );
          }}
          onDeleteInvite={async (
            item
          ) => {
            await deleteInvite(
              item
            );

            setSelectedInfluencer(
              null
            );
          }}
          onCommission={(item) => {
            setSelectedInfluencer(
              null
            );

            openCommissionModal(
              item
            );
          }}
          onExtendCollaboration={(item) => {
            setSelectedInfluencer(
              null
            );

            setExtendTarget(
              item
            );
          }}
        />
      )}

      {/* =====================================================
          EXTEND COLLABORATION MODAL
      ===================================================== */}

      {extendTarget && (
        <ExtendCollaborationModal
          item={extendTarget}
          onClose={() =>
            setExtendTarget(null)
          }
          onExtended={async () => {
            const extendedId =
              extendTarget.id;

            setExtendTarget(null);

            const refreshed =
              await loadInfluencers();

            const updated = (
              refreshed?.items ||
              []
            ).find(
              (item) =>
                item.type ===
                  "PROFILE" &&
                item.id ===
                  extendedId
            );

            if (updated) {
              setSelectedInfluencer(
                updated
              );
            }
          }}
        />
      )}
    </div>
  );
}

function InfluencerDetailsDrawer({
  item,
  copyState,
  resending,
  deleting,
  onClose,
  onCopyInvite,
  onResendInvite,
  onEditInvite,
  onDeleteInvite,
  onCommission,
  onExtendCollaboration,
}) {
  if (!item) {
    return null;
  }

  const isInvite =
    item.type ===
    "INVITE";

  const isProfile =
    item.type ===
    "PROFILE";

  const inviteUrl =
    item.inviteUrl ||
    item.invitationUrl ||
    item.invite
      ?.inviteUrl ||
    "";

  const activeCommission =
    getActiveCommissionPercent(
      item
    );

  const pendingCommission =
    getPendingCommissionPercent(
      item
    );

  if (typeof document === "undefined") {
    return null;
  }

  const node = (
    <div
      className={
        styles.drawerOverlay
      }
      onMouseDown={(
        event
      ) => {
        if (
          event.target ===
          event.currentTarget
        ) {
          onClose();
        }
      }}
    >
      <aside
        className={
          styles.drawer
        }
        aria-label="Detalii influencer"
      >
        <div
          className={
            styles.drawerHeader
          }
        >
          <div>
            <h3
              className={
                styles.drawerTitle
              }
            >
              {item.name ||
                "Influencer"}
            </h3>

            <div
              className={
                styles.drawerSub
              }
            >
              {item.email ||
                "—"}
            </div>
          </div>

          <button
            type="button"
            className={
              styles.drawerClose
            }
            onClick={
              onClose
            }
            aria-label="Închide"
          >
            ×
          </button>
        </div>

        <div
          className={
            styles.drawerBody
          }
        >
          <section
            className={
              styles.drawerSection
            }
          >
            <h4>
              Detalii
            </h4>

            <DrawerField
              label="Tip"
              value={
                isInvite
                  ? "Invitație"
                  : "Influencer activ"
              }
            />

            <DrawerField
              label="Nume"
              value={
                item.firstName ||
                item.lastName
                  ? [
                      item.firstName,
                      item.lastName,
                    ]
                      .filter(Boolean)
                      .join(" ")
                  : item.name || "—"
              }
            />

            <DrawerField
              label="Status"
            >
              <span
                className={`${styles.status} ${getStatusClass(
                  item.status
                )}`}
              >
                {getStatusLabel(
                  item.status
                )}
              </span>
            </DrawerField>

            <DrawerField
              label="Email"
              value={
                item.email ||
                "—"
              }
            />

            <DrawerField
              label="Creat la"
              value={
                formatDate(
                  item.createdAt
                )
              }
            />

            {item.expiresAt && (
              <DrawerField
                label="Expiră la"
                value={
                  formatDate(
                    item.expiresAt
                  )
                }
              />
            )}

            <DrawerField
              label="ID"
            >
              <code>
                {item.id}
              </code>
            </DrawerField>
          </section>

          {isProfile && (
            <InfluencerFilesDrawerSection
              influencerId={item.id}
            />
          )}

          {isInvite && (
            <section
              className={
                styles.drawerSection
              }
            >
              <h4>
                Invitație
              </h4>

              <DrawerField
                label="Link invitație"
              >
                {inviteUrl ? (
                  <div
                    style={{
                      wordBreak:
                        "break-all",
                    }}
                  >
                    {inviteUrl}
                  </div>
                ) : (
                  "Link indisponibil"
                )}
              </DrawerField>
            </section>
          )}

          {isProfile && (
            <>
              <section
                className={
                  styles.drawerSection
                }
              >
                <h4>
                  Performanță
                </h4>

                <DrawerField
                  label="Clickuri"
                  value={Number(
                    item.clicks ||
                      0
                  ).toLocaleString(
                    "ro-RO"
                  )}
                />

                <DrawerField
                  label="Comenzi"
                  value={Number(
                    item.ordersCount ||
                      0
                  ).toLocaleString(
                    "ro-RO"
                  )}
                />

                <DrawerField
                  label="Vânzări"
                  value={formatMoney(
                    item.salesAmount ||
                      item.salesTotal ||
                      0
                  )}
                />

                <DrawerField
                  label="Câștig"
                  value={formatMoney(
                    item.earningsAmount ||
                      0
                  )}
                />
              </section>

              <section
                className={
                  styles.drawerSection
                }
              >
                <h4>
                  Remunerație
                </h4>

                <DrawerField
                  label="Activă"
                  value={
                    activeCommission >
                    0
                      ? `${formatPercent(
                          activeCommission
                        )} din comisionul Artfest`
                      : "Nesetată"
                  }
                />

                <DrawerField
                  label="Status"
                  value={
                    getCommissionStatusLabel(
                      item
                    )
                  }
                />

                {pendingCommission !==
                  null && (
                  <DrawerField
                    label="În așteptare"
                    value={`${formatPercent(
                      pendingCommission
                    )} din comisionul Artfest`}
                  />
                )}
              </section>

              {item.collaboration && (
                <section
                  className={
                    styles.drawerSection
                  }
                >
                  <h4>
                    Colaborare Artfest
                  </h4>

                  <DrawerField
                    label="Status colaborare"
                  >
                    <span
                      className={`${styles.status} ${getCollaborationStatusClass(
                        item.collaboration
                          .collaborationStatus
                      )}`}
                    >
                      {getCollaborationStatusLabel(
                        item.collaboration
                          .collaborationStatus
                      )}
                    </span>

                    {item.collaboration
                      .expiringSoon && (
                      <span
                        className={
                          styles.collaborationExpiringSoon
                        }
                      >
                        Expiră în curând
                      </span>
                    )}
                  </DrawerField>

                  <DrawerField
                    label="Început colaborare"
                    value={formatCollaborationDate(
                      item.collaboration
                        .collaborationStart
                    )}
                  />

                  <DrawerField
                    label="Colaborare valabilă până la"
                    value={formatCollaborationDate(
                      item.collaboration
                        .collaborationEnd
                    )}
                  />

                  <DrawerField
                    label="Remunerație"
                    value={`${formatPercent(
                      item.collaboration
                        .commissionPercent
                    )} din comisionul Artfest`}
                  />

                  <button
                    type="button"
                    className={
                      styles.secondaryButton
                    }
                    style={{
                      marginTop: 4,
                    }}
                    onClick={() =>
                      onExtendCollaboration?.(
                        item
                      )
                    }
                  >
                    Prelungește colaborarea
                  </button>
                </section>
              )}
            </>
          )}
        </div>

        <div
          className={
            styles.drawerFooter
          }
        >
          {isInvite && (
            <>
              {inviteUrl && (
                <button
                  type="button"
                  className={
                    styles.drawerBtnSecondary
                  }
                  onClick={() =>
                    onCopyInvite(
                      item
                    )
                  }
                >
                  {copyState ===
                  `invite-${item.id}`
                    ? "Copiat ✓"
                    : "Copiază linkul"}
                </button>
              )}

              <button
                type="button"
                className={
                  styles.drawerBtnSecondary
                }
                disabled={
                  resending ||
                  deleting
                }
                onClick={() =>
                  onResendInvite(
                    item
                  )
                }
              >
                {resending
                  ? "Se retrimite..."
                  : "Retrimite invitația"}
              </button>

              <button
                type="button"
                className={
                  styles.drawerBtnSecondary
                }
                disabled={
                  resending ||
                  deleting
                }
                onClick={() =>
                  onEditInvite(
                    item
                  )
                }
              >
                Editează invitația
              </button>

              <button
                type="button"
                className={
                  styles.drawerBtnDanger
                }
                disabled={
                  resending ||
                  deleting
                }
                onClick={() =>
                  onDeleteInvite(
                    item
                  )
                }
              >
                {deleting
                  ? "Se șterge..."
                  : "Șterge invitația"}
              </button>
            </>
          )}

          {isProfile && (
            <button
              type="button"
              className={
                styles.drawerBtnSecondary
              }
              onClick={() =>
                onCommission(
                  item
                )
              }
            >
              Gestionează remunerația
            </button>
          )}
        </div>
      </aside>
    </div>
  );

  return createPortal(
    node,
    document.body
  );
}

/* =========================================================
   FIȘIERE INFLUENCER (read-only)

   Doar listă + „Deschide” - upload/ștergere rămân exclusiv
   ale influencerului, din dashboardul lui.
========================================================= */

const INFLUENCER_FILE_TYPE_LABELS = {
  CONTRACT: "Contract",
  BRIEF: "Brief",
  DOCUMENT: "Document",
  OTHER: "Altul",
};

function formatFileSize(value) {
  const bytes = Number(value || 0);

  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function InfluencerFilesDrawerSection({ influencerId }) {
  const [loading, setLoading] = useState(true);
  const [files, setFiles] = useState([]);
  const [error, setError] = useState("");
  const [openingId, setOpeningId] = useState("");

  async function openFile(file) {
    setOpeningId(file.id);

    try {
      const response = await api(
        `/api/admin/influencers/${influencerId}/files/${file.id}/download`
      );
      window.open(response.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(
        err?.data?.message ||
          err?.message ||
          "Nu am putut deschide fișierul."
      );
    } finally {
      setOpeningId("");
    }
  }

  useEffect(() => {
    let active = true;

    if (!influencerId) {
      return undefined;
    }

    setLoading(true);
    setError("");

    api(`/api/admin/influencers/${influencerId}/files`)
      .then((response) => {
        if (!active) return;

        setFiles(
          Array.isArray(response?.items) ? response.items : []
        );
      })
      .catch((err) => {
        if (!active) return;

        setError(
          err?.data?.message ||
            err?.message ||
            "Nu am putut încărca fișierele."
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [influencerId]);

  return (
    <section className={styles.drawerSection}>
      <h4>Fișiere</h4>

      {loading ? (
        <div>Se încarcă...</div>
      ) : error ? (
        <div>{error}</div>
      ) : !files.length ? (
        <div>Influencerul nu a încărcat încă niciun fișier.</div>
      ) : (
        files.map((file) => (
          <DrawerField
            key={file.id}
            label={
              INFLUENCER_FILE_TYPE_LABELS[file.type] || "Document"
            }
          >
            <div>
              <div>{file.title || file.originalFilename}</div>

              <div>
                {formatDate(file.createdAt)} ·{" "}
                {formatFileSize(file.sizeBytes)}{" "}
                ·{" "}
                <button
                  type="button"
                  className={styles.linkButton}
                  disabled={openingId === file.id}
                  onClick={() => openFile(file)}
                >
                  {openingId === file.id ? "Se deschide..." : "Deschide"}
                </button>
              </div>
            </div>
          </DrawerField>
        ))
      )}
    </section>
  );
}

function DrawerField({
  label,
  value,
  children,
}) {
  return (
    <div
      className={
        styles.drawerField
      }
    >
      <span>
        {label}
      </span>

      <div>
        {children ??
          value ??
          "—"}
      </div>
    </div>
  );
}

/* =========================================================
   STAT
========================================================= */

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

/* =========================================================
   COMMISSION STATUS
========================================================= */

function CommissionStatus({
  item,
}) {
  const pending =
    getPendingCommissionPercent(
      item
    );

  const active =
    getActiveCommissionPercent(
      item
    );

  if (
    pending !== null
  ) {
    return (
      <span
        className={`${styles.status} ${styles.statusInvited}`}
      >
        Așteaptă acceptarea
      </span>
    );
  }

  if (
    active > 0
  ) {
    return (
      <span
        className={`${styles.status} ${styles.statusActive}`}
      >
        Acceptată
      </span>
    );
  }

  return (
    <span
      className={`${styles.status} ${styles.statusDisabled}`}
    >
      Nesetată
    </span>
  );
}

/* =========================================================
   EMPTY
========================================================= */

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

/* =========================================================
   FIELD
========================================================= */

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