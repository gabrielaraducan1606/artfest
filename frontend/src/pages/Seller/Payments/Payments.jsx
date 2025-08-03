import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Navbar from '../../../components/Navbar/Navbar';
import styles from './Payments.module.css';
import api from '../../../api';

const Payments = () => {
  const [form, setForm] = useState({
    // Identitate / firmă
    entityType: 'pfa',       // doar pfa | srl
    legalName: '',
    cui: '',                 // doar CUI (fără CNP)
    country: 'România',
    city: '',
    address: '',
    // Plăți / decontare
    emailFinance: '',
    phone: '',
    iban: '',                // IBAN pentru încasarea banilor
    // KYC (opțional acum; devine obligatoriu dacă vei folosi Stripe/PayPal)
    kycDoc: null,
    kycDocUrl: '',
    addressProof: null,
    addressProofUrl: '',
    // Abonament (prima lună gratuită la orice plan)
    subscriptionPlan: 'start', // start | growth | pro
    termsAccepted: false,
  });

  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setForm((prev) => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
  };

  const handleFileChange = (e) => {
    const { name, files } = e.target;
    setForm((prev) => ({ ...prev, [name]: files[0] || null }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!form.termsAccepted) {
      alert('Trebuie să accepți termenii & condițiile.');
      return;
    }

    setSubmitting(true);
    try {
      // normalizări minime
      const normalized = {
        ...form,
        entityType: String(form.entityType || '').toLowerCase(), // pfa | srl
      };

      const formData = new FormData();
      Object.entries(normalized).forEach(([key, value]) => {
        if (value !== null && value !== undefined) formData.append(key, value);
      });

      // salvează profilul de plăți
      await api.post('/payments/sellers/setup', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
          Authorization: `Bearer ${localStorage.getItem('authToken')}`,
        },
      });

      // după salvare -> redirecționează spre pagina contractului
      // fie direct pe o rută de UI, fie generezi un draft imediat:
      const { data } = await api.post('/contracts/preview', 
        { version: 'v1.0' }, 
        { headers: { Authorization: `Bearer ${localStorage.getItem('authToken')}` } }
      );

      // mergi la pagina care afișează contractul generat
      navigate(`/vanzator/contract/${data._id}`);
    } catch (err) {
      alert('Eroare la salvare: ' + (err.response?.data?.msg || err.message));
    } finally {
      setSubmitting(false);
    }
  };

  const handleGenerateContract = async () => {
    try {
      const { data } = await api.post('/contracts/preview', 
        { version: 'v1.0' }, 
        { headers: { Authorization: `Bearer ${localStorage.getItem('authToken')}` } }
      );
      navigate(`/vanzator/contract/${data._id}`);
    } catch (err) {
      alert('Nu am putut genera contractul: ' + (err.response?.data?.msg || err.message));
    }
  };

  return (
    <>
      <Navbar />
      <div className={styles.container}>
        <form onSubmit={handleSubmit} className={styles.form}>
          <h2 className={styles.title}>Configurare plăți & abonament</h2>

          {/* Tip entitate și date fiscale */}
          <label>
            Tip entitate
            <select name="entityType" value={form.entityType} onChange={handleChange} required>
              <option value="pfa">PFA</option>
              <option value="srl">SRL</option>
            </select>
          </label>

          <label>
            Denumire legală / Nume complet
            <input
              name="legalName"
              value={form.legalName}
              onChange={handleChange}
              placeholder="SC Atelier SRL / Popescu Ana"
              required
            />
          </label>

          <label>
            Cod fiscal (CUI)
            <input
              name="cui"
              value={form.cui}
              onChange={handleChange}
              placeholder="RO12345678"
              required
            />
          </label>

          <label>
            Țara
            <input name="country" value={form.country} onChange={handleChange} required />
          </label>

          <label>
            Oraș
            <input name="city" value={form.city} onChange={handleChange} required />
          </label>

          <label>
            Adresă fiscală
            <input
              name="address"
              value={form.address}
              onChange={handleChange}
              placeholder="Str. Exemplu nr. 1, bl. X, ap. Y"
              required
            />
          </label>

          {/* Detalii încasare */}
          <label>
            IBAN pentru plăți către tine
            <input
              name="iban"
              value={form.iban}
              onChange={handleChange}
              placeholder="RO49AAAA1B31007593840000"
              required
            />
          </label>
          <small style={{ color: '#777' }}>
            IBAN-ul este folosit pentru transferul sumelor încasate din vânzări.
          </small>

          <label>
            Email financiar
            <input
              type="email"
              name="emailFinance"
              value={form.emailFinance}
              onChange={handleChange}
              placeholder="finance@exemplu.ro"
              required
            />
          </label>
          <small style={{ color: '#777' }}>
            Acest email este folosit pentru facturare și comunicări legate de plăți.
          </small>

          <label>
            Telefon (opțional)
            <input
              name="phone"
              value={form.phone}
              onChange={handleChange}
              placeholder="07xxxxxxxx"
            />
          </label>

          {/* KYC – opțional acum; devine necesar dacă integrezi Stripe/PayPal */}
          <div>
            <p style={{ color: '#555', margin: '0 0 .5rem' }}>
              Documente KYC (opțional în acest moment). Dacă alegi ulterior procesatori de plăți
              precum Stripe/PayPal, aceștia vor cere obligatoriu verificare identitate și adresă.
            </p>
          </div>

          <label>
            Document identitate (fișier)
            <input type="file" name="kycDoc" onChange={handleFileChange} />
          </label>

          <label>
            Link document identitate (URL alternativ)
            <input
              name="kycDocUrl"
              value={form.kycDocUrl}
              onChange={handleChange}
              placeholder="https://…/id.pdf"
            />
          </label>

          <label>
            Dovadă adresă (fișier)
            <input type="file" name="addressProof" onChange={handleFileChange} />
          </label>

          <label>
            Link dovadă adresă (URL alternativ)
            <input
              name="addressProofUrl"
              value={form.addressProofUrl}
              onChange={handleChange}
              placeholder="https://…/utility.pdf"
            />
          </label>

          {/* Abonamente */}
          <label>
            Abonament
            <select
              name="subscriptionPlan"
              value={form.subscriptionPlan}
              onChange={handleChange}
              required
            >
              <option value="start">Start — gratuit 1 lună, apoi 49 lei/lună</option>
              <option value="growth">Growth — gratuit 1 lună, apoi 99 lei/lună</option>
              <option value="pro">Pro — gratuit 1 lună, apoi 199 lei/lună</option>
            </select>
          </label>
          <small style={{ color: '#777' }}>
            Prima lună este gratuită pentru orice plan. Poți schimba planul oricând din cont.
          </small>

          {/* Termeni */}
          <label style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>
            <input
              type="checkbox"
              name="termsAccepted"
              checked={form.termsAccepted}
              onChange={handleChange}
            />
            Accept termenii & condițiile
          </label>

          <button type="submit" disabled={submitting}>
            {submitting ? 'Se salvează…' : 'Salvează și generează contractul'}
          </button>

          <button
            type="button"
            className={styles.skipButton}
            onClick={handleGenerateContract}
          >
            Generează contract (pas opțional)
          </button>
        </form>
      </div>
    </>
  );
};

export default Payments;
