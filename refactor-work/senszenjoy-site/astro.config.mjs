import { defineConfig } from 'astro/config';

// Statische site-generatie. We bewaren de originele permalink-structuur
// (met trailing slash) zodat SEO en interne links identiek blijven aan WordPress.
export default defineConfig({
  site: 'https://senszenjoy.nl',
  trailingSlash: 'always',
  build: { format: 'directory' },
});
