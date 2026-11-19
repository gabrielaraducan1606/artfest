// src/features/creators/CreatorsHomePage.jsx
//
// Artfest Creators - pagina principală a influencerului (/influencer/creatori):
// statusul profilului (setup / draft / în verificare / modificări / aprobat /
// respins / suspendat), cele 4 secțiuni (Profilul meu, Ofertele mele,
// Colaborările mele, Rezultatele mele), pauza temporară și turul ghidat.
// Separat de dashboardul de afiliere (/influencer).

import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, BarChart3, Handshake, Package, UserRound } from "lucide-react";

import { api } from "../../lib/api";
import { CREATORS_API, CREATOR_ROUTES, friendlyError, profileSectionView, shouldAutoStartOnboarding, statusView } from "./creatorsLogic.js";
import { ConfirmDialog, CreatorProfilePreview, SkeletonBlock } from "./creatorsShared.jsx";
import { cx, useCreatorState } from "./creatorsClient.js";
import CreatorTour from "./CreatorTour.jsx";
import styles from "./Creators.module.css";

export default function CreatorsHomePage() {
  const navigate = useNavigate();
  const { state, setState, options, error, loading } = useCreatorState();
  const [tourOpen, setTourOpen] = useState(false);
  const [highlight, setHighlight] = useState(null);
  const [actionError, setActionError] = useState("");
  const [confirmPause, setConfirmPause] = useState(false);
  const [busy, setBusy] = useState(false);
  const tourShown = useRef(false);

  const profile = state?.profile || null;

  // influencer nou (invitat după lansare) => direct în onboarding
  useEffect(() => {
    if (shouldAutoStartOnboarding(state)) navigate(CREATOR_ROUTES.onboarding, { replace: true });
  }, [state, navigate]);

  // turul apare o singură dată pe versiune, după finalizarea configurării inițiale
  useEffect(() => {
    if (!tourShown.current && profile?.tour?.shouldShow) {
      tourShown.current = true;
      setTourOpen(true);
    }
  }, [profile?.tour?.shouldShow]);

  const finishTour = useCallback(
    async (outcome) => {
      setTourOpen(false);
      setHighlight(null);
      if (!outcome || !profile) return;
      try {
        await api(`${CREATORS_API}/tour`, { method: "POST", body: { version: profile.tour.version } });
      } catch {
        // dacă salvarea eșuează, turul poate reapărea la următoarea vizită - nu blocăm nimic
      }
    },
    [profile]
  );

  async function togglePause(paused) {
    setBusy(true);
    setActionError("");
    try {
      setState(await api(`${CREATORS_API}/profile/pause`, { method: "POST", body: { paused } }));
      setConfirmPause(false);
    } catch (e) {
      setActionError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <main className={styles.page} aria-busy="true">
        <SkeletonBlock height={140} />
        <div style={{ height: 16 }} />
        <div className={styles.sections}>
          <SkeletonBlock height={120} />
          <SkeletonBlock height={120} />
        </div>
      </main>
    );
  }

  if (error || !state) {
    return (
      <main className={styles.page}>
        <p className={styles.alert} role="alert">
          {error || "Nu am putut încărca profilul Creators."}
        </p>
      </main>
    );
  }

  const view = statusView(state);
  const profileSection = profileSectionView(state);
  const approved = state.entry === "approved";
  const sectionClass = (target) => cx(styles.section, highlight === target && styles.sectionHighlighted);

  return (
    <main className={styles.page}>
      <div className={styles.topBar}>
        <Link to={CREATOR_ROUTES.dashboard} className={styles.backLink}>
          <ArrowLeft size={16} aria-hidden="true" /> Dashboard influencer
        </Link>
        {profile?.onboardingCompleted && !tourOpen && (
          <button type="button" className={styles.btnGhost} onClick={() => setTourOpen(true)}>
            Reia turul ghidat
          </button>
        )}
      </div>

      <p className={styles.eyebrow}>Artfest Creators</p>
      <h1 className={styles.title}>Profilul tău profesional de creator</h1>
      <p className={styles.lead}>Gratuit, permanent și separat de programul de afiliere. Magazinele Artfest te vor putea descoperi pentru colaborări.</p>

      <section className={styles.statusCard} style={{ marginTop: 16 }} aria-live="polite">
        <span className={cx(styles.badge, styles[`tone_${view.tone}`])}>{view.badge}</span>
        <h2 className={styles.cardTitle} style={{ marginTop: 10 }}>
          {view.title}
        </h2>
        {["changes_requested", "rejected"].includes(state.entry) || profile?.suspended ? (
          <p className={styles.message}>{view.text}</p>
        ) : (
          <p className={styles.lead}>{view.text}</p>
        )}
        <div className={styles.actions} style={{ marginTop: 14 }}>
          {view.cta && (
            <Link className={styles.btnPrimary} to={view.cta.to}>
              {view.cta.label}
            </Link>
          )}
          {approved && !profile?.suspended && (
            <button type="button" className={styles.btn} onClick={() => (profile.paused ? togglePause(false) : setConfirmPause(true))} disabled={busy}>
              {profile.paused ? "Reactivează profilul" : "Pune profilul pe pauză"}
            </button>
          )}
        </div>
        {actionError && (
          <p className={styles.alert} role="alert">
            {actionError}
          </p>
        )}
      </section>

      <div className={styles.sections}>
        <section className={sectionClass("creator-profile")} data-tour="creator-profile" aria-labelledby="sec-profile">
          <h2 id="sec-profile" className={styles.sectionTitle}>
            <UserRound size={18} aria-hidden="true" /> Profilul meu
          </h2>
          <p className={cx(styles.muted, styles.small)}>{profileSection.text}</p>
          {profileSection.cta && (
            <div className={styles.actions}>
              <Link className={styles.btn} to={profileSection.cta.to}>
                {profileSection.cta.label}
              </Link>
            </div>
          )}
        </section>

        <section className={sectionClass("creator-offers")} data-tour="creator-offers" aria-labelledby="sec-offers">
          <h2 id="sec-offers" className={styles.sectionTitle}>
            <Package size={18} aria-hidden="true" /> Ofertele mele
          </h2>
          <p className={cx(styles.muted, styles.small)}>
            {state.offersCount ? `${state.offersCount} ${state.offersCount === 1 ? "ofertă activă" : "oferte active"}.` : "Pachete de promovare: produse, promovare plătită sau ambele."}
          </p>
          {profile && state.entry !== "rejected" && !profile.suspended && (
            <Link className={styles.btn} to={CREATOR_ROUTES.offers}>
              {state.offersCount ? "Gestionează ofertele" : "Creează prima ofertă"}
            </Link>
          )}
        </section>

        <section className={sectionClass("creator-collabs")} data-tour="creator-collabs" aria-labelledby="sec-collabs">
          <h2 id="sec-collabs" className={styles.sectionTitle}>
            <Handshake size={18} aria-hidden="true" /> Colaborările mele
          </h2>
          <p className={cx(styles.muted, styles.small)}>Propunerile de la magazine vor apărea aici, după deschiderea catalogului Artfest Creators.</p>
        </section>

        <section className={sectionClass("creator-results")} data-tour="creator-results" aria-labelledby="sec-results">
          <h2 id="sec-results" className={styles.sectionTitle}>
            <BarChart3 size={18} aria-hidden="true" /> Rezultatele mele
          </h2>
          <p className={cx(styles.muted, styles.small)}>Colaborările finalizate și evaluările primite vor apărea aici. Nu afișăm statistici fără colaborări reale.</p>
        </section>
      </div>

      {profile && (
        <section className={styles.card} style={{ marginTop: 16 }} aria-labelledby="sec-preview">
          <h2 id="sec-preview" className={styles.cardTitle} style={{ marginBottom: 12 }}>
            Previzualizare
          </h2>
          <CreatorProfilePreview profile={profile} options={options} />
        </section>
      )}

      {tourOpen && <CreatorTour onFinish={finishTour} onStepChange={setHighlight} />}

      {confirmPause && (
        <ConfirmDialog title="Pui profilul pe pauză?" confirmLabel="Pune pe pauză" onConfirm={() => togglePause(true)} onCancel={() => setConfirmPause(false)} busy={busy}>
          Profilul nu va mai fi vizibil pentru magazine până îl reactivezi. Ofertele și datele tale rămân salvate.
        </ConfirmDialog>
      )}
    </main>
  );
}
