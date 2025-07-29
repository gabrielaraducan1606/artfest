// src/components/Context/AppProvider.jsx
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { AppContext } from './context';

export const AppProvider = ({ children }) => {
  const [favorites, setFavorites] = useState([]);
  const [cart, setCart] = useState([]);
  const [token, setToken] = useState(localStorage.getItem('authToken'));

  useEffect(() => {
  const loadUserData = async () => {
    const storedToken = localStorage.getItem('authToken');
    if (!storedToken) return;

    try {
      const res = await axios.post(
        `${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/users/login-token`,
        {},
        { headers: { Authorization: `Bearer ${storedToken}` } }
      );
      setFavorites(res.data.favorites || []);
      setCart(res.data.cart || []);
      setToken(storedToken);
    } catch (err) {
      console.error('Eroare la încărcarea datelor utilizatorului', err);
      localStorage.removeItem('authToken');
    }
  };

  loadUserData();
}, [token]); 


  const saveToBackend = async (cartData = cart, favData = favorites) => {
    if (!token) return;
    try {
      await axios.post(
        `${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/users/save-data`,
        { cart: cartData, favorites: favData },
        { headers: { Authorization: `Bearer ${token}` } }
      );
    } catch (err) {
      console.error('Eroare la salvarea datelor:', err);
    }
  };

  const addToFavorites = (product) => {
    setFavorites((prev) => {
      if (!prev.some((p) => p.id === product.id)) {
        const updated = [...prev, product];
        saveToBackend(cart, updated);
        return updated;
      }
      return prev;
    });
  };

  const removeFromFavorites = (id) => {
    const updated = favorites.filter((item) => item.id !== id);
    setFavorites(updated);
    saveToBackend(cart, updated);
  };

  const addToCart = (product) => {
    setCart((prev) => {
      const exists = prev.find((p) => p.id === product.id);
      let updated;
      if (exists) {
        updated = prev.map((p) =>
          p.id === product.id ? { ...p, quantity: p.quantity + 1 } : p
        );
      } else {
        updated = [...prev, { ...product, quantity: 1 }];
      }
      saveToBackend(updated, favorites);
      return updated;
    });
  };

  const removeFromCart = (id) => {
    const updated = cart.filter((item) => item.id !== id);
    setCart(updated);
    saveToBackend(updated, favorites);
  };

  const increaseQuantity = (id) => {
    const updated = cart.map((item) =>
      item.id === id ? { ...item, quantity: item.quantity + 1 } : item
    );
    setCart(updated);
    saveToBackend(updated, favorites);
  };

  const decreaseQuantity = (id) => {
    const updated = cart.map((item) =>
      item.id === id && item.quantity > 1
        ? { ...item, quantity: item.quantity - 1 }
        : item
    );
    setCart(updated);
    saveToBackend(updated, favorites);
  };

  return (
    <AppContext.Provider
      value={{
        cart,
        favorites,
        setCart,
        setFavorites,
      setToken,
        addToCart,
        addToFavorites,
        removeFromCart,
        removeFromFavorites,
        increaseQuantity,
        decreaseQuantity
      }}
    >
      {children}
    </AppContext.Provider>
  );
};
