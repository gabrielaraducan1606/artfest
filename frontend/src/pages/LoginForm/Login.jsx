import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api';
import Navbar from '../../components/Navbar/Navbar';
import styles from './Login.module.css';
import { useAppContext } from '../../components/Context/useAppContext';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const { setCart, setFavorites } = useAppContext();

  const handleLogin = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg('');

    try {
      const res = await api.post('/users/login', { email, password });

      localStorage.setItem('authToken', res.data.token);
      if (Array.isArray(res.data.cart)) setCart(res.data.cart);
      if (Array.isArray(res.data.favorites)) setFavorites(res.data.favorites);

      // 🔄 Forțează reload pentru a reactiva contextul (dacă nu e sincron)
      window.location.replace(res.data.role === 'seller' ? '/vanzator/dashboard' : '/profil');
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
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" required />
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Parolă" required />
          <button type="submit" disabled={submitting}>
            {submitting ? 'Se autentifică...' : 'Loghează-te'}
          </button>
          <p className={styles.registerLink}>
            Nu ai cont? <Link to="/inregistrare" className={styles.link}>Creează unul aici</Link>
          </p>
        </form>
      </div>
    </>
  );
};

export default Login;
