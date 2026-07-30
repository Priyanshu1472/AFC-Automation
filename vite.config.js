/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
