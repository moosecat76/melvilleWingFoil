import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // Listen on all local IP addresses
    allowedHosts: true, // Allow all hosts to prevent "Host not allowed" errors
  },
  test: {
    environment: 'happy-dom',
    setupFiles: './src/test/setup.js',
    globals: true,
    testTimeout: 15000,
  },
})
