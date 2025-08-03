import React, { useState, useEffect, useMemo } from 'react';
import api from '../../api';
import { useNavigate } from 'react-router-dom';
import Navbar from '../../components/Navbar/Navbar';
import styles from './SellerProfile.module.css';

const SellerProfile = () => {
  const navigate = useNavigate();

  // token doar pentru a separa draft-urile per utilizator
  const token = useMemo(() => localStorage.getItem('authToken'), []);
  const draftKey = useMemo(
    () => `seller_wizard_draft:${token?.slice(0, 8) || 'anon'}`,
    [token]
  );

  const [formData, setFormData] = useState(() => {
    const saved = localStorage.getItem(draftKey);
    return saved
      ? JSON.parse(saved)
      : {
          shopName: '',
          username: '',
          email: '',
          password: '',
          confirmPassword: '',
          phone: '',
          publicPhone: false,
          profileImage: null,
          coverImage: null,
          shortDescription: '',
          brandStory: '',
          category: '',
          city: '',
          country: 'România',
          deliveryNotes: '',
          returnNotes: '',
          entityType: 'pfa', // pfa | srl
          companyName: '',
          cui: '',
          registrationNumber: '',
          iban: '',
        };
  });

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
  };

  const handleFileChange = (e) => {
    const input = e.target;
    if (!input) return;
    const { name } = input;
    const file = input.files?.[0] ?? null;
    if (!name) return;
    setFormData((prev) => ({ ...prev, [name]: file }));
  };

  // Salvează draft-ul (fără fișiere) la fiecare modificare
// în SellerProfile.jsx, în locul useEffect-ului care salvează draftul:
useEffect(() => {
  const rest = { ...formData };
  delete rest.profileImage;
  delete rest.coverImage;
  localStorage.setItem(draftKey, JSON.stringify(rest));
}, [formData, draftKey]);


  // Gard minim: fără token -> /login; dacă profilul există -> /vanzator/dashboard
  useEffect(() => {
    if (!token) {
      navigate('/login', { replace: true });
      return;
    }
    const checkSellerProfile = async () => {
      try {
        const res = await api.get('/seller/me'); // Authorization e adăugat automat
        if (res.data) navigate('/vanzator/dashboard');
      } catch (err) {
        if (err?.response?.status !== 404) {
          alert('Eroare la verificarea profilului vânzător.');
        }
      }
    };
    checkSellerProfile();
  }, [navigate, token]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (
      (formData.password || formData.confirmPassword) &&
      formData.password !== formData.confirmPassword
    ) {
      alert('Parola și confirmarea parolei nu coincid.');
      return;
    }

    const payload = {
      ...formData,
      entityType: String(formData.entityType || '').toLowerCase(), // pfa | srl
    };

    const formDataToSend = new FormData();
    Object.entries(payload).forEach(([key, value]) => {
      if (value !== null && value !== undefined) {
        formDataToSend.append(key, value);
      }
    });

    try {
      await api.post('/seller', formDataToSend, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      localStorage.removeItem(draftKey); // curăță draft-ul DOAR la succes
      alert('Profilul de vânzător a fost completat!');
      navigate('/vanzator/sendonboarding');
    } catch (err) {
      console.error(err);
      alert('Eroare la salvare. Verifică datele.');
    }
  };

  return (
    <>
      <Navbar />
      <div className={styles.container}>
        <form className={styles.form} onSubmit={handleSubmit}>
          <h2 className={styles.title}>Completează profilul tău de vânzător</h2>
          <p style={{ fontSize: '0.9rem', color: '#555', marginBottom: '1rem' }}>
            Informațiile de mai jos vor fi folosite la configurarea contului și vor apărea pe
            pagina ta publică de prezentare, pentru ca clienții să îți poată descoperi brandul
            și produsele.
          </p>

          {/* Date cont */}
          <input
            type="text"
            name="shopName"
            value={formData.shopName}
            onChange={handleChange}
            placeholder="Nume magazin"
            required
          />
          <input
            type="text"
            name="username"
            value={formData.username}
            onChange={handleChange}
            placeholder="Username unic (va genera linkul de promovare)"
            required
          />
          <small style={{ color: '#777' }}>
            Link public: artfest.ro/{formData.username || 'username-tau'}
          </small>

          <input
            type="email"
            name="email"
            value={formData.email}
            onChange={handleChange}
            placeholder="Email"
            required
          />

          <input
            type="password"
            name="password"
            value={formData.password}
            onChange={handleChange}
            placeholder="Parolă"
            required
          />
          <input
            type="password"
            name="confirmPassword"
            value={formData.confirmPassword}
            onChange={handleChange}
            placeholder="Confirmă parola"
            required
          />

          <input
            type="text"
            name="phone"
            value={formData.phone}
            onChange={handleChange}
            placeholder="Telefon (obligatoriu pentru contact intern)"
            required
          />
          <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <input
              type="checkbox"
              name="publicPhone"
              checked={formData.publicPhone}
              onChange={handleChange}
            />
            Afișează numărul de telefon pe pagina publică (opțional)
          </label>

          {/* Media */}
          <label>Logo / poză de profil:</label>
          <input type="file" name="profileImage" onChange={handleFileChange} />
          <label>Fotografie de copertă:</label>
          <input type="file" name="coverImage" onChange={handleFileChange} />

          {/* Informații de prezentare */}
          <textarea
            name="shortDescription"
            value={formData.shortDescription}
            onChange={handleChange}
            placeholder="Descriere scurtă a brandului și a meșteșugului"
            rows={3}
            required
          />
          <textarea
            name="brandStory"
            value={formData.brandStory}
            onChange={handleChange}
            placeholder="Povestea brandului (opțional)"
            rows={5}
          />

          <label>Categorie de produse:</label>
          <select
            name="category"
            value={formData.category}
            onChange={handleChange}
            required
          >
            <option value="">Alege o categorie</option>
            <option value="bijuterii">Bijuterii</option>
            <option value="decorațiuni">Decorațiuni</option>
            <option value="îmbrăcăminte">Îmbrăcăminte</option>
            <option value="pictură">Pictură</option>
            <option value="jucării">Jucării</option>
            <option value="papetărie">Papetărie</option>
          </select>

          <input
            type="text"
            name="city"
            value={formData.city}
            onChange={handleChange}
            placeholder="Oraș"
            required
          />
          <input
            type="text"
            name="country"
            value={formData.country}
            onChange={handleChange}
            placeholder="Țară"
            required
          />

          {/* Note opționale */}
          <textarea
            name="deliveryNotes"
            value={formData.deliveryNotes}
            onChange={handleChange}
            placeholder="Note despre livrare (opțional — ex.: timp de producție, ridicare locală, curier preferat)"
            rows={3}
          />
          <textarea
            name="returnNotes"
            value={formData.returnNotes}
            onChange={handleChange}
            placeholder="Note despre retur (opțional — ex.: excepții pentru produse personalizate)"
            rows={3}
          />

          {/* Date firmă */}
          <label>Tip entitate:</label>
          <select
            name="entityType"
            value={formData.entityType}
            onChange={handleChange}
            required
          >
            <option value="pfa">PFA</option>
            <option value="srl">SRL</option>
          </select>

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
            placeholder="Nr. Registrul Comerțului"
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

          <button type="submit">Salvează profilul</button>
          <button
            type="button"
            className={styles.skipButton}
            onClick={() => navigate('/vanzator/sendonboarding')}
          >
            Sar peste și merg la pasul Plăți
          </button>
        </form>
      </div>
    </>
  );
};

export default SellerProfile;
