import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../../../components/services/api';
import styles from './Step2.module.css';

/**
 * STEP 2 — PLĂȚI & ABONAMENT
 * -------------------------------------------------
 * • Concentrează toate câmpurile NECESARE plăților și facturării.
 * • Include validări pentru IBAN, CUI, email, telefon și accept T&C.
 * • Draft autosave (localStorage + opțional PATCH la /seller/progress).
 * • Trimite ca FormData pentru KYC (fișiere) + alternative URL.
 */

const PHONE_RGX = /^(\+?\d[\d\s-]{6,})$/;
const EMAIL_RGX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CUI_RGX = /^(RO)?\d{2,10}$/i; // simplificat: permite RO prefix opțional + 2-10 cifre
const IBAN_RGX = /^RO\d{2}[A-Z]{4}[0-9A-Z]{16}$/; // format strict (fără spații)

const plans = [
  { value: 'start',  label: 'Start — gratuit 1 lună, apoi 49 lei/lună',  price: 49 },
  { value: 'growth', label: 'Growth — gratuit 1 lună, apoi 99 lei/lună', price: 99 },
  { value: 'pro',    label: 'Pro — gratuit 1 lună, apoi 199 lei/lună',   price: 199 },
];

function useDebouncedCallback(cb, delay) {
  const t = useRef();
  return (...args) => {
    clearTimeout(t.current);
    t.current = setTimeout(() => cb(...args), delay);
  };
}

const FileRow = ({ label, name, fileValue, urlName, urlValue, onFile, onChange, accept }) => (
  <div className={styles.grid2}>
    <label className={styles.fieldBlock}>
      <span className={styles.label}>{label} (fișier)</span>
      <input type="file" name={name} accept={accept} onChange={onFile} />
      {fileValue && <span className={styles.hint}>Selectat: {fileValue.name}</span>}
    </label>
    <label className={styles.fieldBlock}>
      <span className={styles.label}>Link alternativ (URL)</span>
      <input name={urlName} value={urlValue} onChange={onChange} placeholder="https://…/document.pdf" />
      <span className={styles.hint}>Poți furniza fie fișier, fie URL (sau ambele)</span>
    </label>
  </div>
);

export default function Step2({ onStepComplete }) {
  const navigate = useNavigate();
  const token = useMemo(() => localStorage.getItem('authToken'), []);
  const draftKey = useMemo(() => `seller_onboarding_step2:${token?.slice(0, 8) || 'anon'}`,[token]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState(() => {
    const saved = localStorage.getItem(draftKey);
    return saved ? JSON.parse(saved) : {
      entityType: 'pfa',
      companyName: '',
      cui: '',
      country: 'România',
      city: '',
      address: '',
      iban: '',
      emailFinance: '',
      phone: '',
      subscriptionPlan: 'start',
      termsAccepted: false,
      // KYC
      kycDoc: null,
      kycDocUrl: '',
      addressProof: null,
      addressProofUrl: '',
    };
  });

  const [clientErrors, setClientErrors] = useState({});

  useEffect(() => {
    if (!token) navigate('/login', { replace: true });
  }, [token, navigate]);

  // autosave local + (opțional) backend progress
  const debouncedSave = useDebouncedCallback(async (next) => {
    try {
      setSaving(true);
      localStorage.setItem(draftKey, JSON.stringify(next));
      // păstrează progresul în backend
      await api.patch('/seller/progress', { currentStep: 2, billingDraft: next });
    } catch {
      // silent fail; rămâne măcar în localStorage
    } finally { setSaving(false); }
  }, 600);

  const setFormAndSave = (next) => {
    setForm(next);
    debouncedSave(next);
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    const v = type === 'checkbox' ? checked : value;
    const next = { ...form, [name]: v };
    // normalizări ușoare
    if (name === 'cui') next.cui = v.toUpperCase().replace(/\s+/g, '');
    if (name === 'iban') next.iban = v.toUpperCase().replace(/\s+/g, '');
    setFormAndSave(next);
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0] ?? null;
    const { name } = e.target;
    const next = { ...form, [name]: file };
    setFormAndSave(next);
  };

  const validate = () => {
    const err = {};
    if (!form.companyName?.trim()) err.companyName = 'Completează denumirea';

    if (!form.cui?.trim()) err.cui = 'Completează CUI';
    else if (!CUI_RGX.test(form.cui)) err.cui = 'CUI invalid (ex: RO12345678 sau 12345678)';

    if (!form.country?.trim()) err.country = 'Completează țara';
    if (!form.city?.trim()) err.city = 'Completează orașul';
    if (!form.address?.trim()) err.address = 'Completează adresa fiscală';

    if (!form.iban?.trim()) err.iban = 'Completează IBAN';
    else if (!IBAN_RGX.test(form.iban)) err.iban = 'IBAN invalid (trebuie să înceapă cu RO)';

    if (!form.emailFinance?.trim()) err.emailFinance = 'Completează emailul financiar';
    else if (!EMAIL_RGX.test(form.emailFinance)) err.emailFinance = 'Email invalid';

    if (form.phone && !PHONE_RGX.test(form.phone)) err.phone = 'Telefon invalid';

    if (!form.termsAccepted) err.termsAccepted = 'Trebuie să accepți termenii & condițiile';

    return err;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = validate();
    setClientErrors(errs);
    if (Object.keys(errs).length) return;

    setSubmitting(true);
    setError('');

    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => {
        if (v !== null && v !== undefined) fd.append(k, v);
      });

      await api.post('/seller/onboarding/save', fd, {
        params: { step: 2 },
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      localStorage.removeItem(draftKey);
      onStepComplete?.(3);
      navigate('/vanzator/onboarding?step=3', { replace: true });
    } catch (err) {
      setError('Eroare la salvare: ' + (err.response?.data?.msg || err.message));
    } finally { setSubmitting(false); }
  };

  const selectedPlan = useMemo(() => plans.find(p => p.value === form.subscriptionPlan) || plans[0], [form.subscriptionPlan]);

  return (
    <>
      <div className={styles.container}>
        <form className={styles.form} onSubmit={handleSubmit} noValidate>
          <h2 className={styles.title}>Pasul 2 — Configurare plăți & abonament</h2>

          {/* === Secțiunea 1: Date entitate === */}
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Date entitate</h3>
            <div className={styles.grid2}>
              <label className={styles.fieldBlock}>
                <span className={styles.label}>Tip entitate</span>
                <select name="entityType" value={form.entityType} onChange={handleChange} required>
                  <option value="pfa">PFA</option>
                  <option value="srl">SRL</option>
                </select>
              </label>

              <label className={styles.fieldBlock}>
                <span className={styles.label}>Denumire companie / nume complet</span>
                <input name="companyName" value={form.companyName} onChange={handleChange} placeholder="SC Atelier SRL / Popescu Ana" required />
                {clientErrors.companyName && <p className={styles.error}>{clientErrors.companyName}</p>}
              </label>

              <label className={styles.fieldBlock}>
                <span className={styles.label}>Cod fiscal (CUI)</span>
                <input name="cui" value={form.cui} onChange={handleChange} placeholder="RO12345678" required />
                {clientErrors.cui && <p className={styles.error}>{clientErrors.cui}</p>}
              </label>
            </div>

            <div className={styles.grid2}>
              <label className={styles.fieldBlock}>
                <span className={styles.label}>Țara</span>
                <input name="country" value={form.country} onChange={handleChange} required />
                {clientErrors.country && <p className={styles.error}>{clientErrors.country}</p>}
              </label>
              <label className={styles.fieldBlock}>
                <span className={styles.label}>Oraș</span>
                <input name="city" value={form.city} onChange={handleChange} required />
                {clientErrors.city && <p className={styles.error}>{clientErrors.city}</p>}
              </label>
              <label className={styles.fieldBlock}>
                <span className={styles.label}>Adresă fiscală</span>
                <input name="address" value={form.address} onChange={handleChange} placeholder="Str. Exemplu nr. 1" required />
                {clientErrors.address && <p className={styles.error}>{clientErrors.address}</p>}
              </label>
            </div>
          </section>

          {/* === Secțiunea 2: Cont de încasare === */}
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Cont de încasare</h3>
            <div className={styles.grid2}>
              <label className={styles.fieldBlock}>
                <span className={styles.label}>IBAN</span>
                <input name="iban" value={form.iban} onChange={handleChange} placeholder="RO49AAAA1B31007593840000" required />
                {clientErrors.iban && <p className={styles.error}>{clientErrors.iban}</p>}
                <p className={styles.hint}>Introdu fără spații — va fi folosit pentru plățile către tine.</p>
              </label>

              <label className={styles.fieldBlock}>
                <span className={styles.label}>Email financiar</span>
                <input type="email" name="emailFinance" value={form.emailFinance} onChange={handleChange} placeholder="finance@exemplu.ro" required />
                {clientErrors.emailFinance && <p className={styles.error}>{clientErrors.emailFinance}</p>}
              </label>
            </div>

            <div className={styles.grid2}>
              <label className={styles.fieldBlock}>
                <span className={styles.label}>Telefon (opțional)</span>
                <input name="phone" value={form.phone} onChange={handleChange} placeholder="07xxxxxxxx" />
                {clientErrors.phone && <p className={styles.error}>{clientErrors.phone}</p>}
              </label>
            </div>
          </section>

          {/* === Secțiunea 3: Documente KYC === */}
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Documente KYC</h3>
            <p className={styles.hint}>Poți completa acum sau ulterior. E necesar înainte de prima retragere.</p>
            <FileRow
              label="Document identitate (PFA) / Act reprezentant (SRL)"
              name="kycDoc"
              fileValue={form.kycDoc}
              urlName="kycDocUrl"
              urlValue={form.kycDocUrl}
              onFile={handleFileChange}
              onChange={handleChange}
              accept=".png,.jpg,.jpeg,.pdf"
            />
            <FileRow
              label="Dovadă adresă (factură utilități / extras bancar)"
              name="addressProof"
              fileValue={form.addressProof}
              urlName="addressProofUrl"
              urlValue={form.addressProofUrl}
              onFile={handleFileChange}
              onChange={handleChange}
              accept=".png,.jpg,.jpeg,.pdf"
            />
          </section>

          {/* === Secțiunea 4: Abonament === */}
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Abonament</h3>
            <div className={styles.grid2}>
              <label className={styles.fieldBlock}>
                <span className={styles.label}>Plan</span>
                <select name="subscriptionPlan" value={form.subscriptionPlan} onChange={handleChange} required>
                  {plans.map(p => (<option key={p.value} value={p.value}>{p.label}</option>))}
                </select>
              </label>
              <div className={styles.summaryCard}>
                <div className={styles.summaryRow}><span>Plan selectat:</span><strong>{selectedPlan.label}</strong></div>
                <div className={styles.summaryRow}><span>Preț după trial:</span><strong>{selectedPlan.price} lei/lună</strong></div>
              </div>
            </div>
          </section>

          {/* === Secțiunea 5: Termeni === */}
          <section className={styles.section}>
            <label className={styles.checkline}>
              <input type="checkbox" name="termsAccepted" checked={form.termsAccepted} onChange={handleChange} />
              Accept termenii & condițiile
            </label>
            {clientErrors.termsAccepted && <p className={styles.error}>{clientErrors.termsAccepted}</p>}
          </section>

          {error && <div className={styles.errorBox}>{error}</div>}

          <div className={styles.footerBar}>
            <span className={styles.savingState}>{saving ? 'Se salvează…' : ''}</span>
            <button type="submit" disabled={submitting} className={styles.primaryBtn}>
              {submitting ? 'Se salvează…' : 'Salvează și mergi la pasul următor'}
            </button>
            <button
  type="button"
  className={styles.secondaryBtn}
  onClick={async () => {
    try {
      await api.patch('/seller/progress', { currentStep: 3, billingDraft: form });
      navigate('/vanzator/onboarding?step=3');
    } catch {
      alert('Nu am putut sări la pasul 3. Încearcă din nou.');
    }
  }}
>
  Sari peste și mergi la pasul 3
</button>
          </div>
        </form>
      </div>
    </>
  );
}
