import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    allowedHosts: ['14a63df5.r32.cpolar.top'],
    proxy: {
        '/api': 'http://localhost:3001',
        '/ws': { target: 'ws://localhost:3001', ws: true },
    },
    },
  },
)
