import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: (id: string) => {
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/')) return 'vendor';
          if (id.includes('node_modules/@radix-ui/react-dialog') ||
              id.includes('node_modules/@radix-ui/react-tabs') ||
              id.includes('node_modules/@radix-ui/react-tooltip') ||
              id.includes('node_modules/@radix-ui/react-select')) return 'ui';
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
      '/subscription.txt': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
      '/clash.yaml': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
      '/raw.txt': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
    },
  },
});
