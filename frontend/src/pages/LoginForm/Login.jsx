// src/pages/login.jsx
import React, { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import api from '../../../api/api';
import Navbar from '../../components/Navbar/Navbar';
import styles from './Login.module.css';
import { useAppContext } from '../../components/Context/useAppContext';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const { setCart, setFavorites, setToken } = useAppContext();
  const location = useLocation();
  const navigate = useNavigate();

  // citesc ?redirect=... (și îl țin ca fallback în sessionStorage)
  const params = new URLSearchParams(location.search);
  const qsRedirect = params.get('redirect') || '';
  useEffect(() => {
    if (qsRedirect) sessionStorage.setItem('postLoginRedirect', qsRedirect);
  }, [qsRedirect]);

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

      // 1) preferă redirect-ul din query / session dacă există și e intern
      const storedRedirect = sessionStorage.getItem('postLoginRedirect') || '';
      const redirect =
        (qsRedirect || storedRedirect || '')
          .trim();

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

      // 2) altfel, du-l după rol
      const role = res.data.role;
      if (role === 'seller') {
        navigate('/vanzator/dashboard', { replace: true });
      } else {
        navigate('/profil', { replace: true }); // sau '/'
      }
    } catch (err) {
      setErrorMsg(err.response?.data?.msg || 'Eroare la autentificare');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Navbar />
      <div className={styles.container}>
        <form onSubmit={handleLogin} className={styles.form}>
          <h2>Autentificare</h2>
          {errorMsg && <p className={styles.error}>{errorMsg}</p>}

          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            required
          />

          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Parolă"
            required
          />

          <label className={styles.checkbox}>
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            Ține-mă minte pe acest dispozitiv
          </label>

          <button type="submit" disabled={submitting}>
            {submitting ? 'Se autentifică...' : 'Loghează-te'}
          </button>

          <p className={styles.registerLink}>
            Nu ai cont?{' '}
            <Link to="/inregistrare" className={styles.link}>
              Creează unul aici
            </Link>
          </p>
        </form>
      </div>
    </>
  );
};

export default Login;
