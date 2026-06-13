import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react(), tailwindcss()],
    server: {
      proxy: {
        '/api/foundry': {
          target: env.VITE_AZURE_FOUNDRY_URL,
          changeOrigin: true,
          rewrite: () => '',
          headers: {
            'api-key': env.VITE_AZURE_FOUNDRY_KEY
          }
        }
      }
    }
  }
})