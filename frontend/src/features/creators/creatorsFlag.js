// src/features/creators/creatorsFlag.js
//
// Flagul frontend Artfest Creators (oprit implicit). Modul separat și minuscul:
// paginile existente (dashboardul influencerului, App, Admin) îl pot importa fără
// să tragă în bundle restul codului Creators (care se încarcă lazy).
export const CREATORS_ENABLED = String(import.meta.env.VITE_CREATORS_ENABLED || "").trim() === "1";
