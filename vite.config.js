import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        background: 'background.js'
      },
      output: {
        entryFileNames: 'background.bundle.js',
        format: 'es'
      }
    },
    outDir: './dist',
    emptyOutDir: false,
    target: 'esnext',
  },
  optimizeDeps: {
    exclude: ['pdf-lib']
  }
}); 