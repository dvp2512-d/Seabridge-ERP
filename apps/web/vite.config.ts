import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    proxy: {
      // In development the API runs separately; forward /api to it so the
      // frontend can use relative URLs and avoid CORS entirely.
      '/api': {
        target: process.env.VITE_PROXY_TARGET || 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  build: {
    // Split vendor code so the initial download stays small and browser caching
    // survives application-code deploys.
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          query: ['@tanstack/react-query', 'axios', 'zustand'],
          charts: ['recharts'],
          ui: ['lucide-react', 'react-hot-toast', 'clsx', 'tailwind-merge'],
          forms: ['react-hook-form', '@hookform/resolvers', 'zod'],
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
});
