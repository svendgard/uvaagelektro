import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// DEMO=true: prototype med fiktive data. ARTIFACT=true: én selvstendig HTML-fil (forhåndsvisning).
// Standard: produksjonsbygg uten eksempeldata, servert av server/index.ts bak innlogging.
const demo = process.env.DEMO === 'true';
const artifact = process.env.ARTIFACT === 'true';

export default defineConfig({
  define: { __DEMO__: JSON.stringify(demo) },
  plugins: [react(), ...(artifact ? [viteSingleFile()] : [])],
  server: { proxy: { '/api': 'http://localhost:3000' } },
  build: {
    rollupOptions: {
      // Eksempeldata har ingen sideeffekter, så den fjernes helt når DEMO er av.
      treeshake: { moduleSideEffects: (id) => !/\/src\/(data|adapters)\//.test(id) },
    },
  },
});
