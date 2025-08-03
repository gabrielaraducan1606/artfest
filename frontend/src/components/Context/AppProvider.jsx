// src/components/Context/AppProvider.jsx
import React, { useState, useEffect } from 'react';
import api, { getToken, setToken, clearToken } from '../../api';
import { AppContext } from './context';

export const AppProvider = ({ children }) => {
  const [favorites, setFavorites] = useState([]);
  const [cart, setCart] = useState([]);
  const [token, setTokenState] = useState(getToken());

  // Încarcă datele utilizatorului dacă avem token
  useEffect(() => {
    const loadUserData = async () => {
      const t = getToken();
      if (!t) return;
      try {
        const res = await api.post('/users/login-token'); // Authorization este atașat de interceptor
        setFavorites(res.data.favorites || []);
        setCart(res.data.cart || []);
        setTokenState(t);
      } catch (err) {
        console.error('Eroare la încărcarea datelor utilizatorului', err);
        clearToken();
        setTokenState(null);
      }
    };
    loadUserData();
  }, [token]);

  // Sincronizare între tab-uri (login/logout)
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === 'authToken') {
        // reîncarcă pentru a reflecta noua stare
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
      clearToken();
      setTokenState(null);
      setCart([]);
      setFavorites([]);
      // Curățări opționale pentru draft-uri de onboarding, dacă există
      localStorage.removeItem('seller_wizard_draft');
      sessionStorage.clear();
    } finally {
      if (window.location.pathname !== '/login') {
        window.location.replace('/login');
      } else {
        // dacă ești deja pe login, forțează rerender
        window.location.reload();
      }
    }
  };

  return (
    <AppContext.Provider
      value={{
        cart,
        favorites,
        setCart,
        setFavorites,
        // expune utilitare
        setToken: loginWithToken,
        logout,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};