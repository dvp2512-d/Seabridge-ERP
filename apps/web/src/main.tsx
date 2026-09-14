import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import App from './App';
import './index.css';

/**
 * React Query Configuration for Performance
 * 
 * - staleTime: How long data is considered fresh (no refetch)
 * - gcTime: How long inactive data stays in cache
 * - refetchOnWindowFocus: Disabled to prevent unnecessary requests
 * - refetchOnReconnect: Enabled to get fresh data after network recovery
 * - retry: Limited to 1 retry to fail fast on real errors
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Data is fresh for 5 minutes - no refetch needed
      staleTime: 5 * 60 * 1000,
      // Keep inactive data in cache for 30 minutes
      gcTime: 30 * 60 * 1000,
      // Don't refetch when window regains focus (reduces flicker)
      refetchOnWindowFocus: false,
      // Refetch when reconnecting after being offline
      refetchOnReconnect: 'always',
      // Only retry once to fail fast on real errors
      retry: 1,
      // Retry after 1 second
      retryDelay: 1000,
    },
    mutations: {
      // Retry mutations once
      retry: 1,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
        <Toaster 
          position="top-right"
          toastOptions={{
            duration: 4000,
            style: {
              background: '#1e3a5f',
              color: '#fff',
            },
          }}
        />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
