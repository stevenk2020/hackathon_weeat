import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({mode}) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  if (mode === 'production' && (env.VITE_API_MODE === 'mock' || env.VITE_ENABLE_TEST_AUTH === 'true')) throw new Error('Production forbids mock mode and test authentication.');
  return { plugins: [react()], server: {port: 5173, strictPort: true}, build: {sourcemap: false} };
});
