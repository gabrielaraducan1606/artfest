import { useState } from "react";
import { api } from "../../../lib/api";
import { LifeBuoy, Send, Loader2, Mail } from "lucide-react";
import styles from "../../SupportBase/Support.module.css";

const GUEST_SUPPORT_ENDPOINT = "/api/guest/support";

// 👉 emailul oficial al suportului
const SUPPORT_EMAIL = "support@artfest.ro";

export default function GuestSupportPage() {
  const [form, setForm] = useState({
    name: "",
    email: "",
    subject: "",
    message: "",
  });
  const [sending, setSending] = useState(false);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!form.email.trim() || !form.message.trim()) {
      setError("Te rugăm să completezi cel puțin emailul și mesajul.");
      return;
    }

    setSending(true);
    try {
      const payload = {
        name: form.name.trim(),
        email: form.email.trim(),
        subject:
          form.subject.trim() || "Mesaj din formularul de contact",
        message: form.message.trim(),
      };

      await api(GUEST_SUPPORT_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      setSuccess("Mesajul a fost trimis. Îți mulțumim!");
      setForm({
        name: "",
        email: "",
        subject: "",
        message: "",
      });
    } catch (e) {
      setError(
        e?.message ||
          "A apărut o eroare. Te rugăm să încerci din nou."
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.left}>
        {/* Formular de contact guest */}
        <div className={styles.card}>
          <div className={styles.headRow}>
            <div className={styles.head}>
              <LifeBuoy size={18} /> Contactează suportul
            </div>
          </div>

          <form className={styles.form} onSubmit={handleSubmit}>
            <label>
              Nume (opțional)
              <input
                className={styles.input}
                value={form.name}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    name: e.target.value,
                  }))
                }
                placeholder="Numele tău"
              />
            </label>

            <label>
              Email
              <input
                className={styles.input}
                type="email"
                required
                value={form.email}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    email: e.target.value,
                  }))
                }
                placeholder="exemplu@email.com"
              />
            </label>

            <label>
              Subiect (opțional)
              <input
                className={styles.input}
                value={form.subject}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    subject: e.target.value,
                  }))
                }
                placeholder="Despre ce este vorba?"
              />
            </label>

            <label>
              Mesaj
              <textarea
                className={styles.input}
                rows={4}
                required
                value={form.message}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    message: e.target.value,
                  }))
                }
                placeholder="Descrie pe scurt problema sau întrebarea ta…"
              />
            </label>

            {error && (
              <div className={styles.error}>{error}</div>
            )}
            {success && (
              <div className={styles.muted}>{success}</div>
            )}

            <button
              className={styles.primary}
              disabled={sending}
            >
              {sending ? (
                <Loader2
                  size={16}
                  className={styles.spin}
                />
              ) : (
                <Send size={16} />
              )}{" "}
              Trimite mesaj
            </button>

            <div className={styles.muted} style={{ marginTop: 8 }}>
              Dacă ai deja cont, îți recomandăm să te autentifici și
              să folosești pagina de suport din cont, ca să poți urmări
              statusul discuției.
            </div>

            {/* 🔥 Secțiune email suport */}
            <div
              className={styles.card}
              style={{ marginTop: 20, padding: 12 }}
            >
              <div className={styles.head} style={{ fontSize: 15 }}>
                <Mail size={16} /> Suport prin email
              </div>
              <div className={styles.muted} style={{ marginTop: 6 }}>
                Poți trimite un email direct la:
              </div>

              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                className={styles.primary}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  marginTop: 10,
                  fontSize: 14,
                }}
              >
                <Mail size={16} />
                {SUPPORT_EMAIL}
              </a>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
