/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Our own worker (src/sw.js) instead of a generated one, so it can
      // also show Web Push desktop notifications. It keeps the generated
      // worker's caching behaviour (precache + index.html fallback).
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      includeAssets: ['favicon.ico', 'icons/apple-touch-icon.png'],
      // App-shell + static asset caching only (installability + fast
      // repeat loads). No runtimeCaching for the Supabase API — leads,
      // proposals, chat, etc. must always hit the network, never a stale
      // cached response.
      manifest: {
        name: 'AFC India Limited',
        short_name: 'AFC India',
        description: 'AFC India Limited — leads, proposals, empanelment, and knowledge repository portal.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#0a2a25',
        theme_color: '#0a2a25',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.js',
    // supabase/functions has its own Deno-based test suite (jsr: imports,
    // run via `deno task test`) — Vite can't resolve those, so keep this
    // runner scoped to the frontend.
    include: ['src/**/*.{test,spec}.{js,jsx,ts,tsx}'],
  },
})
