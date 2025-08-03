// src/pages/RegisterForm.jsx
import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api';
import Navbar from '../../components/Navbar/Navbar';
import styles from './RegisterForm.module.css';
import { useAppContext } from '../../components/Context/useAppContext';

const RegisterForm = () => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSeller, setIsSeller] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const { setToken } = useAppContext();

  // Dacă cumva a rămas o sesiune veche, curăț-o când intri aici
  useEffect(() => {
    localStorage.removeItem('authToken');
  }, []);

  const handleRegister = async (e) => {
    e.preventDefault();

    if (!acceptTerms) {
      alert('Trebuie să accepți Termenii și Politica GDPR pentru a continua.');
      return;
    }

    try {
      const res = await api.post('/users/register', {
        name,
        email,
        password,
        role: isSeller ? 'seller' : 'user',
      });

      const token = res.data.token;
      setToken(token, true); // ✅ e logic ca un cont nou să fie persistent implicit

      alert('Cont creat cu succes!');
      window.location.href = isSeller ? '/vanzator/completare-profil' : '/profil';
    } catch (err) {
      alert(err.response?.data?.msg || 'Eroare la înregistrare');
    }
  };

  return (
    <>
      <Navbar />
      <div className={styles.container}>
        <form onSubmit={handleRegister} className={styles.form}>
          <h2>Creare cont nou</h2>

          <input type="text" placeholder="Nume complet" value={name} onChange={(e) => setName(e.target.value)} required />
          <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <input type="password" placeholder="Parolă" value={password} onChange={(e) => setPassword(e.target.value)} required />

          <label className={styles.checkbox}>
            <input type="checkbox" checked={isSeller} onChange={(e) => setIsSeller(e.target.checked)} />
            Vreau să vând produse pe platformă
          </label>

          <label className={styles.checkbox}>
            <input type="checkbox" checked={acceptTerms} onChange={(e) => setAcceptTerms(e.target.checked)} required />
            Accept <Link to="/termeni" className={styles.link}>Termenii și condițiile</Link> și <Link to="/gdpr" className={styles.link}>Politica GDPR</Link>
          </label>

          <button type="submit" className={styles.submitButton}>Înregistrare</button>
        </form>
      </div>
    </>
  );
};

export default RegisterForm;