// src/features/creators/CreatorsEntryCard.jsx
//
// Intrarea în Artfest Creators din dashboardul influencerului (/influencer),
// încărcată lazy, permanent. Singura modificare din
// dashboardul de afiliere este montarea acestui card.
//
//   - influencer nou (invitat după lansare), fără profil -> redirect în onboarding;
//   - influencer existent fără profil -> invitație clară de configurare;
//   - draft -> „Continuă configurarea”; în verificare -> status; aprobat -> acces.
// Orice eroare la încărcarea stării => cardul nu apare (nu afectează dashboardul).

import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Sparkles } from "lucide-react";

import { api } from "../../lib/api";
import { pickPendingScope, scopeOrderForRole } from "../../lib/policyRequired.js";
import { CREATORS_API, CREATOR_ROUTES, shouldAutoStartOnboarding, statusView } from "./creatorsLogic.js";
import { cx } from "./creatorsClient.js";
import styles from "./Creators.module.css";

// holdRedirect: dashboardul arată o fereastră obligatorie (acord de influencer /
// documente de acceptat) => nu redirecționăm peste ea; cardul rămâne vizibil
export default function CreatorsEntryCard({ holdRedirect = false }) {
  const navigate = useNavigate();
  const [state, setState] = useState(null);

  // documente obligatorii în așteptare (aceeași verificare ca fereastra din dashboard,
  // care se deschide asincron) - până nu știm sigur că nu există, NU redirecționăm
  const [policyPending, setPolicyPending] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api(`${CREATORS_API}/state`)
      .then((next) => {
        if (cancelled) return;
        setState(next);
        if (!shouldAutoStartOnboarding(next)) return;
        const order = scopeOrderForRole("INFLUENCER");
        Promise.all(order.map((scope) => api(`/api/policy-gate?scope=${encodeURIComponent(scope)}`).catch(() => null)))
          .then((responses) => {
            if (cancelled) return;
            const gates = Object.fromEntries(order.map((scope, i) => [scope, responses[i]]));
            // eroare la verificare => tratăm ca „în așteptare” (fail-safe: rămâne cardul, fără redirect)
            setPolicyPending(responses.some((r) => r === null) || Boolean(pickPendingScope(order, gates)));
          });
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (holdRedirect || policyPending !== false) return;
    if (shouldAutoStartOnboarding(state)) navigate(CREATOR_ROUTES.onboarding, { replace: true });
  }, [state, holdRedirect, policyPending, navigate]);

  if (!state) return null;
  const view = statusView(state);
  const cta = view.cta || { label: "Deschide Artfest Creators", to: CREATOR_ROUTES.home };

  return (
    <section className={styles.entryCard} aria-labelledby="creators-entry-title">
      <div className={styles.entryText}>
        <span className={cx(styles.badge, styles[`tone_${view.tone}`])} style={{ justifySelf: "start" }}>
          <Sparkles size={14} aria-hidden="true" /> Artfest Creators · {view.badge}
        </span>
        <strong id="creators-entry-title">{view.title}</strong>
        <span className={cx(styles.muted, styles.small)}>{state.entry === "setup" ? "Gratuit, separat de programul de afiliere. Magazinele Artfest te vor putea contacta pentru colaborări." : view.text}</span>
      </div>
      <div className={styles.actions}>
        <Link className={styles.btnPrimary} to={cta.to}>
          {cta.label}
        </Link>
        {cta.to !== CREATOR_ROUTES.home && (
          <Link className={styles.btnGhost} to={CREATOR_ROUTES.home}>
            Detalii
          </Link>
        )}
      </div>
    </section>
  );
}
