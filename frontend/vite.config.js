import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],

  server: {
    port: 5173,

    proxy: {
      "/api": {
        target: "http://localhost:5000",
        changeOrigin: true,
      },

      "/legal": {
        target: "http://localhost:5000",
        changeOrigin: true,
      },

      "/termenii-si-conditiile": {
        target: "http://localhost:5000",
        changeOrigin: true,
      },

      "/confidentialitate": {
        target: "http://localhost:5000",
        changeOrigin: true,
      },

      "/cookies": {
        target: "http://localhost:5000",
        changeOrigin: true,
      },

      "/acord-vanzatori": {
        target: "http://localhost:5000",
        changeOrigin: true,
      },

      "/acord-influenceri": {
        target: "http://localhost:5000",
        changeOrigin: true,
      },

      "/politica-retur": {
        target: "http://localhost:5000",
        changeOrigin: true,
      },

      "/anexa-expediere": {
        target: "http://localhost:5000",
        changeOrigin: true,
      },

      "/anexa-produse": {
        target: "http://localhost:5000",
        changeOrigin: true,
      },
    },
  },
});