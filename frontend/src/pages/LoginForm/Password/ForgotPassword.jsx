import React, { useState } from "react";
import Navbar from "../../../components/HomePage/Navbar/Navbar";
import Footer from "../../../components/HomePage/Footer/Footer";
import api from "../../../components/services/api";
import styles from "./ForgotPassword.module.css";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [timer, setTimer] = useState(0);

  const validateEmail = (value) => /\S+@\S+\.\S+/.test(value);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSuccessMsg("");
    setErrorMsg("");

    if (!email || !validateEmail(email)) {
      setErrorMsg("Te rog să introduci un email valid.");
      return;
    }

    setLoading(true);
    try {
      await api.post("/auth/forgot-password", { email });
      setSuccessMsg(
        "Dacă există un cont cu acest email, vei primi în curând un link de resetare."
      );
      setTimer(60);
      const countdown = setInterval(() => {
        setTimer((prev) => {
          if (prev <= 1) {
            clearInterval(countdown);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } catch {
      setErrorMsg(
        "A apărut o problemă la trimiterea cererii. Te rog să încerci din nou."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Navbar />
      <div className={styles.page}>
        <div className={styles.wrap}>
          <form onSubmit={handleSubmit} className={styles.card}>
            <h2 className={styles.title}>Resetare parolă</h2>

            {successMsg && <div className={`${styles.alert} ${styles.success}`}>{successMsg}</div>}
            {errorMsg && <div className={`${styles.alert} ${styles.error}`}>{errorMsg}</div>}

            <label className={styles.label}>
              <span className={styles.labelText}>Email</span>
              <input
                type="email"
                className={styles.input}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="exemplu@email.com"
                required
              />
            </label>

            <button
              className={styles.btn}
              type="submit"
              disabled={loading || timer > 0}
            >
              {loading ? (
                <span className={styles.spinner}></span>
              ) : timer > 0 ? (
                `Retrimite în ${timer}s`
              ) : (
                "Trimite link"
              )}
            </button>
          </form>
        </div>
      </div>
      <Footer />
    </>
  );
}
