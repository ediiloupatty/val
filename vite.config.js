import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Target modern browsers for smaller, faster output.
    target: 'esnext',
    rollupOptions: {
      output: {
        // Split Three.js and React into separate chunks so the browser can
        // cache them independently and the initial JS parse is cheaper.
        manualChunks: {
          three: ['three'],
          react: ['react', 'react-dom'],
        },
      },
    },
  },
});
