import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api';
import Navbar from '../../components/Navbar/Navbar';
import styles from './VanzatorDashboard.module.css';

export default function VanzatorDashboard() {
  const [sellerData, setSellerData] = useState(null);
  const [products, setProducts] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchSellerData = async () => {
      try {
        const token = localStorage.getItem('authToken');
        const sellerRes = await api.get('/seller/me', {
          headers: { Authorization: `Bearer ${token}` }
        });
        setSellerData(sellerRes.data);

        const prodRes = await api.get('/products/my', {
          headers: { Authorization: `Bearer ${token}` }
        });
        setProducts(prodRes.data);
      } catch (err) {
  console.error('❌ Eroare dashboard:', err);
  setSellerData(null); // Nu forțăm redirect
}
    };

    fetchSellerData();
  }, [navigate]);

  return (
    <>
      <Navbar />
      <div className={styles.container}>
        <h2>Bun venit în dashboard, {sellerData?.storeName || 'Vânzător'}!</h2>

        <div className={styles.infoBox}>
          <p><strong>Email:</strong> {sellerData?.email}</p>
          <p><strong>Telefon:</strong> {sellerData?.phone || '-'}</p>
          <p><strong>Descriere magazin:</strong> {sellerData?.description || '-'}</p>
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
                <img src={prod.image} alt={prod.title} />
                <div>
                  <h4>{prod.title}</h4>
                  <p>{prod.price} lei</p>
                  <button onClick={() => navigate(`/vanzator/editeaza-produs/${prod._id}`)}>✏️ Editează</button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
