import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

const isDocs = process.env.BUILD_TARGET === 'docs';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: isDocs ? '/jobfitcopilot/' : '/',
  resolve: {
    alias: { '@': path.resolve(new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), 'src') },
  },
  build: {
    outDir: isDocs ? '../docs' : '../server/public',
    emptyOutDir: isDocs,
    assetsDir: 'assets',
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8765',
      '/mcp': 'http://127.0.0.1:8765',
    },
  },
});
