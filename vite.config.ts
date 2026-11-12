import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  define: {
    'import.meta.env.VITE_QUALITYHUB_UPDATE_URL': "\"https://raw.githubusercontent.com/leokowales/quality-hub-access-bat/main/latest.json\"",
    'import.meta.env.VITE_QUALITYHUB_TEST_CHANNEL': '"1"',
  },
  plugins: [react()],
})
