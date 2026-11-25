// src/pages/Admin/AdminMarketing/AdminInfluencersHub.jsx
//
// Admin → Marketing → Influenceri: o singură secțiune, cu subtaburi (?sub=):
//   affiliate (implicit) - programul de afiliere existent (AdminInfluencersTab, neschimbat);
//   creators             - profilurile Artfest Creators: listă, statusuri, moderare
//                          (AdminCreatorsTab, reutilizat ca atare; oferte moderate din profil).
// Contorul „în verificare” = numărul real de profiluri PENDING (GET /api/admin/creators/
// pending-count), actualizat la evenimentul `artfest:creators-pending` (listă reîncărcată /
// decizie de moderare).

import { Suspense, lazy, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { api } from "../../../lib/api";
import styles from "./AdminMarketingPage.module.css";
import AdminInfluencersTab from "./AdminInfluencersTab.jsx";
import { CREATORS_PENDING_EVENT, refreshCreatorsPending } from "./creatorsPending.js";

const AdminCreatorsTab = lazy(() => import("./AdminCreatorsTab.jsx"));

const SUBTABS = [
  { id: "affiliate", label: "Program afiliere" },
  { id: "creators", label: "Profiluri Creators" },
];

function cx(...xs) {
  return xs.filter(Boolean).join(" ");
}

export default function AdminInfluencersHub() {
  const [params, setParams] = useSearchParams();
  const sub = SUBTABS.some((s) => s.id === params.get("sub")) ? params.get("sub") : "affiliate";
  const [pending, setPending] = useState(null);

  useEffect(() => {
    const onPending = (e) => {
      const n = Number(e?.detail?.pending);
      if (Number.isFinite(n)) setPending(n);
    };
    window.addEventListener(CREATORS_PENDING_EVENT, onPending);
    refreshCreatorsPending(api);
    return () => {
      window.removeEventListener(CREATORS_PENDING_EVENT, onPending);
    };
  }, []);

  const select = (id) => {
    const next = new URLSearchParams({ tab: "influencers" });
    if (id !== "affiliate") next.set("sub", id);
    setParams(next, { replace: true });
  };

  return (
    <div>
      <div className={styles.tabsRow} role="tablist" aria-label="Influenceri" style={{ marginTop: 0 }}>
        {SUBTABS.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={sub === s.id}
            className={cx(styles.tabBtn, sub === s.id && styles.tabBtnActive)}
            onClick={() => select(s.id)}
            data-influencers-sub={s.id}
          >
            {s.label}
            {s.id === "creators" && pending > 0 && (
              <span className={styles.tabCount} aria-label={`${pending} în verificare`} data-creators-pending-count>
                {pending > 99 ? "99+" : pending}
              </span>
            )}
          </button>
        ))}
      </div>

      {sub === "affiliate" && <AdminInfluencersTab />}
      {sub === "creators" && (
        <Suspense fallback={<p>Se încarcă…</p>}>
          <AdminCreatorsTab />
        </Suspense>
      )}
    </div>
  );
}
