import React, { useEffect, useState } from "react";
import styles from "./NewsletterModal.module.css";

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
    let timer = null;

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

            timer = setTimeout(() => {
              if (alive) setOpen(true);
            }, 900);

            return;
          }
        }

        setIsLoggedIn(false);

        if (!savedSubscribed && !savedSeen) {
          timer = setTimeout(() => {
            if (alive) setOpen(true);
          }, 900);
        }
      } catch (err) {
        console.warn("Newsletter status check failed:", err);

        const savedSubscribed = localStorage.getItem(SUBSCRIBED_KEY) === "1";
        const savedSeen = localStorage.getItem(SEEN_KEY) === "1";

        if (!savedSubscribed && !savedSeen) {
          timer = setTimeout(() => {
            if (alive) setOpen(true);
          }, 900);
        }
      }
    }

    initNewsletterModal();

    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
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