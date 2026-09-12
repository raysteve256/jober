import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Job Discovery',
        short_name: 'JobDiscovery',
        description: 'AI job discovery — asks the right question, finds the right roles.',
        theme_color: '#2563eb',
        background_color: '#f9fafb',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        // Cache the app shell so the chat UI (and last-seen results,
        // via Dexie separately) still opens with no signal -- matches
        // the offline-first pattern used elsewhere in the product suite.
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        runtimeCaching: [
          {
            // Never cache the reasoning call itself -- a stale AI
            // response is worse than a clear "you're offline" state.
            urlPattern: /\/\.netlify\/functions\/reason/,
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
  server: {
    proxy: {
      '/.netlify/functions': 'http://localhost:8888',
    },
  },
})
