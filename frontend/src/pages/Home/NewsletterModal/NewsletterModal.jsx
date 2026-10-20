import React, { useEffect, useState } from "react";
import styles from "./NewsletterModal.module.css";
import { hasAnyDecision } from "../../../lib/cookieConsent.js";
import {
  getScrollRatio,
  isAnyDialogVisible,
  shouldOpenNewsletter,
} from "./newsletterTrigger.js";

const SEEN_KEY = "artfest_newsletter_modal_seen";
const SUBSCRIBED_KEY = "artfest_newsletter_subscribed";

function getApiBase() {
  return (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");
}

function buildApiUrl(path) {
  const apiBase = getApiBase();
  return apiBase ? `${apiBase}${path}` : path;
}

export default function NewsletterModal() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [status, setStatus] = useState("idle");

  useEffect(() => {
    let alive = true;
    let stopTrigger = null;

    /*
     * Popup-ul NU mai apare la intrare (era la 0,9 s, peste primul
     * ecran): așteptăm ca vizitatorul să fi explorat pagina - timp minim
     * + scroll, după bannerul de cookie-uri, fără alt dialog deschis.
     * Vezi newsletterTrigger.js.
     */
    function armEngagementTrigger() {
      const startedAt = Date.now();

      const check = () => {
        if (!alive) return;

        const shouldOpen = shouldOpenNewsletter({
          elapsedMs: Date.now() - startedAt,
          scrollRatio: getScrollRatio({
            scrollY: window.scrollY,
            innerHeight: window.innerHeight,
            scrollHeight: document.documentElement.scrollHeight,
          }),
          consentDecided: hasAnyDecision(),
          otherDialogOpen: isAnyDialogVisible(document),
        });

        if (shouldOpen) {
          stop();
          setOpen(true);
        }
      };

      const intervalId = window.setInterval(check, 1000);
      window.addEventListener("scroll", check, { passive: true });

      function stop() {
        window.clearInterval(intervalId);
        window.removeEventListener("scroll", check);
      }

      stopTrigger = stop;
    }

    async function initNewsletterModal() {
      try {
        const savedSubscribed = localStorage.getItem(SUBSCRIBED_KEY) === "1";
        const savedSeen = localStorage.getItem(SEEN_KEY) === "1";

        const res = await fetch(buildApiUrl("/api/newsletter/me/status"), {
          method: "GET",
          credentials: "include",
          headers: {
            Accept: "application/json",
          },
        });

        if (!alive) return;

        if (res.ok) {
          const data = await res.json().catch(() => null);

          if (data?.ok && data.loggedIn) {
            setIsLoggedIn(true);

            if (data.email) {
              setEmail(data.email);
            }

            if (data.subscribed) {
              localStorage.setItem(SUBSCRIBED_KEY, "1");
              localStorage.setItem(SEEN_KEY, "1");
              return;
            }

            // ca la vizitatori: o singură dată, nu la fiecare vizită
            if (!savedSeen) {
              armEngagementTrigger();
            }

            return;
          }
        }

        setIsLoggedIn(false);

        if (!savedSubscribed && !savedSeen) {
          armEngagementTrigger();
        }
      } catch (err) {
        console.warn("Newsletter status check failed:", err);

        const savedSubscribed = localStorage.getItem(SUBSCRIBED_KEY) === "1";
        const savedSeen = localStorage.getItem(SEEN_KEY) === "1";

        if (!savedSubscribed && !savedSeen) {
          armEngagementTrigger();
        }
      }
    }

    initNewsletterModal();

    return () => {
      alive = false;
      stopTrigger?.();
    };
  }, []);

  const closeModal = () => {
    localStorage.setItem(SEEN_KEY, "1");
    setOpen(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) return;

    setStatus("loading");

    try {
      const res = await fetch(buildApiUrl("/api/newsletter/subscribe"), {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: normalizedEmail,
          source: "HOME_MODAL",
          sourceLabel: isLoggedIn
            ? "Home newsletter modal - logged in user"
            : "Home newsletter modal - guest",
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "newsletter_subscribe_failed");
      }

      localStorage.setItem(SUBSCRIBED_KEY, "1");
      localStorage.setItem(SEEN_KEY, "1");

      setStatus("success");

      setTimeout(() => {
        setOpen(false);
      }, 900);
    } catch (err) {
      console.error("Newsletter modal subscribe failed:", err);
      setStatus("error");
    }
  };

  if (!open) return null;

  return (
    <div className={styles.backdrop} role="presentation">
      <section
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="newsletter-modal-title"
      >
        <button
          type="button"
          className={styles.close}
          onClick={closeModal}
          aria-label="Închide"
        >
          ×
        </button>

        <p className={styles.badge}>Artfest Newsletter</p>

        <h2 id="newsletter-modal-title" className={styles.title}>
          Primește idei pentru evenimente direct în inbox
        </h2>

        <p className={styles.text}>
          Inspirație, trenduri și oferte de la artizani. Fără spam.
        </p>

        <form className={styles.form} onSubmit={handleSubmit}>
          <input
            type="email"
            required
            className={styles.input}
            placeholder="email@exemplu.ro"
            value={email}
            readOnly={isLoggedIn}
            onChange={(e) => {
              if (isLoggedIn) return;
              setEmail(e.target.value);
              if (status !== "idle") setStatus("idle");
            }}
            aria-label="Adresa de email pentru newsletter"
          />

          <button
            type="submit"
            className={styles.submit}
            disabled={status === "loading"}
          >
            {status === "loading"
              ? "Se trimite..."
              : status === "success"
              ? "✔ Abonat"
              : "Mă abonez"}
          </button>
        </form>

        {status === "error" && (
          <p className={styles.error}>
            Nu am putut salva abonarea. Încearcă din nou.
          </p>
        )}

        <button type="button" className={styles.later} onClick={closeModal}>
          Poate mai târziu
        </button>
      </section>
    </div>
  );
}