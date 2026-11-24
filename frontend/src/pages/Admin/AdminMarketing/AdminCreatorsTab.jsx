// src/pages/Admin/AdminMarketing/AdminCreatorsTab.jsx
//
// Admin -> Marketing -> „Creators”: moderarea profilurilor Artfest Creators
// (etapa 1a). Listă pe status (implicit „În verificare”), detaliu cu versiunea
// publicată vs. cea trimisă, oferte, istoric și acțiunile: Aprobă / Cere
// modificări / Respinge / Suspendă / Reactivează (motiv obligatoriu unde e cazul).
// Moderare doar: fără acțiuni financiare. Link direct: ?tab=creators&profile=<id>.

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { api } from "../../../lib/api";
import { CREATORS_ADMIN_API, formatLei, friendlyError } from "../../../features/creators/creatorsLogic.js";
import { ConfirmDialog, CreatorProfilePreview, SkeletonBlock } from "../../../features/creators/creatorsShared.jsx";
import { cx, labelOf } from "../../../features/creators/creatorsClient.js";
import styles from "../../../features/creators/Creators.module.css";

const STATUS_FILTERS = [
  { value: "PENDING", label: "În verificare" },
  { value: "CHANGES_REQUESTED", label: "Modificări solicitate" },
  { value: "APPROVED", label: "Aprobate" },
  { value: "REJECTED", label: "Respinse" },
  { value: "DRAFT", label: "Ciorne" },
  { value: "", label: "Toate" },
];

// lista se reîncarcă periodic doar cât pagina e vizibilă
const LIST_REFRESH_MS = 30 * 1000;

const STATUS_LABEL = Object.fromEntries(STATUS_FILTERS.filter((s) => s.value).map((s) => [s.value, s.label]));
const STATUS_TONE = { PENDING: "warning", CHANGES_REQUESTED: "warning", APPROVED: "success", REJECTED: "danger", DRAFT: "muted" };

const EVENT_LABEL = {
  CREATED: "Profil creat",
  SUBMITTED: "Trimis spre aprobare",
  APPROVED: "Aprobat",
  CHANGES_REQUESTED: "Modificări solicitate",
  REJECTED: "Respins",
  SUSPENDED: "Suspendat",
  UNSUSPENDED: "Reactivat",
  PAUSED: "Pus pe pauză de influencer",
  RESUMED: "Reactivat de influencer",
  OFFER_DEACTIVATED_BY_ADMIN: "Ofertă dezactivată de Admin",
};

const EMAIL_LABEL = { SENT: "email trimis", FAILED: "email eșuat (se reîncearcă)", PENDING: "email în curs" };

const ACTIONS = {
  approve: { label: "Aprobă", title: "Aprobi profilul?", confirm: "Aprobă", reason: false, text: "Versiunea trimisă devine publică. Influencerul primește email și notificare." },
  "request-changes": { label: "Cere modificări", title: "Ceri modificări?", confirm: "Trimite cererea", reason: true, text: "Mesajul tău ajunge la influencer (email + notificare). Dacă profilul era publicat, versiunea publică rămâne." },
  reject: { label: "Respinge", title: "Respingi profilul?", confirm: "Respinge", reason: true, danger: true, text: "Profilul nu va putea fi retrimis. Motivul ajunge la influencer." },
  suspend: { label: "Suspendă", title: "Suspenzi profilul?", confirm: "Suspendă", reason: true, danger: true, text: "Profilul dispare imediat din public. Motivul ajunge la influencer." },
  unsuspend: { label: "Reactivează", title: "Reactivezi profilul?", confirm: "Reactivează", reason: false, text: "Profilul redevine vizibil (dacă are o versiune aprobată și nu e pe pauză)." },
};

const ACTION_ALLOWED = {
  approve: "canApprove",
  "request-changes": "canRequestChanges",
  reject: "canReject",
  suspend: "canSuspend",
  unsuspend: "canUnsuspend",
};

const formatDate = (value) => (value ? new Date(value).toLocaleString("ro-RO", { timeZone: "Europe/Bucharest" }) : "—");

function ProfileDetail({ id, options, onChanged, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(null); // { action, offerId? }
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setError("");
    api(`${CREATORS_ADMIN_API}/profiles/${encodeURIComponent(id)}`)
      .then(setData)
      .catch((e) => setError(friendlyError(e, "Nu am putut încărca profilul.")));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function run() {
    setBusy(true);
    setError("");
    try {
      const url = pending.offerId
        ? `${CREATORS_ADMIN_API}/profiles/${encodeURIComponent(id)}/offers/${encodeURIComponent(pending.offerId)}/deactivate`
        : `${CREATORS_ADMIN_API}/profiles/${encodeURIComponent(id)}/${pending.action}`;
      const res = await api(url, { method: "POST", body: { reason: reason.trim() || null } });
      setData(res);
      setPending(null);
      setReason("");
      onChanged();
    } catch (e) {
      // mesajul exact al câmpului (ex. „Scrie motivul…”), nu doar „Verifică datele completate.”
      setError(e?.data?.fields?.reason || friendlyError(e, "Acțiunea nu a reușit."));
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return error ? <p className={styles.alert}>{error}</p> : <SkeletonBlock height={240} />;
  }

  const { profile, account, offers, events, actions } = data;
  const action = pending ? (pending.offerId ? { title: "Dezactivezi oferta?", confirm: "Dezactivează", reason: true, danger: true, text: "Influencerul nu o va putea reactiva." } : ACTIONS[pending.action]) : null;
  const toPreview = (snapshot) => (snapshot ? { ...snapshot, acceptsProducts: profile.acceptsProducts, acceptsPaid: profile.acceptsPaid, typicalTurnaroundDays: profile.typicalTurnaroundDays } : null);

  return (
    <section className={styles.card} aria-labelledby="creator-detail-title">
      <div className={styles.cardHead}>
        <div>
          <h3 id="creator-detail-title" className={styles.cardTitle}>
            {profile.displayName || "Fără nume"}
          </h3>
          <p className={cx(styles.muted, styles.small)} style={{ margin: "4px 0 0" }}>
            {account.name} · {account.email} · influencer din {formatDate(account.influencerSince)} · cont {account.influencerStatus === "ACTIVE" ? "activ" : "inactiv"}
          </p>
        </div>
        <button type="button" className={styles.btnGhost} onClick={onClose}>
          Închide
        </button>
      </div>

      <div className={styles.actions} style={{ marginBottom: 12 }}>
        <span className={cx(styles.badge, styles[`tone_${STATUS_TONE[profile.status] || "muted"}`])}>{STATUS_LABEL[profile.status] || profile.status}</span>
        {profile.suspended && <span className={cx(styles.badge, styles.tone_danger)}>Suspendat</span>}
        {profile.paused && <span className={cx(styles.badge, styles.tone_muted)}>Pe pauză</span>}
        {profile.hasPublishedVersion && <span className={cx(styles.badge, styles.tone_success)}>Are versiune publicată</span>}
        {profile.visibility.visible && <span className={cx(styles.badge, styles.tone_info)}>Vizibil public</span>}
      </div>

      {profile.moderationMessage && (
        <p className={styles.message}>
          <strong>Ultimul mesaj către influencer:</strong> {profile.moderationMessage}
        </p>
      )}
      {profile.suspendedReason && (
        <p className={styles.message}>
          <strong>Motivul suspendării:</strong> {profile.suspendedReason}
        </p>
      )}
      {error && (
        <p className={styles.alert} role="alert">
          {error}
        </p>
      )}

      <div className={styles.actions} style={{ margin: "12px 0 16px" }}>
        {Object.entries(ACTIONS)
          .filter(([key]) => actions[ACTION_ALLOWED[key]])
          .map(([key, a]) => (
            <button key={key} type="button" className={a.danger ? styles.btnDanger : key === "approve" ? styles.btnPrimary : styles.btn} onClick={() => { setReason(""); setPending({ action: key }); }}>
              {a.label}
            </button>
          ))}
      </div>

      <div className={cx(styles.grid, styles.grid2)}>
        <div>
          <h4 className={styles.label}>Versiunea trimisă (de verificat)</h4>
          <CreatorProfilePreview profile={toPreview(profile.submittedSnapshot)} options={options} />
          {profile.socials.length > 0 && (
            <ul className={styles.small} style={{ paddingLeft: 18 }}>
              {profile.socials.map((s) => (
                <li key={s.platform}>
                  <a href={s.url} target="_blank" rel="noopener noreferrer nofollow">
                    {labelOf(options?.platforms, s.platform)}: @{s.handle}
                  </a>{" "}
                  · {s.followersDeclared} urmăritori declarați
                </li>
              ))}
            </ul>
          )}
          {profile.portfolio.length > 0 && (
            <div className={styles.portfolioGrid}>
              {profile.portfolio.map((item) => (
                <div key={item.id} className={styles.portfolioItem}>
                  {item.kind === "IMAGE" ? (
                    <img src={item.imageUrl} alt={item.title} loading="lazy" />
                  ) : (
                    <a className={styles.portfolioLink} href={item.linkUrl} target="_blank" rel="noopener noreferrer nofollow">
                      {item.linkUrl}
                    </a>
                  )}
                  <div className={styles.portfolioCaption}>{item.title}</div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div>
          <h4 className={styles.label}>Ce vede publicul acum</h4>
          {profile.approvedSnapshot ? (
            <CreatorProfilePreview profile={toPreview(profile.approvedSnapshot)} options={options} />
          ) : (
            <p className={cx(styles.muted, styles.small)}>Nicio versiune publicată încă.</p>
          )}
        </div>
      </div>

      <h4 className={styles.label} style={{ marginTop: 18 }}>
        Oferte ({offers.length})
      </h4>
      {offers.length === 0 ? (
        <p className={cx(styles.muted, styles.small)}>Fără oferte.</p>
      ) : (
        <div className={styles.grid}>
          {offers.map((o) => (
            <div key={o.id} className={cx(styles.offerCard, !o.isActive && styles.offerInactive)}>
              <strong>
                {o.title} <span className={cx(styles.muted, styles.small)}>v{o.version}</span>
              </strong>
              <span className={styles.small}>
                {labelOf(options?.offerTypes, o.type)} · {labelOf(options?.platforms, o.platform)} · {o.deliverables.map((d) => `${d.count} × ${labelOf(options?.contentTypes, d.type)}`).join(", ")}
                {o.creatorFeeCents != null ? ` · ${formatLei(o.creatorFeeCents)} (remunerația dorită)` : ""}
              </span>
              {o.description && <span className={cx(styles.small, styles.muted)}>{o.description}</span>}
              {o.disabledByAdmin ? (
                <span className={cx(styles.badge, styles.tone_danger)} style={{ justifySelf: "start" }}>
                  Dezactivată de Admin
                </span>
              ) : (
                <div>
                  <button type="button" className={styles.btnDanger} onClick={() => { setReason(""); setPending({ action: "offer", offerId: o.id }); }}>
                    Dezactivează oferta
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <h4 className={styles.label} style={{ marginTop: 18 }}>
        Istoric
      </h4>
      <ol className={styles.small} style={{ paddingLeft: 18, lineHeight: 1.7 }}>
        {events.map((e) => (
          <li key={e.id}>
            <strong>{EVENT_LABEL[e.type] || e.type}</strong> · {formatDate(e.createdAt)} · {e.actorRole === "ADMIN" ? "Admin" : "influencer"}
            {EMAIL_LABEL[e.emailStatus] ? ` · ${EMAIL_LABEL[e.emailStatus]}` : ""}
            {e.reason && <div className={styles.muted}>Motiv: {e.reason}</div>}
          </li>
        ))}
      </ol>

      {action && (
        <ConfirmDialog
          title={action.title}
          confirmLabel={action.confirm}
          onConfirm={run}
          onCancel={() => { setPending(null); setError(""); }}
          busy={busy}
          danger={action.danger}
          confirmDisabled={action.reason && reason.trim().length < 3}
        >
          <p style={{ marginTop: 0 }}>{action.text}</p>
          {action.reason && (
            <label className={styles.field}>
              <span className={styles.label}>Motiv (obligatoriu, minimum 3 caractere, vizibil pentru influencer)</span>
              <textarea className={styles.textarea} value={reason} maxLength={2000} onChange={(e) => setReason(e.target.value)} />
            </label>
          )}
          {error && <p className={styles.fieldError}>{error}</p>}
        </ConfirmDialog>
      )}
    </section>
  );
}

export default function AdminCreatorsTab() {
  const [params, setParams] = useSearchParams();
  const selected = params.get("profile");
  const [status, setStatus] = useState("PENDING");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [options, setOptions] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    const qs = new URLSearchParams({ page: String(page) });
    if (status) qs.set("status", status);
    if (q.trim()) qs.set("q", q.trim());
    setError("");
    api(`${CREATORS_ADMIN_API}/profiles?${qs}`)
      .then(setData)
      .catch((e) => setError(friendlyError(e, "Nu am putut încărca profilurile Creators.")));
  }, [status, q, page]);

  useEffect(() => {
    const timer = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, q]);

  /*
   * Lista se încărca o singură dată: un profil trimis cât tabul era deschis nu apărea
   * până la reîncărcarea paginii. Acum se actualizează la revenirea în pagină, periodic
   * (doar cât pagina e vizibilă) și la deschiderea unui profil (ex. din notificare).
   */
  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    window.addEventListener("focus", refreshIfVisible);
    document.addEventListener("visibilitychange", refreshIfVisible);
    const timer = setInterval(refreshIfVisible, LIST_REFRESH_MS);
    return () => {
      window.removeEventListener("focus", refreshIfVisible);
      document.removeEventListener("visibilitychange", refreshIfVisible);
      clearInterval(timer);
    };
  }, [load]);

  useEffect(() => {
    if (selected) load();
    // doar la schimbarea profilului deschis
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  useEffect(() => {
    api(`${CREATORS_ADMIN_API}/options`).then(setOptions).catch(() => null);
  }, []);

  const select = (id) => {
    const next = new URLSearchParams(params);
    if (id) next.set("profile", id);
    else next.delete("profile");
    setParams(next, { replace: true });
  };

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className={styles.cardHead} style={{ flexWrap: "wrap" }}>
        <div>
          <h2 className={styles.cardTitle}>Artfest Creators{data?.pendingCount ? ` · ${data.pendingCount} în verificare` : ""}</h2>
          <p className={cx(styles.muted, styles.small)} style={{ margin: "4px 0 0" }}>
            Moderarea profilurilor profesionale. Aprobarea nu schimbă nimic în programul de afiliere.
          </p>
        </div>
        <div className={styles.actions}>
          <select className={styles.select} style={{ width: "auto" }} value={status} onChange={(e) => { setPage(1); setStatus(e.target.value); }} aria-label="Filtru status">
            {STATUS_FILTERS.map((s) => (
              <option key={s.value || "all"} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <input className={styles.input} style={{ width: 220 }} placeholder="Caută după nume sau adresă" value={q} onChange={(e) => { setPage(1); setQ(e.target.value); }} aria-label="Caută" />
          <button type="button" className={styles.btn} onClick={load} data-creators-refresh>
            Reîmprospătează
          </button>
        </div>
      </div>

      {error && <p className={styles.alert}>{error}</p>}

      {selected && <ProfileDetail key={selected} id={selected} options={options} onChanged={load} onClose={() => select(null)} />}

      {!data ? (
        <SkeletonBlock height={160} />
      ) : data.items.length === 0 ? (
        <p className={cx(styles.card, styles.empty)}>Niciun profil în această listă.</p>
      ) : (
        <div className={styles.grid}>
          {data.items.map((p) => (
            <button key={p.id} type="button" className={cx(styles.choice, selected === p.id && styles.choiceActive)} onClick={() => select(p.id)} style={{ gridTemplateColumns: "48px 1fr auto", alignItems: "center", display: "grid", gap: 12 }}>
              {p.avatarUrl ? <img src={p.avatarUrl} alt="" width={48} height={48} style={{ borderRadius: "50%", objectFit: "cover" }} /> : <span className={cx(styles.avatar, styles.avatarPlaceholder)} style={{ width: 48, height: 48 }} />}
              <span style={{ display: "grid", gap: 2 }}>
                <strong>{p.displayName || "Fără nume"}</strong>
                <span>
                  /creatori/{p.slug} · actualizat {formatDate(p.updatedAt)}
                  {p.hasPublishedVersion && p.status === "PENDING" ? " · modificări la un profil publicat" : ""}
                </span>
              </span>
              <span className={cx(styles.badge, styles[`tone_${p.suspended ? "danger" : STATUS_TONE[p.status] || "muted"}`])}>{p.suspended ? "Suspendat" : STATUS_LABEL[p.status] || p.status}</span>
            </button>
          ))}
        </div>
      )}

      {pages > 1 && (
        <div className={styles.actions} style={{ justifyContent: "center" }}>
          <button type="button" className={styles.btn} disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Înapoi
          </button>
          <span className={styles.small}>
            Pagina {page} din {pages}
          </span>
          <button type="button" className={styles.btn} disabled={page >= pages} onClick={() => setPage(page + 1)}>
            Înainte
          </button>
        </div>
      )}
    </div>
  );
}
