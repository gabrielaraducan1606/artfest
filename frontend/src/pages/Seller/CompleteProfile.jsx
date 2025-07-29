import React, { useState, useEffect } from 'react';
import api from '../../api';
import { useNavigate } from 'react-router-dom';
import Navbar from '../../components/Navbar/Navbar';
import styles from './CompleteProfile.module.css';

const CompleteProfile = () => {
  const [formData, setFormData] = useState({
    storeName: '',
    description: '',
    category: '',
    fullName: '',
    phone: '',
    address: '',
    entityType: 'PF',
    companyName: '',
    cui: '',
    registrationNumber: '',
    iban: '',
  });

  const navigate = useNavigate();

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await api.post('/seller', formData, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('authToken')}`,
        },
      });
      alert('Profilul de vânzător a fost completat!');
      navigate('/vanzator/dashboard');
    } catch (err) {
      console.error(err);
      alert('Eroare la salvare. Verifică datele.');
    }
  };

  useEffect(() => {
    const checkSellerProfile = async () => {
      try {
        const res = await api.get('/seller/me', {
          headers: {
            Authorization: `Bearer ${localStorage.getItem('authToken')}`,
          },
        });
        if (res.data) {
          navigate('/vanzator/dashboard');
        }
      } catch (err) {
        if (err.response?.status !== 404) {
          alert('Eroare la verificarea profilului vânzător.');
        }
      }
    };

    checkSellerProfile();
  }, [navigate]);

  return (
    <>
      <Navbar />
      <div className={styles.container}>
        <form className={styles.form} onSubmit={handleSubmit}>
          <h2 className={styles.title}>Completează profilul tău de vânzător</h2>

          <input
            type="text"
            name="storeName"
            value={formData.storeName}
            onChange={handleChange}
            placeholder="Nume magazin"
            required
          />
          <textarea
            name="description"
            value={formData.description}
            onChange={handleChange}
            placeholder="Descriere scurtă"
            rows={3}
            required
          />

          <label>Categorie principală:</label>
          <select
            name="category"
            value={formData.category}
            onChange={handleChange}
            required
          >
            <option value="">Alege o categorie</option>
            <option value="decorațiuni">Decorațiuni</option>
            <option value="îmbrăcăminte">Îmbrăcăminte</option>
            <option value="bijuterii">Bijuterii</option>
            <option value="pictură">Pictură</option>
            <option value="jucării">Jucării</option>
            <option value="papetărie">Papetărie</option>
          </select>

          <input
            type="text"
            name="fullName"
            value={formData.fullName}
            onChange={handleChange}
            placeholder="Nume complet"
            required
          />
          <input
            type="text"
            name="phone"
            value={formData.phone}
            onChange={handleChange}
            placeholder="Telefon"
            required
          />
          <input
            type="text"
            name="address"
            value={formData.address}
            onChange={handleChange}
            placeholder="Adresă"
            required
          />

          <label>Tip entitate:</label>
          <select
            name="entityType"
            value={formData.entityType}
            onChange={handleChange}
          >
            <option value="PF">Persoană fizică</option>
            <option value="PFA">PFA</option>
            <option value="SRL">SRL</option>
          </select>

          {formData.entityType !== 'PF' && (
            <>
              <input
                type="text"
                name="companyName"
                value={formData.companyName}
                onChange={handleChange}
                placeholder="Denumire companie"
                required
              />
              <input
                type="text"
                name="cui"
                value={formData.cui}
                onChange={handleChange}
                placeholder="Cod fiscal (CUI)"
                required
              />
              <input
                type="text"
                name="registrationNumber"
                value={formData.registrationNumber}
                onChange={handleChange}
                placeholder="Nr. Reg. Comerțului"
                required
              />
              <input
                type="text"
                name="iban"
                value={formData.iban}
                onChange={handleChange}
                placeholder="IBAN"
                required
              />
            </>
          )}

          <button type="submit">Trimite</button>

          <button
            type="button"
            className={styles.skipButton}
            onClick={() => navigate('/vanzator/sendonboarding')}
          >
            Sar peste și merg la pasul final
          </button>
        </form>
      </div>
    </>
  );
};

export default CompleteProfile;
