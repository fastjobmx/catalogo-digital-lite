import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      // Development only. An https target (e.g. the staging Worker) needs its own Host header.
      '/api': { target: process.env.VITE_API_PROXY || 'http://localhost:8788', changeOrigin: true },
    },
  },
})