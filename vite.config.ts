import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Após o build, grava em dist/sw.js a lista de arquivos a pré-carregar e uma versão
 * derivada do conteúdo: qualquer byte alterado gera nova versão (o navegador detecta a atualização).
 * ponytail: substitui vite-plugin-pwa/Workbox por ~20 linhas; migrar se precisar de estratégias por rota.
 */
function pwaPrecache(): Plugin {
  return {
    name: 'pistec-pwa-precache', apply: 'build',
    closeBundle() {
      const dist = 'dist';
      const walk = (dir: string): string[] => readdirSync(dir).flatMap(f => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
      // Capturas da landing ficam fora: não são necessárias offline e pesam ~1,5 MB.
      const files = walk(dist).map(p => '/' + relative(dist, p).replace(/\\/g, '/')).filter(u => u !== '/sw.js' && !u.startsWith('/screenshots/')).sort();
      const hash = createHash('sha256'); for (const f of files) hash.update(f).update(readFileSync(join(dist, f)));
      const sw = join(dist, 'sw.js');
      writeFileSync(sw, readFileSync(sw, 'utf8').replace("'__VERSION__'", JSON.stringify(hash.digest('hex').slice(0, 12))).replace('[/*__PRECACHE__*/]', JSON.stringify(files)));
    },
  };
}

export default defineConfig({ plugins: [react(), pwaPrecache()], test: { include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'supabase/tests/**/*.test.ts'] }, build: { chunkSizeWarningLimit: 600 } });
