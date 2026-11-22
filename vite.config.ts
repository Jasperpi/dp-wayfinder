import { defineConfig, type Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Inject all built static assets (including campus-map.png for offline Printed Map mode)
 * into dist/sw.js so the very first load precaches the entire app for zero-signal use.
 */
function swPrecachePlugin(): Plugin {
  return {
    name: 'sw-precache-inject',
    apply: 'build',
    closeBundle() {
      const distDir = path.resolve(__dirname, 'dist');
      const swPath = path.join(distDir, 'sw.js');
      if (!fs.existsSync(swPath)) return;

      const assetsDir = path.join(distDir, 'assets');
      const urls = ['./', './index.html', './manifest.webmanifest', './icon.svg', './campus-map.png'];
      if (fs.existsSync(assetsDir)) {
        for (const f of fs.readdirSync(assetsDir)) {
          urls.push(`./assets/${f}`);
        }
      }

      const src = fs.readFileSync(swPath, 'utf-8');
      const cacheTag = `dp-wayfinder-${Date.now().toString(36)}`;
      const updated = src
        .replace('/*__PRECACHE_URLS__*/[]', JSON.stringify(urls))
        .replace('/*__CACHE_VERSION__*/dp-wayfinder-v2', cacheTag);
      fs.writeFileSync(swPath, updated, 'utf-8');
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [swPrecachePlugin()],
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsInlineLimit: 4096,
  },
  server: {
    host: '127.0.0.1',
    port: 4173,
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
  },
});
