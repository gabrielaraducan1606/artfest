import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AiOutlineEye, AiOutlineEyeInvisible } from 'react-icons/ai';
import api from '../../components/services/api';
import Navbar from '../../components/HomePage/Navbar/Navbar';
import Footer from '../../components/HomePage/Footer/Footer';
import styles from './Login.module.css';
import { useAppContext } from '../../components/Context/useAppContext';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [capsLock, setCapsLock] = useState(false);
  const [showPw, setShowPw] = useState(false);

  const errorRef = useRef(null);

  const { setCart, setFavorites, setToken } = useAppContext();
  const location = useLocation();
  const navigate = useNavigate();

  const params = new URLSearchParams(location.search);
  const qsRedirect = params.get('redirect') || '';

  useEffect(() => {
    if (qsRedirect) {
      sessionStorage.setItem('postLoginRedirect', qsRedirect);
    }
  }, [qsRedirect]);

  useEffect(() => {
    if (errorMsg && errorRef.current) {
      errorRef.current.focus();
    }
  }, [errorMsg]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg('');

    try {
      const res = await api.post('/users/login', { email, password });
      const token = res.data.token;
      setToken(token, remember);

      if (Array.isArray(res.data.cart)) setCart(res.data.cart);
      if (Array.isArray(res.data.favorites)) setFavorites(res.data.favorites);

      const storedRedirect = sessionStorage.getItem('postLoginRedirect') || '';
      const redirect = (qsRedirect || storedRedirect || '').trim();
      const isSafeInternal =
        redirect &&
        redirect.startsWith('/') &&
        !redirect.startsWith('/login') &&
        !redirect.startsWith('/inregistrare');

      if (isSafeInternal) {
        sessionStorage.removeItem('postLoginRedirect');
        navigate(redirect, { replace: true });
        return;
      }

      const role = res.data.role;
      if (role === 'seller') {
        navigate('/vanzator/dashboard', { replace: true });
      } else {
        navigate('/profil', { replace: true });
      }
    } catch (err) {
      setErrorMsg(err.response?.data?.msg || 'Eroare la autentificare');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCapsLock = (e) => {
    const caps = e.getModifierState && e.getModifierState('CapsLock');
    setCapsLock(caps);
  };

  return (
    <>
      <Navbar />
      <div className={styles.page}>
        <div className={styles.wrap}>
          <form onSubmit={handleLogin} className={styles.card}>
            <h2 className={styles.title}>Autentificare</h2>

            {errorMsg && (
              <div
                className={styles.alert}
                tabIndex="-1"
                ref={errorRef}
                role="alert"
              >
                {errorMsg}
              </div>
            )}

            <label className={styles.label}>
              <span className={styles.labelText}>Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={styles.input}
                placeholder="email@exemplu.com"
                required
              />
            </label>

            <label className={styles.label}>
              <span className={styles.labelText}>Parolă</span>
              <div className={styles.inputGroup}>
                <input
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyUp={handleCapsLock}
                  onKeyDown={handleCapsLock}
                  className={styles.input}
                  placeholder="••••••••"
                  required
                />
                <button
                  type="button"
                  className={styles.togglePw}
                  onClick={() => setShowPw((prev) => !prev)}
                  aria-label={showPw ? 'Ascunde parola' : 'Afișează parola'}
                >
                </button>
              </div>
              {capsLock && (
                <span className={styles.fieldError}>
                  Atenție: Caps Lock este activ
                </span>
              )}
            </label>

            <div className={styles.actions}>
              <label className={styles.checkbox}>
                <div className={styles.align}>
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(e) => setRemember(e.target.checked)}
                  />
                  Ține-mă minte pe acest dispozitiv
                </div>
              </label>
              <Link to="/resetare-parola" className={styles.smallLink}>
                Ai uitat parola?
              </Link>
            </div>

            <button type="submit" className={styles.btn} disabled={submitting}>
              {submitting ? 'Se autentifică...' : 'Loghează-te'}
            </button>

            <p className={styles.register}>
              Nu ai cont?{' '}
              <Link to="/inregistrare" className={styles.link}>
                Creează unul aici
              </Link>
            </p>
          </form>
        </div>
      </div>
      <Footer />
    </>
  );
}
