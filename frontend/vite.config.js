import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { readFileSync } from 'fs'

const { version } = JSON.parse(readFileSync('./package.json', 'utf-8'))

// Percorso base dell'app (con slash finale). Default /band/; override: VITE_BASE=/ npm run build
const BASE = process.env.VITE_BASE ?? '/band/'

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  base: BASE,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        runtimeCaching: [
          {
            urlPattern: new RegExp(`${BASE}api/`),
            handler: 'NetworkOnly',
          },
        ],
      },
      manifest: {
        name: 'Band Manager',
        short_name: 'Band',
        description: 'Gestione del repertorio della tua band',
        theme_color: '#1e293b',
        background_color: '#1e293b',
        display: 'standalone',
        orientation: 'portrait',
        lang: 'it',
        id: BASE,
        start_url: BASE,
        scope: BASE,
        icons: [
          { src: `${BASE}icon-192.png`,          sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: `${BASE}icon-512.png`,          sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: `${BASE}icon-maskable-192.png`, sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: `${BASE}icon-maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8001',
        changeOrigin: true,
      },
    },
  },
})
