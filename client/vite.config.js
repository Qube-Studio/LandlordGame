import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tutorialApi from './tools/tutorial-api.vite.mjs' // 教程编辑器 2.0 文件 IO（dev-only，EDITOR_OVERHAUL §1.1）

export default defineConfig({
  plugins: [react(), tutorialApi()],
  assetsInclude: ['**/*.vox'], // 体素资产按 URL 引入(VoxLab/VOXEL_PLAN P0)
  // 双轨 E2E 各用独立依赖预构建缓存，防 Windows 下 deps rename EPERM 竞态（EDITOR_OVERHAUL §3）
  cacheDir: process.env.VITE_CACHE_DIR || 'node_modules/.vite',
  server: {
    port: 5173,
    allowedHosts: ['14a63df5.r32.cpolar.top'],
    // 编辑器上传图片入 public/tutorial/ 不触发全页 reload（图片仍按请求实时读盘）
    watch: { ignored: ['**/public/tutorial/**'] },
    proxy: {
        '/api': 'http://localhost:3001',
        '/ws': { target: 'ws://localhost:3001', ws: true },
    },
    },
  },
)
