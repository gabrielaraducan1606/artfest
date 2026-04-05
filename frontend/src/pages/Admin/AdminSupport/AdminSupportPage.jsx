// src/components/SupportBase/AdminSupportBase.jsx
import { useEffect, useMemo, useState, useRef } from "react";
import { api } from "../../../lib/api.js";
import {
  LifeBuoy,
  Search as SearchIcon,
  RefreshCw,
  Loader2,
  Filter,
  ChevronRight,
  ChevronLeft,
  Send,
  Trash2,
  User as UserIcon,
  Store as StoreIcon,
  Pencil,
} from "lucide-react";

import styles from "./AdminSupportPage.module.css";

/* ==== Helpers ==== */

const lc = (v) => (v || "").toLowerCase();

function fmtTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  const diffDays = Math.floor((today - d) / 86400000);
  if (isToday) {
    return d.toLocaleTimeString("ro-RO", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  if (diffDays < 7) {
    return d.toLocaleDateString("ro-RO", {
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return d.toLocaleDateString("ro-RO", {
    day: "2-digit",
    month: "short",
  });
}

function groupByDate(items = []) {
  const out = [];
  let lastLabel = "";
  for (const m of items) {
    const d = new Date(m.createdAt);
    const today = new Date();
    const isToday = d.toDateString() === today.toDateString();
    const label = isToday
      ? "Azi"
      : d.toLocaleDateString("ro-RO", {
          weekday: "long",
          day: "2-digit",
          month: "long",
        });
    if (label !== lastLabel) {
      out.push({ type: "divider", label });
      lastLabel = label;
    }
    out.push({ type: "msg", item: m });
  }
  return out;
}

/* ==== UI mici: status & priority ==== */

function StatusBadge({ status, archivedByRequesterAt, deletedAt }) {
  // ✅ priority: show deleted/archived badges over normal status
  if (deletedAt) {
    return (
      <span className={`${styles.badge} ${styles.closed}`}>
        ● Șters (admin)
      </span>
    );
  }
  if (archivedByRequesterAt) {
    return (
      <span className={`${styles.badge} ${styles.pending}`}>
        ● Șters de utilizator
      </span>
    );
  }

  const s = lc(status);
  if (s === "open") {
    return <span className={`${styles.badge} ${styles.open}`}>● Deschis</span>;
  }
  if (s === "pending") {
    return (
      <span className={`${styles.badge} ${styles.pending}`}>● În lucru</span>
    );
  }
  return <span className={`${styles.badge} ${styles.closed}`}>● Închis</span>;
}

function PriorityDot({ priority }) {
  const p = lc(priority);
  const cls =
    p === "high" ? styles.pHigh : p === "medium" ? styles.pMed : styles.pLow;
  return (
    <span
      className={`${styles.priority} ${cls}`}
      title={`Prioritate: ${p || "necunoscută"}`}
    />
  );
}

/* ==== Bubble pentru mesaje (cu edit / delete admin + hover/long-press) ==== */

function MessageBubble({ m, onEdit, onDelete, isMobile }) {
  const mine = m.from === "me";
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(m.body);
  const [saving, setSaving] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const pressTimerRef = useRef(null);

  useEffect(() => {
    setDraft(m.body);
  }, [m.body, m.id]);

  useEffect(() => {
    setShowActions(false);
  }, [isMobile]);

  async function handleSave() {
    const body = draft.trim();
    if (!body || saving || !onEdit) return;
    setSaving(true);
    const ok = await onEdit(m.id, body);
    if (ok !== false) {
      setIsEditing(false);
    }
    setSaving(false);
  }

  async function handleDelete() {
    if (!onDelete) return;
    if (!window.confirm("Sigur vrei să ștergi acest mesaj?")) return;
    await onDelete(m.id);
  }

  function handleTouchStart() {
    if (!isMobile) return;
    if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
    pressTimerRef.current = setTimeout(() => {
      setShowActions(true);
    }, 450);
  }

  function handleTouchEnd() {
    if (!isMobile) return;
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
  }

  useEffect(() => {
    return () => {
      if (pressTimerRef.current) {
        clearTimeout(pressTimerRef.current);
      }
    };
  }, []);

  const actionsClasses = `${styles.bubbleActions} ${
    showActions ? styles.bubbleActionsVisible : ""
  }`;

  return (
    <div
      className={`${styles.bubbleRow} ${
        mine ? styles.bubbleRight : styles.bubbleLeft
      }`}
    >
      <div
        className={`${styles.bubble} ${mine ? styles.mine : styles.theirs}`}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
        <div className={actionsClasses}>
          <button
            type="button"
            className={styles.iconBtnSm}
            onClick={() => setIsEditing((v) => !v)}
            title="Editează mesaj"
          >
            <Pencil size={12} />
          </button>
          <button
            type="button"
            className={`${styles.iconBtnSm} ${styles.danger}`}
            onClick={handleDelete}
            title="Șterge mesaj"
          >
            <Trash2 size={12} />
          </button>
        </div>

        {!isEditing ? (
          <>
            <div>{m.body}</div>
            {m.attachments?.length ? (
              <ul
                style={{
                  marginTop: 6,
                  display: "grid",
                  gap: 4,
                }}
              >
                {m.attachments.map((a, i) => (
                  <li key={i}>
                    <a
                      href={a.url}
                      target="_blank"
                      rel="noreferrer"
                      className={styles.linkBtn}
                    >
                      {a.name || a.url}
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : (
          <div className={styles.editArea}>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
              className={styles.input}
            />
            <div className={styles.editActions}>
              <button
                type="button"
                className={styles.secondary}
                onClick={() => {
                  setDraft(m.body);
                  setIsEditing(false);
                }}
              >
                Anulează
              </button>
              <button
                type="button"
                className={styles.primary}
                onClick={handleSave}
                disabled={saving || !draft.trim()}
              >
                {saving ? (
                  <Loader2 size={14} className={styles.spin} />
                ) : (
                  "Salvează"
                )}
              </button>
            </div>
          </div>
        )}

        <div className={styles.meta}>{fmtTime(m.createdAt)}</div>
      </div>
    </div>
  );
}

/* ==== Composer simplu pentru admin (doar text) ==== */

function TicketComposer({ onSend, disabled, hint }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const taRef = useRef(null);

  useEffect(() => {
    taRef.current?.focus();
  }, []);

  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 140) + "px";
  }, [text]);

  async function handleSend() {
    const body = text.trim();
    if (!body || sending || disabled) return;
    setSending(true);
    await onSend(body);
    setText("");
    setSending(false);
    taRef.current?.focus();
  }

  function onKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <footer className={styles.composer}>
      <textarea
        ref={taRef}
        className={styles.input}
        rows={1}
        placeholder={hint || "Scrie un răspuns ca admin…"}
        value={text}
        disabled={sending || disabled}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <button
        className={styles.primary}
        onClick={handleSend}
        disabled={sending || disabled || !text.trim()}
      >
        {sending ? (
          <Loader2 size={16} className={styles.spin} />
        ) : (
          <Send size={16} />
        )}{" "}
        Trimite
      </button>
    </footer>
  );
}

/* ==== Panoul de detaliu ==== */

function TicketDetailPanel({
  ticket,
  messages,
  loadingMsgs,
  errorMsgs,
  onSendReply,
  onBack,
  onChangeStatus,
  onEditMessage,
  onDeleteMessage,
  isMobile,
}) {
  const listRef = useRef(null);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight + 1000;
  }, [messages, ticket?.id]);

  const grouped = useMemo(() => groupByDate(messages), [messages]);

  if (!ticket) {
    return (
      <div className={styles.ticketDetail}>
        <div className={styles.detailEmpty}>
          <LifeBuoy size={26} /> Selectează un tichet din listă.
        </div>
      </div>
    );
  }

  const audienceLabel =
    ticket.audience === "vendor"
      ? "Vendor"
      : ticket.audience === "guest"
      ? "Guest"
      : "User";

  const isDeletedByAdmin = !!ticket.deletedAt;
  const isArchivedByUser = !!ticket.archivedByRequesterAt;

  const composerDisabled = isDeletedByAdmin; // ✅ deleted tickets: no reply
  const composerHint = isDeletedByAdmin
    ? "Tichet șters (admin) — nu mai poți răspunde."
    : isArchivedByUser
    ? "Tichet șters de utilizator — poți răspunde, dar userul l-a ascuns din lista lui."
    : undefined;

  return (
    <div className={styles.ticketDetail}>
      <header className={styles.detailHead}>
        {onBack && (
          <button
            className={styles.iconBtn}
            onClick={onBack}
            title="Înapoi"
            aria-label="Înapoi la listă"
          >
            <ChevronLeft size={16} />
          </button>
        )}
        <div className={styles.detailTitle}>
          <PriorityDot priority={ticket.priority} />
          <span>{ticket.subject}</span>
          <StatusBadge
            status={ticket.status}
            archivedByRequesterAt={ticket.archivedByRequesterAt}
            deletedAt={ticket.deletedAt}
          />
        </div>

        {onChangeStatus && !isDeletedByAdmin && (
          <div className={styles.statusControl}>
            <select
              className={styles.input}
              value={lc(ticket.status)}
              onChange={(e) => onChangeStatus(ticket.id, e.target.value)}
            >
              <option value="open">Deschis</option>
              <option value="pending">În lucru</option>
              <option value="closed">Închis</option>
            </select>
          </div>
        )}
      </header>

      {/* extra info badges */}
      {(isArchivedByUser || isDeletedByAdmin) && (
        <div className={styles.detailMeta}>
          {isArchivedByUser && (
            <div className={styles.metaRow}>
              <span className={styles.muted}>Notă:</span>{" "}
              <b>Șters de utilizator</b>{" "}
              {ticket.archivedByRequesterAt ? (
                <span className={styles.muted}>
                  (la {fmtTime(ticket.archivedByRequesterAt)})
                </span>
              ) : null}
            </div>
          )}
          {isDeletedByAdmin && (
            <div className={styles.metaRow}>
              <span className={styles.muted}>Notă:</span>{" "}
              <b>Șters de admin</b>{" "}
              {ticket.deletedAt ? (
                <span className={styles.muted}>
                  (la {fmtTime(ticket.deletedAt)})
                </span>
              ) : null}
            </div>
          )}
        </div>
      )}

      <div className={styles.detailMeta}>
        <div className={styles.metaRow}>
          <span className={styles.muted}>Tip tichet:</span> <b>{audienceLabel}</b>
        </div>

        {ticket.requester ? (
          <div className={styles.metaRow}>
            <UserIcon size={14} />{" "}
            <span>
              <b>
                {ticket.requester.firstName || ticket.requester.lastName
                  ? `${ticket.requester.firstName || ""} ${
                      ticket.requester.lastName || ""
                    }`.trim()
                  : ticket.requester.email}
              </b>{" "}
              ({ticket.requester.email})
            </span>
          </div>
        ) : ticket.requesterEmail ? (
          <div className={styles.metaRow}>
            <UserIcon size={14} />{" "}
            <span>
              <b>{ticket.requesterName || "Guest"}</b> ({ticket.requesterEmail})
            </span>
          </div>
        ) : null}

        {ticket.vendor && (
          <div className={styles.metaRow}>
            <StoreIcon size={14} />{" "}
            <span>
              Vendor: <b>{ticket.vendor.displayName}</b> (ID: {ticket.vendor.id})
            </span>
          </div>
        )}
      </div>

      <div className={styles.msgList} ref={listRef}>
        {loadingMsgs && !messages.length && (
          <div className={styles.empty}>Se încarcă discuția…</div>
        )}
        {errorMsgs && (
          <div className={styles.error}>Nu am putut încărca mesajele.</div>
        )}
        {!loadingMsgs && !messages.length && (
          <div className={styles.empty}>
            Nu există mesaje încă.
            <div style={{ marginTop: 6 }}>
              <em>Trimite un mesaj pentru a porni discuția.</em>
            </div>
          </div>
        )}

        {grouped.map((g, idx) => {
          if (g.type === "divider") {
            return (
              <div
                key={`d-${idx}`}
                className={styles.dayDivider}
                role="separator"
              >
                <span>{g.label}</span>
              </div>
            );
          }
          return (
            <MessageBubble
              key={g.item.id}
              m={g.item}
              onEdit={onEditMessage}
              onDelete={onDeleteMessage}
              isMobile={isMobile}
            />
          );
        })}
      </div>

      <TicketComposer
        onSend={onSendReply}
        disabled={!ticket || composerDisabled}
        hint={composerHint}
      />
    </div>
  );
}

/* ==== COMPONENTA PRINCIPALĂ PENTRU ADMIN ==== */

export default function AdminSupportBase({ supportBase = "/api/admin/support" }) {
  const [tickets, setTickets] = useState([]);
  const [loadingTickets, setLoadingTickets] = useState(true);
  const [errorTickets, setErrorTickets] = useState(null);

  // ✅ adăugat archived + deleted
  const [statusFilter, setStatusFilter] = useState("all"); // all | open | pending | closed | archived | deleted

  // 👇 audience + rol
  const [audienceFilter, setAudienceFilter] = useState("all"); // all | user | vendor | guest
  const [roleFilter, setRoleFilter] = useState("all"); // all | user | vendor | admin

  const [priorityFilter, setPriorityFilter] = useState("all"); // all | low | medium | high
  const [search, setSearch] = useState("");

  const [selectedId, setSelectedId] = useState(null);

  const [messages, setMessages] = useState([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [errorMsgs, setErrorMsgs] = useState(null);

  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined"
      ? window.matchMedia("(max-width: 900px)").matches
      : false
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 900px)");
    const onChange = (e) => setIsMobile(e.matches);
    mq.addEventListener?.("change", onChange);
    setIsMobile(mq.matches);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  /* ===== încarcă tichetele ===== */

  const loadTickets = async () => {
    setLoadingTickets(true);
    setErrorTickets(null);
    try {
      const params = new URLSearchParams();
      params.set("status", statusFilter); // ✅ include archived/deleted
      params.set("audience", audienceFilter);
      params.set("priority", priorityFilter);

      // 👇 trimitem și filtrul de rol către backend
      params.set("role", roleFilter);

      if (search.trim()) params.set("q", search.trim());

      const url = `${supportBase}/tickets?${params.toString()}`;
      const d = await api(url);
      setTickets(Array.isArray(d?.items) ? d.items : []);
    } catch (e) {
      console.error("admin load tickets error", e);
      setErrorTickets("Nu am putut încărca tichetele.");
      setTickets([]);
    } finally {
      setLoadingTickets(false);
    }
  };

  useEffect(() => {
    loadTickets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, audienceFilter, priorityFilter, roleFilter]);

  useEffect(() => {
    const id = setTimeout(() => {
      loadTickets();
    }, 400);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  useEffect(() => {
    if (!tickets.length) {
      setSelectedId(null);
      setMessages([]);
      return;
    }
    if (!selectedId) {
      setSelectedId(tickets[0].id);
    } else if (!tickets.some((t) => t.id === selectedId)) {
      setSelectedId(tickets[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickets]);

  const current = useMemo(
    () => tickets.find((t) => t.id === selectedId) || null,
    [tickets, selectedId]
  );

  /* ===== încarcă mesaje pentru tichetul selectat ===== */

  const loadMessages = async (ticketId) => {
    if (!ticketId) {
      setMessages([]);
      return;
    }
    setLoadingMsgs(true);
    setErrorMsgs(null);
    try {
      const url = `${supportBase}/tickets/${ticketId}/messages`;
      const d = await api(url);
      setMessages(Array.isArray(d?.items) ? d.items : []);

      api(`${supportBase}/tickets/${ticketId}/read`, {
        method: "PATCH",
      }).catch(() => {});
    } catch (e) {
      console.error("admin load messages error", e);
      setErrorMsgs("Nu am putut încărca mesajele.");
      setMessages([]);
    } finally {
      setLoadingMsgs(false);
    }
  };

  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      return;
    }
    loadMessages(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  /* ===== trimite mesaj ca admin ===== */

  async function handleSendReply(body) {
    if (!current) return;

    // dacă e deleted de admin, nu mai trimitem
    if (current.deletedAt) {
      alert("Tichetul este șters (admin). Nu se mai pot trimite mesaje.");
      return;
    }

    const optimistic = {
      id: `local_${Date.now()}`,
      ticketId: current.id,
      from: "me",
      body,
      createdAt: new Date().toISOString(),
      attachments: [],
    };
    setMessages((prev) => [...prev, optimistic]);

    try {
      await api(`${supportBase}/tickets/${current.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, attachments: [] }),
      });

      await loadMessages(current.id);
      await loadTickets();
    } catch (e) {
      console.error("admin send message error", e);
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      alert(
        "Nu am putut trimite mesajul. Tichetul poate fi șters/indisponibil."
      );
      await loadTickets();
    }
  }

  /* ===== schimbă status tichet ===== */

  async function handleChangeStatus(ticketId, newStatus) {
    try {
      await api(`${supportBase}/tickets/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });

      setTickets((prev) =>
        prev.map((t) =>
          t.id === ticketId ? { ...t, status: newStatus } : t
        )
      );
    } catch (e) {
      console.error("admin change status error", e);
      alert("Nu am putut schimba statusul tichetului.");
    }
  }

  /* ===== editează mesaj ===== */

  async function handleEditMessage(messageId, body) {
    const ticketId = current?.id;
    if (!ticketId) return false;

    const prev = messages;
    setMessages((msgs) =>
      msgs.map((m) => (m.id === messageId ? { ...m, body } : m))
    );

    try {
      await api(`${supportBase}/messages/${messageId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      return true;
    } catch (e) {
      console.error("admin edit message error", e);
      alert("Nu am putut edita mesajul.");
      setMessages(prev);
      return false;
    }
  }

  /* ===== șterge mesaj ===== */

  async function handleDeleteMessage(messageId) {
    const ticketId = current?.id;
    if (!ticketId) return;

    const prev = messages;
    setMessages((msgs) => msgs.filter((m) => m.id !== messageId));

    try {
      await api(`${supportBase}/messages/${messageId}`, {
        method: "DELETE",
      });
    } catch (e) {
      console.error("admin delete message error", e);
      alert("Nu am putut șterge mesajul.");
      setMessages(prev);
    }
  }

  /* ===== șterge tichet (admin soft-delete) ===== */

  async function handleDeleteTicket(id) {
    if (!id) return;
    if (
      !window.confirm(
        "Soft-delete: ascunzi tichetul din listă (nu se șterg mesajele). Continui?"
      )
    )
      return;
    try {
      await api(`${supportBase}/tickets/${id}`, {
        method: "DELETE",
      });
      await loadTickets();
      if (selectedId === id) {
        setSelectedId(null);
        setMessages([]);
      }
    } catch (e) {
      console.error("admin delete ticket error", e);
      alert("Nu am putut șterge tichetul.");
    }
  }

  const showSplit = !isMobile;

  return (
    <div className={styles.wrap}>
      <aside className={styles.left}>
        <div className={styles.card}>
          <div className={styles.headRow}>
            <div className={styles.head}>
              <LifeBuoy size={18} /> Suport – Admin
            </div>
          </div>

          <div className={styles.filtersRow}>
            <div className={styles.filterWrap}>
              <button
                className={styles.iconBtn}
                type="button"
                title="Reîncarcă"
                onClick={loadTickets}
              >
                <RefreshCw size={16} />
              </button>
            </div>

            {/* Filtru după tip tichet (audience) */}
            <div className={styles.filterWrap}>
              <Filter size={14} />
              <select
                className={styles.input}
                value={audienceFilter}
                onChange={(e) => setAudienceFilter(e.target.value)}
              >
                <option value="all">Toate</option>
                <option value="user">Useri</option>
                <option value="vendor">Vendori</option>
                <option value="guest">Guest</option>
              </select>
            </div>

            {/* Filtru după rol user (USER / VENDOR / ADMIN) */}
            <div className={styles.filterWrap}>
              <span className={styles.muted} style={{ marginRight: 4 }}>
                Rol
              </span>
              <select
                className={styles.input}
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
              >
                <option value="all">Toate</option>
                <option value="user">User</option>
                <option value="vendor">Vendor</option>
                <option value="admin">Admin</option>
              </select>
            </div>

            {/* Filtru prioritate */}
            <div className={styles.filterWrap}>
              <span className={styles.muted} style={{ marginRight: 4 }}>
                Prioritate
              </span>
              <select
                className={styles.input}
                value={priorityFilter}
                onChange={(e) => setPriorityFilter(e.target.value)}
              >
                <option value="all">Toate</option>
                <option value="high">Mare</option>
                <option value="medium">Medie</option>
                <option value="low">Mică</option>
              </select>
            </div>
          </div>

          {/* ✅ status tabs cu "Șterse de utilizator" + "Șterse (admin)" */}
          <div className={styles.statusTabs}>
            {[
              { value: "all", label: "Toate" },
              { value: "open", label: "Deschise" },
              { value: "pending", label: "În lucru" },
              { value: "closed", label: "Închise" },
              { value: "archived", label: "Șterse de utilizator" },
              { value: "deleted", label: "Șterse (admin)" },
            ].map((s) => (
              <button
                key={s.value}
                type="button"
                className={`${styles.statusTab} ${
                  statusFilter === s.value ? styles.statusTabActive : ""
                }`}
                onClick={() => setStatusFilter(s.value)}
              >
                {s.label}
              </button>
            ))}
          </div>

          <div className={styles.search}>
            <SearchIcon size={16} />
            <input
              placeholder="Caută după subiect / email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      </aside>

      {showSplit ? (
        <div className={styles.split}>
          {/* LISTA DE TICHTE – desktop */}
          <div
            className={styles.ticketList}
            role="listbox"
            aria-label="Lista tichete suport"
          >
            {loadingTickets && !tickets.length && (
              <div className={styles.empty}>
                <div
                  className={styles.skeleton}
                  style={{ height: 48, marginBottom: 8 }}
                />
                <div
                  className={styles.skeleton}
                  style={{ height: 48, marginBottom: 8 }}
                />
                <div className={styles.skeleton} style={{ height: 48 }} />
              </div>
            )}
            {errorTickets && (
              <div className={styles.error}>{errorTickets}</div>
            )}
            {!loadingTickets && !tickets.length && (
              <div className={styles.empty}>
                Nu există tichete pentru filtrele selectate.
              </div>
            )}

            {tickets.map((t) => {
              const audienceLabel =
                t.audience === "vendor"
                  ? "Vendor"
                  : t.audience === "guest"
                  ? "Guest"
                  : "User";

              return (
                <button
                  key={t.id}
                  role="option"
                  aria-selected={t.id === selectedId}
                  onClick={() => setSelectedId(t.id)}
                  className={`${styles.ticketItem} ${
                    t.id === selectedId ? styles.selected : ""
                  }`}
                >
                  <div className={styles.row}>
                    <div className={styles.subject}>
                      <PriorityDot priority={t.priority} />
                      {t.subject}
                    </div>
                    <div className={styles.time}>{fmtTime(t.updatedAt)}</div>
                  </div>
                  <div className={styles.row}>
                    <StatusBadge
                      status={t.status}
                      archivedByRequesterAt={t.archivedByRequesterAt}
                      deletedAt={t.deletedAt}
                    />
                    <span className={styles.muted}>{audienceLabel}</span>
                    <ChevronRight size={16} />
                  </div>
                </button>
              );
            })}
          </div>

          <TicketDetailPanel
            ticket={current}
            messages={messages}
            loadingMsgs={loadingMsgs}
            errorMsgs={errorMsgs}
            onSendReply={handleSendReply}
            onChangeStatus={handleChangeStatus}
            onEditMessage={handleEditMessage}
            onDeleteMessage={handleDeleteMessage}
            isMobile={isMobile}
          />
        </div>
      ) : (
        <>
          {!current ? (
            <div
              className={styles.ticketList}
              role="listbox"
              aria-label="Lista tichete suport"
            >
              {loadingTickets && !tickets.length && (
                <div className={styles.empty}>
                  <div
                    className={styles.skeleton}
                    style={{ height: 48, marginBottom: 8 }}
                  />
                  <div
                    className={styles.skeleton}
                    style={{ height: 48, marginBottom: 8 }}
                  />
                  <div className={styles.skeleton} style={{ height: 48 }} />
                </div>
              )}
              {errorTickets && (
                <div className={styles.error}>{errorTickets}</div>
              )}
              {!loadingTickets && !tickets.length && (
                <div className={styles.empty}>
                  Nu există tichete pentru filtrele selectate.
                </div>
              )}

              {tickets.map((t) => {
                const audienceLabel =
                  t.audience === "vendor"
                    ? "Vendor"
                    : t.audience === "guest"
                    ? "Guest"
                    : "User";

                return (
                  <button
                    key={t.id}
                    role="option"
                    aria-selected={false}
                    onClick={() => setSelectedId(t.id)}
                    className={styles.ticketItem}
                  >
                    <div className={styles.row}>
                      <div className={styles.subject}>
                        <PriorityDot priority={t.priority} />
                        {t.subject}
                      </div>
                      <div className={styles.time}>{fmtTime(t.updatedAt)}</div>
                    </div>
                    <div className={styles.row}>
                      <StatusBadge
                        status={t.status}
                        archivedByRequesterAt={t.archivedByRequesterAt}
                        deletedAt={t.deletedAt}
                      />
                      <span className={styles.muted}>{audienceLabel}</span>
                      <ChevronRight size={16} />
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div style={{ width: "100%" }}>
              <div style={{ padding: "0 12px 8px" }}>
                <button
                  type="button"
                  className={styles.iconBtn}
                  onClick={() => setSelectedId(null)}
                >
                  <ChevronLeft size={16} /> Înapoi la tichete
                </button>

                {/* ✅ nu arătăm "șterge" pe taburile archived/deleted sau dacă e deja deleted */}
                {!current.deletedAt && statusFilter !== "deleted" && (
                  <button
                    type="button"
                    className={`${styles.iconBtn} ${styles.danger}`}
                    style={{ float: "right" }}
                    onClick={() => handleDeleteTicket(current.id)}
                    title="Șterge tichet"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>

              <TicketDetailPanel
                ticket={current}
                messages={messages}
                loadingMsgs={loadingMsgs}
                errorMsgs={errorMsgs}
                onSendReply={handleSendReply}
                onBack={() => setSelectedId(null)}
                onChangeStatus={handleChangeStatus}
                onEditMessage={handleEditMessage}
                onDeleteMessage={handleDeleteMessage}
                isMobile={isMobile}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
