// src/config/features.js

/*
 * Feature flags frontend (constante de build, fără logică de runtime).
 *
 * VENDOR_COURIERS_ENABLED - integrarea de curierat pentru vendori
 * (conturi de curier, adrese de ridicare, „Generează AWB”, etichete).
 * PE PAUZĂ înainte de deploy: backend-ul și infrastructura rămân în
 * proiect, dar niciun punct de acces din UI nu e activ.
 *
 * Unde e folosit (reactivare = true aici, nimic altceva):
 *   - config/vendorNavigation.js           itemul „Curieri” din meniul vendor
 *   - components/Navbar/Navbar.jsx         linkul „Curieri” din dropdown-ul avatarului
 *   - Settings/couriers/CourierSettings    secțiunea din Setări (altfel: „Funcție disponibilă în curând”)
 *   - Orders/components/CourierConnectCta  CTA „Conectează un curier” (Comenzi + detaliu)
 *   - Orders/components/AwbPanel           „Generează AWB” / „Descarcă eticheta”
 */
export const VENDOR_COURIERS_ENABLED = false;
