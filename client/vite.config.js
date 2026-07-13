import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  assetsInclude: ['**/*.vox'], // 体素资产按 URL 引入(VoxLab/VOXEL_PLAN P0)
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
