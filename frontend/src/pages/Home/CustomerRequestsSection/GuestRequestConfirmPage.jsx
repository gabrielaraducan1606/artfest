// /cereri/confirmare#t=... - linkul din emailul de confirmare al unei cereri
// trimise fără cont. Tokenul e scos imediat din bara de adrese; dacă emailul
// are deja cont, tokenul se păstrează în tab până după autentificare.

import React, { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { useAuth } from "../../Auth/Context/context.js";
import styles from "./GuestRequestPages.module.css";
import {
  CONFIRM_TOKEN_STORAGE_KEY,
  QR_REQUEST_PATH,
  consumeHashToken,
  guestApi,
} from "./guestRequest.js";

function readStoredToken() {
  try {
    return window.sessionStorage.getItem(CONFIRM_TOKEN_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function storeToken(token) {
  try {
    if (token) window.sessionStorage.setItem(CONFIRM_TOKEN_STORAGE_KEY, token);
    else window.sessionStorage.removeItem(CONFIRM_TOKEN_STORAGE_KEY);
  } catch {
    // indisponibil
  }
}

export default function GuestRequestConfirmPage() {
  const navigate = useNavigate();
  const { me, loading: authLoading } = useAuth();

  const [token] = useState(() => consumeHashToken() || readStoredToken());
  const [state, setState] = useState({ status: token ? "loading" : "missing" });
  const attemptedFor = useRef(null);

  useEffect(() => {
    if (!token || authLoading) return;

    // o încercare per stare de autentificare (din nou după login)
    const key = me?.id || me?.sub || "guest";
    if (attemptedFor.current === key) return;
    attemptedFor.current = key;

    let active = true;
    setState({ status: "loading" });

    guestApi
      .confirm(token)
      .then((result) => {
        if (!active) return;
        storeToken("");
        setState({ status: "done", result });
      })
      .catch((err) => {
        if (!active) return;
        const code = err?.data?.error || err?.code;
        // linkul rămâne în tab pentru login / reîncercare; doar cel invalid se șterge
        storeToken(code === "link_invalid" ? "" : token);
        setState({ status: "error", code, message: err?.data?.message || err?.message || "" });
      });

    return () => {
      active = false;
    };
  }, [token, authLoading, me]);

  function goToLogin() {
    storeToken(token);
    navigate(`/cereri/confirmare?auth=login&redirect=${encodeURIComponent("/cereri/confirmare")}`);
  }

  let content;

  if (state.status === "loading") {
    content = (
      <>
        <div className={styles.icon} aria-hidden="true">⏳</div>
        <h1 className={styles.title}>Publicăm cererea…</h1>
        <p className={styles.muted}>Durează doar câteva secunde.</p>
      </>
    );
  } else if (state.status === "missing") {
    content = (
      <>
        <div className={styles.icon} aria-hidden="true">🔗</div>
        <h1 className={styles.title}>Linkul nu este complet</h1>
        <p className={styles.text}>Deschide linkul direct din emailul primit (fără să-l copiezi parțial).</p>
        <div className={styles.actions}>
          <Link className={styles.secondary} to="/cereri/acces">Cere un link nou</Link>
        </div>
      </>
    );
  } else if (state.status === "done") {
    const { outcome, requestId, wantsAccount, email } = state.result || {};
    const requestUrl = `/cereri/${encodeURIComponent(requestId)}`;
    const isGuest = outcome === "published_guest" || (outcome === "already_published" && !me);
    const registerUrl = `/inregistrare?${new URLSearchParams({
      ...(email ? { email } : {}),
      redirect: requestUrl,
    }).toString()}`;

    content = (
      <>
        <div className={styles.icon} aria-hidden="true">🎉</div>
        <h1 className={styles.title}>
          {outcome === "already_published" ? "Cererea este deja publicată" : "Cererea ta a fost publicată"}
        </h1>
        <p className={styles.text}>
          {outcome === "published_account"
            ? "Am publicat-o în contul tău. Ofertele le vezi în pagina cererii și primești notificări în cont."
            : "Artizanii potriviți o pot vedea acum. Când primești o ofertă, îți trimitem un email cu link către ea."}
        </p>

        {isGuest && (
          <p className={styles.muted}>
            Poți adăuga fotografii din pagina cererii. Pe acest dispozitiv rămâi conectat la cererile tale 30 de zile;
            pe alt dispozitiv folosește linkul din email.
          </p>
        )}

        <div className={styles.actions}>
          {isGuest && wantsAccount ? (
            <>
              <Link className={styles.primary} to={registerUrl}>Creează contul</Link>
              <Link className={styles.secondary} to={requestUrl}>Vezi cererea</Link>
            </>
          ) : (
            <Link className={styles.primary} to={requestUrl}>Vezi cererea</Link>
          )}
        </div>

        {isGuest && !wantsAccount && (
          <p className={styles.muted}>
            Vrei să discuți cu artizanii sau să comanzi direct? <Link to={registerUrl}>Creează un cont gratuit</Link> cu
            același email - cererea trece automat în cont.
          </p>
        )}
      </>
    );
  } else if (state.code === "login_required") {
    content = (
      <>
        <div className={styles.icon} aria-hidden="true">👋</div>
        <h1 className={styles.title}>Ai deja un cont Artfest</h1>
        <p className={styles.text}>
          Autentifică-te cu adresa folosită în cerere și o publicăm imediat în contul tău. Datele cererii sunt păstrate.
        </p>
        <div className={styles.actions}>
          <button type="button" className={styles.primary} onClick={goToLogin}>Autentifică-te</button>
        </div>
      </>
    );
  } else if (state.code === "account_mismatch") {
    content = (
      <>
        <div className={styles.icon} aria-hidden="true">🔒</div>
        <h1 className={styles.title}>Ești în alt cont</h1>
        <p className={styles.text}>{state.message}</p>
        <p className={styles.muted}>După ce ieși din cont, deschide din nou linkul din email.</p>
      </>
    );
  } else if (state.code === "link_invalid") {
    content = (
      <>
        <div className={styles.icon} aria-hidden="true">⌛</div>
        <h1 className={styles.title}>Linkul nu mai este valabil</h1>
        <p className={styles.text}>
          Linkurile de confirmare sunt valabile 48 de ore. Poți trimite cererea din nou sau, dacă ai confirmat-o deja,
          poți cere un link nou către cererile tale.
        </p>
        <div className={styles.actions}>
          <Link className={styles.primary} to={QR_REQUEST_PATH.replace("&src=flyer", "")}>Trimite din nou cererea</Link>
          <Link className={styles.secondary} to="/cereri/acces">Cere link nou</Link>
        </div>
      </>
    );
  } else {
    content = (
      <>
        <div className={styles.icon} aria-hidden="true">⚠️</div>
        <h1 className={styles.title}>Nu am putut publica cererea</h1>
        <div className={styles.error}>{state.message || "A apărut o eroare. Încearcă din nou."}</div>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.primary}
            onClick={() => {
              attemptedFor.current = null;
              setState({ status: "loading" });
              window.location.reload();
            }}
          >
            Încearcă din nou
          </button>
        </div>
      </>
    );
  }

  return (
    <main className={styles.page}>
      <section className={styles.card} aria-live="polite">{content}</section>
    </main>
  );
}
