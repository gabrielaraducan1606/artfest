import React, { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AiOutlineEye, AiOutlineEyeInvisible } from "react-icons/ai";
import Navbar from "../../components/HomePage/Navbar/Navbar";
import Footer from "../../components/HomePage/Footer/Footer";
import api from "../../components/services/api";
import { useAppContext } from "../../components/Context/useAppContext";
import styles from "./RegisterForm.module.css";

export default function RegisterForm() {
  const { setToken } = useAppContext();
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSeller, setIsSeller] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);

  const [capsLock, setCapsLock] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [alertMsg, setAlertMsg] = useState("");
  const [alertType, setAlertType] = useState("error");

  const firstInvalidRef = useRef(null);

  const handleCapsLock = (e) => {
    const caps = e.getModifierState && e.getModifierState("CapsLock");
    setCapsLock(caps);
  };

  const validate = () => {
    if (!name.trim()) {
      setAlertType("error");
      setAlertMsg("Introdu numele complet.");
      firstInvalidRef.current = "name";
      return false;
    }
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      setAlertType("error");
      setAlertMsg("Adresa de email nu este validă.");
      firstInvalidRef.current = "email";
      return false;
    }
    if (password.length < 6) {
      setAlertType("error");
      setAlertMsg("Parola trebuie să aibă cel puțin 6 caractere.");
      firstInvalidRef.current = "password";
      return false;
    }
    if (password !== confirmPassword) {
      setAlertType("error");
      setAlertMsg("Parolele nu coincid.");
      firstInvalidRef.current = "confirmPassword";
      return false;
    }
    if (!acceptTerms) {
      setAlertType("error");
      setAlertMsg("Trebuie să accepți Termenii și Politica GDPR.");
      firstInvalidRef.current = null;
      return false;
    }
    setAlertMsg("");
    return true;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) {
      if (firstInvalidRef.current === "name") document.getElementById("reg-name")?.focus();
      else if (firstInvalidRef.current === "email") document.getElementById("reg-email")?.focus();
      else if (firstInvalidRef.current === "password") document.getElementById("reg-password")?.focus();
      else if (firstInvalidRef.current === "confirmPassword") document.getElementById("reg-confirm-password")?.focus();
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.post("/users/register", {
        name,
        email,
        password,
        role: isSeller ? "seller" : "user",
      });

      setToken(res.data.token, true);
setAlertType("success");
setAlertMsg("Cont creat cu succes. Redirecționare…");

      setTimeout(() => {
  if (isSeller) {
    navigate("/vanzator/informatii", { replace: true });
  } else {
    navigate("/profil", { replace: true });
  }
}, 900);
    } catch (err) {
      setAlertType("error");
      setAlertMsg(err?.response?.data?.msg || "Eroare la înregistrare.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Navbar />
      <main className={styles.page}>
        <section className={styles.wrap}>
          <form onSubmit={handleSubmit} className={styles.card} noValidate>
            <h2 className={styles.title}>Creare cont nou</h2>

            {alertMsg && (
              <div
                className={`${styles.alert} ${alertType === "success" ? styles.alertSuccess : styles.alertError}`}
                role="alert"
              >
                {alertMsg}
              </div>
            )}

            <label className={styles.label}>
              <span className={styles.labelText}>Nume complet</span>
              <input
                id="reg-name"
                type="text"
                className={styles.input}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nume și prenume"
                autoComplete="name"
                required
              />
            </label>

            <label className={styles.label}>
              <span className={styles.labelText}>Email</span>
              <input
                id="reg-email"
                type="email"
                className={styles.input}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@exemplu.ro"
                autoComplete="email"
                required
              />
            </label>

            <label className={styles.label}>
              <span className={styles.labelText}>Parolă</span>
              <div className={styles.inputGroup}>
                <input
                  id="reg-password"
                  type={showPw ? "text" : "password"}
                  className={styles.input}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyUp={handleCapsLock}
                  onKeyDown={handleCapsLock}
                  placeholder="••••••••"
                  autoComplete="new-password"
                  required
                />
                <button
                  type="button"
                  className={styles.togglePw}
                  onClick={() => setShowPw((prev) => !prev)}
                  aria-label={showPw ? "Ascunde parola" : "Afișează parola"}
                >
                </button>
              </div>
              {capsLock && <span className={styles.fieldError}>Atenție: Caps Lock este activ</span>}
            </label>

            <label className={styles.label}>
              <span className={styles.labelText}>Confirmă parola</span>
              <div className={styles.inputGroup}>
                <input
                  id="reg-confirm-password"
                  type={showConfirmPw ? "text" : "password"}
                  className={styles.input}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Reintrodu parola"
                  autoComplete="new-password"
                  required
                />
                <button
                  type="button"
                  className={styles.togglePw}
                  onClick={() => setShowConfirmPw((prev) => !prev)}
                  aria-label={showConfirmPw ? "Ascunde parola" : "Afișează parola"}
                >
                </button>
              </div>
            </label>

            <div className={styles.actions}>
              <label className={styles.checkbox}>
                <div className={styles.align}>
                <input
                  type="checkbox"
                  checked={isSeller}
                  onChange={(e) => setIsSeller(e.target.checked)}
                />
                Vreau să vând produse pe platformă</div>
              </label>
            </div>

            <div className={styles.actions}>
              <label className={styles.checkbox}>
                <div className={styles.align}>
                <input
                  type="checkbox"
                  checked={acceptTerms}
                  onChange={(e) => setAcceptTerms(e.target.checked)}
                  required
                />
                Accept{" "}
                <Link to="/termeni" className={styles.link}>Termenii și condițiile</Link> și{" "}
                <Link to="/gdpr" className={styles.link}>Politica GDPR</Link></div>
              </label>
            </div>

            <button type="submit" className={styles.btn} disabled={submitting}>
              {submitting ? "Se procesează..." : "Înregistrare"}
            </button>

            <p className={styles.register}>
              Ai deja cont?{" "}
              <Link to="/login" className={styles.link}>Autentifică-te</Link>
            </p>
          </form>
        </section>
      </main>
      <Footer />
    </>
  );
}
