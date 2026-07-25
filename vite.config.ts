import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    // Mirror the production setup (HouseGraph reverse-proxies /bridge -> the bridge)
    // so the app can call same-origin `/bridge/*` in dev too — no CORS, no bridge.local.
    proxy: {
      '/bridge': {
        // 127.0.0.1, not localhost: on Windows localhost can resolve to IPv6 ::1
        // while the bridge listens on IPv4 only, which would fail the proxy.
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/bridge/, ''),
      },
    },
  },
})
