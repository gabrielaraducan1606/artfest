import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Navbar from '../../../components/Navbar/Navbar';
import styles from './SendOnboarding.module.css';
import api from '../../../api';

const SellerOnboardingForm = () => {
  const [form, setForm] = useState({
    shopName: '',
    description: '',
    category: '',
    logo: null,
    fullName: '',
    phone: '',
    email: '',
    address: '',
    entityType: '',
    companyName: '',
    cui: '',
    regNumber: '',
    iban: ''
  });

  const navigate = useNavigate();

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleFileChange = (e) => {
    setForm((prev) => ({ ...prev, logo: e.target.files[0] }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    const formData = new FormData();
    for (const key in form) {
      formData.append(key, form[key]);
    }

    try {
      await api.post('/sellers/setup', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
          Authorization: `Bearer ${localStorage.getItem('authToken')}`,
        },
      });

      alert('Datele au fost salvate cu succes!');
      navigate('/vanzator/dashboard');
    } catch (err) {
      alert('Eroare la salvare: ' + (err.response?.data?.msg || err.message));
    }
  };

  return (
    <>
      <Navbar />
      <div className={styles.container}>
        
        <form onSubmit={handleSubmit} className={styles.form}>
          <h2>Configurare cont Vânzător</h2>
          
          <input name="shopName" placeholder="Nume magazin" onChange={handleChange} required />
          <textarea name="description" placeholder="Descriere magazin" onChange={handleChange} />
          <input name="category" placeholder="Categorie principală" onChange={handleChange} required />
          <label>Logo: <input type="file" onChange={handleFileChange} /></label>

          <input name="fullName" placeholder="Nume complet" onChange={handleChange} required />
          <input name="phone" placeholder="Telefon" onChange={handleChange} required />
          <input name="email" placeholder="Email public" onChange={handleChange} required />
          <input name="address" placeholder="Adresă" onChange={handleChange} required />

          <select name="entityType" onChange={handleChange} required>
            <option value="">Tip entitate</option>
            <option value="persoana_fizica">Persoană fizică</option>
            <option value="pfa">PFA</option>
            <option value="srl">SRL</option>
          </select>
          <input name="companyName" placeholder="Denumire firmă" onChange={handleChange} />
          <input name="cui" placeholder="CUI / CIF" onChange={handleChange} />
          <input name="regNumber" placeholder="Nr. înregistrare RC" onChange={handleChange} />
          <input name="iban" placeholder="Cont IBAN" onChange={handleChange} />

          <button type="submit">Salvează și continuă</button>

          <button
            type="button"
            className={styles.skipButton}
            onClick={() => navigate('/vanzator/dashboard')}
          >
            Sari peste
          </button>
        </form>
      </div>
    </>
  );
};

export default SellerOnboardingForm;
