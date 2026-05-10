import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      manifest: {
        id: '/band/',
        name: 'Band Manager',
        short_name: 'Band',
        description: 'Gestione del repertorio della tua band',
        start_url: '/band/',
        scope: '/band/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#1e293b',
        background_color: '#1e293b',
        icons: [
          {
            src: '/band/icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any'
          },
          {
            src: '/band/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any maskable'
          },
          {
            src: '/band/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        navigateFallbackDenylist: [/^\/band\/api/],
        runtimeCaching: [
          {
            urlPattern: /\/band\/api\//,
            handler: 'NetworkOnly'
          }
        ]
      }
    })
  ],
  base: '/band/',
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8001',
        changeOrigin: true,
      },
    },
  },
})
