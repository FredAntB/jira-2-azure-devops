import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

 export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',  // Permite acceso desde fuera del contenedor
    port: 5173,       // Usa el puerto correcto
    strictPort: true  // Evita que Vite cambie de puerto automáticamente
}
});
