import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        background: 'background.js'
      },
      output: {
        entryFileNames: 'background.bundle.js'
      }
    },
    outDir: './dist',
    emptyOutDir: false,
    target: 'esnext',
  }
}); 