import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api';
import Navbar from '../../components/Navbar/Navbar';
import styles from './VanzatorDashboard.module.css';

export default function VanzatorDashboard() {
  const [sellerData, setSellerData] = useState(null);
  const [products, setProducts] = useState([]);
  const navigate = useNavigate();

  // util: ești în dev?
  const isDev =
    typeof import.meta !== 'undefined' &&
    import.meta.env &&
    import.meta.env.MODE !== 'production';

  // ✅ logout curat
  const handleLogout = () => {
    try {
      // 1) șterge tokenul
      localStorage.removeItem('authToken');

      // 2) curăță headerul Authorization, dacă a fost setat
      if (api?.defaults?.headers?.common?.Authorization) {
        delete api.defaults.headers.common.Authorization;
      }

      // 3) curățări opționale
      localStorage.removeItem('appUser'); // dacă folosești
      sessionStorage.clear();             // dacă folosești

      // 4) redirect
      navigate('/login', { replace: true });
      // sau: navigate('/vanzator/completare-profil', { replace: true });
    } catch (e) {
      if (isDev) console.debug('Logout cleanup warning:', e);
    }
  };

  useEffect(() => {
    const fetchSellerData = async () => {
      const token = localStorage.getItem('authToken');
      if (!token) {
        navigate('/login', { replace: true });
        return;
      }

      try {
        // profilul vânzătorului
        const sellerRes = await api.get('/seller/me', {
          headers: { Authorization: `Bearer ${token}` },
        });
        setSellerData(sellerRes.data);

        // produsele asociate vânzătorului
        const prodRes = await api.get('/products/my', {
          headers: { Authorization: `Bearer ${token}` },
        });
        setProducts(Array.isArray(prodRes.data) ? prodRes.data : []);
      } catch (err) {
        const status = err?.response?.status;
        if (status === 404) {
          // nu există profil -> mergi la formularul de completare
          navigate('/vanzator/completare-profil', { replace: true });
          return;
        }
        if (status === 401) {
          // token invalid/expirat -> login
          handleLogout();
          return;
        }
        console.error('❌ Eroare dashboard:', err);
        setSellerData(null);
        setProducts([]);
      }
    };

    fetchSellerData();
  }, [navigate]); // dependență pe navigate e ok

  return (
    <>
      <Navbar />
      <div className={styles.container}>
        <div className={styles.headerRow}>
          <h2>Bun venit în dashboard, {sellerData?.storeName || sellerData?.shopName || 'Vânzător'}!</h2>
          <button className={styles.logoutBtn} onClick={handleLogout}>Logout</button>
        </div>

        <div className={styles.infoBox}>
          <p><strong>Email:</strong> {sellerData?.email || '-'}</p>
          <p><strong>Telefon:</strong> {sellerData?.phone || '-'}</p>
          <p><strong>Descriere magazin:</strong> {sellerData?.description || sellerData?.shortDescription || '-'}</p>
        </div>

        <div className={styles.actions}>
          <button onClick={() => navigate('/vanzator/adauga-produs')}>➕ Adaugă produs</button>
        </div>

        <h3>Produsele tale</h3>
        <div className={styles.productList}>
          {products.length === 0 ? (
            <p>Nu ai adăugat încă produse.</p>
          ) : (
            products.map((prod) => (
              <div key={prod._id} className={styles.productCard}>
                {prod.image ? <img src={prod.image} alt={prod.title} /> : <div className={styles.placeholder} />}
                <div>
                  <h4>{prod.title}</h4>
                  <p>{prod.price} lei</p>
                  <button onClick={() => navigate(`/vanzator/editeaza-produs/${prod._id}`)}>
                    ✏️ Editează
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
