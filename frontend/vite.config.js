// vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: true,          // permite acces din LAN
    port: 5173,
    open: true,
    proxy: {
      // API-ul backend-ului
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        secure: false,
        ws: true,
      },
      // (opțional) pentru Socket.IO, dacă îl folosești
      '/socket.io': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        ws: true,
      },
      // (opțional) fișiere servite de backend (ex. /uploads/...)
      '/uploads': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        secure: false,
      },
    },
  },
})
