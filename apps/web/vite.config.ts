import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative base so the build works on GitHub Pages or any static host.
  base: './',
  plugins: [react()],
  worker: { format: 'es' },
  server: { port: 5181 },
  preview: { port: 4181 },
});
