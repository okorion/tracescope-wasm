import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: process.env.VITE_BASE_PATH || '/tracescope-wasm/',
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5179, strictPort: true },
  preview: { port: 4179, strictPort: true },
  build: { target: 'es2022', assetsInlineLimit: 0 },
});
