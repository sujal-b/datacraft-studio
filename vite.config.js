import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // This allows requests from your ngrok tunnel
    allowedHosts: ['97d99fca3ac3.ngrok-free.app'],
  },
})