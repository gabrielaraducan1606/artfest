// /cereri/acces#t=... - cererile unui vizitator fără cont (link din email:
// „ofertă nouă” sau „link nou”). Fără token: sesiunea existentă pe acest
// dispozitiv sau formularul „Trimite-mi linkul”.

import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import styles from "./GuestRequestPages.module.css";
import { consumeHashToken, guestApi, isValidEmail } from "./guestRequest.js";

const STATUS_LABELS = {
  OPEN: "Deschisă",
  ACCEPTED: "Acceptată",
  CLOSED: "Închisă",
  EXPIRED: "Expirată",
};

function offersLabel(count) {
  if (!count) return "Încă nicio ofertă";
  return count === 1 ? "1 ofertă" : `${count} oferte`;
}

export default function GuestRequestAccessPage() {
  const [token] = useState(() => consumeHashToken());
  const [state, setState] = useState({ status: "loading" });
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sentMessage, setSentMessage] = useState("");
  const [formError, setFormError] = useState("");

  useEffect(() => {
    let active = true;

    const load = token ? guestApi.access(token) : guestApi.me();

    load
      .then((result) => {
        if (active) setState({ status: "ready", guest: result?.guest, requests: result?.requests || [] });
      })
      .catch((err) => {
        if (!active) return;
        const code = err?.data?.error || err?.code;
        setState({
          status: "ask",
          notice: token && code === "link_invalid" ? "Linkul a expirat sau nu mai este valabil. Cere unul nou mai jos." : "",
        });
      });

    return () => {
      active = false;
    };
  }, [token]);

  async function handleSend(event) {
    event.preventDefault();
    setFormError("");
    if (!isValidEmail(email)) {
      setFormError("Scrie adresa de email folosită în cerere.");
      return;
    }
    try {
      setSending(true);
      const result = await guestApi.accessLink(email.trim());
      setSentMessage(result?.message || "Dacă există cereri confirmate pentru această adresă, îți trimitem un link.");
    } catch (err) {
      setFormError(err?.data?.message || err?.message || "Nu am putut trimite linkul. Încearcă din nou.");
    } finally {
      setSending(false);
    }
  }

  async function handleLogout() {
    try {
      await guestApi.logout();
    } finally {
      setState({ status: "ask", notice: "Ai ieșit de pe acest dispozitiv." });
    }
  }

  let content;

  if (state.status === "loading") {
    content = (
      <>
        <div className={styles.icon} aria-hidden="true">⏳</div>
        <h1 className={styles.title}>Deschidem cererile tale…</h1>
      </>
    );
  } else if (state.status === "ready") {
    content = (
      <>
        <h1 className={styles.title}>
          {state.guest?.displayName ? `Cererile tale, ${state.guest.displayName}` : "Cererile tale"}
        </h1>

        {state.requests.length === 0 ? (
          <p className={styles.text}>Nu ai cereri publicate cu această adresă.</p>
        ) : (
          <ul className={styles.list}>
            {state.requests.map((request) => (
              <li key={request.id}>
                <Link className={styles.item} to={`/cereri/${encodeURIComponent(request.id)}`}>
                  <span>
                    <span className={styles.itemTitle}>{request.title}</span>
                    <span className={styles.itemMeta}>
                      {STATUS_LABELS[request.status] || request.status} · {offersLabel(request.offersCount)}
                    </span>
                  </span>
                  {request.offersCount > 0 && <span className={styles.badge}>Vezi</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}

        <p className={styles.muted}>
          Pentru a discuta cu artizanii sau a comanda, <Link to="/inregistrare">creează un cont gratuit</Link> cu același
          email - cererile trec automat în cont.
        </p>

        <div className={styles.actions}>
          <Link className={styles.secondary} to="/cereri?action=create-customer-request&mode=manual">
            Trimite o cerere nouă
          </Link>
        </div>

        <button type="button" className={styles.linkButton} onClick={handleLogout}>
          Ieși de pe acest dispozitiv
        </button>
      </>
    );
  } else {
    content = (
      <>
        <div className={styles.icon} aria-hidden="true">✉️</div>
        <h1 className={styles.title}>Cererile tale de ofertă</h1>
        {state.notice && <div className={styles.error}>{state.notice}</div>}
        <p className={styles.text}>
          Scrie emailul folosit în cerere și îți trimitem un link securizat către cererile și ofertele tale.
        </p>

        {sentMessage ? (
          <p className={styles.text} role="status">{sentMessage}</p>
        ) : (
          <form className={styles.form} onSubmit={handleSend} noValidate>
            <label className={styles.label} htmlFor="guest-access-email">Email</label>
            <input
              id="guest-access-email"
              className={styles.input}
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="off"
              spellCheck={false}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="nume@exemplu.ro"
            />
            {formError && <div className={styles.error}>{formError}</div>}
            <div className={styles.actions}>
              <button type="submit" className={styles.primary} disabled={sending}>
                {sending ? "Se trimite…" : "Trimite-mi linkul"}
              </button>
            </div>
          </form>
        )}

        <p className={styles.muted}>
          Ai cont Artfest? <Link to="/autentificare?redirect=%2Fcereri">Autentifică-te</Link>.
        </p>
      </>
    );
  }

  return (
    <main className={styles.page}>
      <section className={styles.card} aria-live="polite">{content}</section>
    </main>
  );
}
