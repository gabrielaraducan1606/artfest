import React, { useState, useEffect } from 'react';
import api, { getToken, setToken, clearToken } from '../services/api';
import { AppContext } from './context';

export const AppProvider = ({ children }) => {
  const [favorites, setFavorites] = useState([]);
  const [cart, setCart] = useState([]);
  const [token, setTokenState] = useState(getToken());

  // 📌 Încarcă datele inițiale
  useEffect(() => {
    const loadUserData = async () => {
      const t = getToken();

      // Dacă nu e logat → din localStorage
      if (!t) {
        const localCart = JSON.parse(localStorage.getItem('cart') || '[]');
        const localFav = JSON.parse(localStorage.getItem('wishlist') || '[]');
        setCart(localCart);
        setFavorites(localFav);
        return;
      }

      try {
        // Sincronizare localStorage cu backend
        const localCart = JSON.parse(localStorage.getItem('cart') || '[]');
        const localFav = JSON.parse(localStorage.getItem('wishlist') || '[]');

        if (localCart.length > 0) {
          const results = await Promise.all(
            localCart.map(item => {
              if (!item?._id) return Promise.resolve(null);
              return api.post(`/cart/${item._id}`, { qty: item.qty || 1 })
                .catch(err => {
                  if (err?.response?.status === 404) return null; // produs lipsă → ignorăm
                  throw err; // alte coduri → propagăm
                });
            })
          );
          const failedIds = new Set(
            results.map((r, i) => (r === null ? localCart[i]?._id : null)).filter(Boolean)
          );
          if (failedIds.size > 0) {
            const filtered = localCart.filter(i => !failedIds.has(i._id));
            if (filtered.length) {
              localStorage.setItem('cart', JSON.stringify(filtered));
            } else {
              localStorage.removeItem('cart');
            }
          } else {
            localStorage.removeItem('cart');
          }
        }

        if (localFav.length > 0) {
          const favRes = await Promise.all(
            localFav.map(item => {
              if (!item?._id) return Promise.resolve(null);
              return api.post(`/wishlist/${item._id}`)
                .catch(err => {
                  if (err?.response?.status === 404) return null;
                  throw err;
                });
            })
          );
          const failedFavs = new Set(
            favRes.map((r, i) => (r === null ? localFav[i]?._id : null)).filter(Boolean)
          );
          if (failedFavs.size > 0) {
            const filteredFav = localFav.filter(i => !failedFavs.has(i._id));
            if (filteredFav.length) {
              localStorage.setItem('wishlist', JSON.stringify(filteredFav));
            } else {
              localStorage.removeItem('wishlist');
            }
          } else {
            localStorage.removeItem('wishlist');
          }
        }

        // 📥 Ia datele actuale din backend
        const [wishlistRes, cartRes] = await Promise.all([
          api.get('/wishlist'),
          api.get('/cart'),
        ]);

        setFavorites(wishlistRes.data || []);
        setCart(cartRes.data || []);
        setTokenState(t);
      } catch (err) {
        console.error('Eroare la încărcarea datelor utilizatorului', err);
        if (err?.response?.status === 401) {
          clearToken();
          setTokenState(null);
        } else {
          // rămâi logat; poți afișa un toast non-blocking aici
        }
      }
    };

    loadUserData();
  }, [token]);

  // 📌 Sincronizare între tab-uri
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === 'authToken') {
        window.location.reload();
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const loginWithToken = (newToken, persist = true) => {
    setToken(newToken, persist);
    setTokenState(newToken);
  };

  const logout = () => {
    try {
      // Salvăm local
      localStorage.setItem('cart', JSON.stringify(cart));
      localStorage.setItem('wishlist', JSON.stringify(favorites));

      clearToken();
      setTokenState(null);
      setCart([]);
      setFavorites([]);
      localStorage.removeItem('seller_wizard_draft');
      sessionStorage.clear();
    } finally {
      window.location.replace('/login');
    }
  };

  return (
    <AppContext.Provider
      value={{
        cart,
        favorites,
        setCart,
        setFavorites,
        setToken: loginWithToken,
        logout,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};
