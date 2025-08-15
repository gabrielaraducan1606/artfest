import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Navbar from '../../../components/HomePage/Navbar/Navbar';
import Footer from '../../../components/HomePage/Footer/Footer';
import api from '../../../components/services/api';
import styles from './ResetPassword.module.css';

export default function ResetPassword() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [caps, setCaps] = useState(false);

  const handleKeyUp = (e) => {
    setCaps(e.getModifierState('CapsLock'));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (password !== confirm) {
      setError('Parolele nu coincid');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await api.post(`/auth/reset-password/${token}`, { password });
      setSuccess('Parola a fost resetată. Vei fi redirecționat la login...');
      setTimeout(() => navigate('/login'), 3000);
    } catch {
      setError('Link invalid sau expirat.');
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
            <h2 className={styles.title}>Setează o nouă parolă</h2>
            {error && <div className={styles.alert}>{error}</div>}
            {success && <div className={styles.alert}>{success}</div>}

            <label className={styles.label}>
              <span className={styles.labelText}>Parolă nouă</span>
              <input
                type="password"
                className={styles.input}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyUp={handleKeyUp}
                required
              />
            </label>
            {caps && <div className={styles.fieldError}>Atenție: Caps Lock activat</div>}

            <label className={styles.label}>
              <span className={styles.labelText}>Confirmă parola</span>
              <input
                type="password"
                className={styles.input}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
            </label>

            <button className={styles.btn} type="submit" disabled={loading}>
              {loading ? 'Se salvează...' : 'Resetează parola'}
            </button>
          </form>
        </div>
      </div>
      <Footer />
    </>
  );
}
