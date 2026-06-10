/**
 * Client-side "clean export" for imported WordPress/Astra/Elementor sites.
 *
 * The Buildly project stores each imported page as a standalone, minified HTML
 * file in which the full header, navigation and footer are repeated verbatim.
 * This module turns that raw import into a tidy, maintainable Astro project:
 * one shared header/footer/layout, per-page <head> + content fragments, clean
 * internal routes that mirror the original permalinks, and the dead WordPress
 * plumbing (wp-json, feeds, oembed, xmlrpc, pingback, generator) stripped.
 *
 * It is faithful, not lossy: the original design (external stylesheets + inline
 * CSS) and the page content are carried over byte-for-byte. Nothing here ever
 * mutates the stored project — it builds a fresh file tree on the fly at
 * download time.
 *
 * If the project does not look like an Astra/Elementor import (no index.html,
 * or the expected markup markers are missing), `buildAstroExport` returns null
 * so the caller can fall back to the plain formatted-source download.
 *
 * This is a TypeScript port of refactor-work/build-site.mjs, generalised to
 * derive the site's domain and permalinks from each page's own
 * <link rel="canonical"> instead of an external page map.
 */

export interface ExportFile {
  path: string;
  content: string | null;
}

const HEADER_MARKER = '<header data-elementor-type="header"';
const FOOTER_MARKER = '<footer class="site-footer"';
const PAGE_MARKER = '<div class="hfeed site" id="page">';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function canonicalHref(html: string): string | null {
  const m = html.match(/<link\b[^>]*\brel=["']canonical["'][^>]*>/i);
  if (!m) return null;
  const href = m[0].match(/href=["']([^"']+)["']/i);
  return href ? href[1] : null;
}

function decodeAttr(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&#x27;/gi, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

interface SeoTag {
  tag: 'meta' | 'link';
  attrs: Record<string, string>;
}

function extractSeo(head: string): { title: string; tags: SeoTag[]; head: string } {
  const tags: SeoTag[] = [];
  let h = head;
  const title = ((h.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').trim();
  h = h.replace(/<title[^>]*>[\s\S]*?<\/title>/i, '');
  h = h.replace(/<link\b[^>]*\brel=["']canonical["'][^>]*>/gi, (m) => {
    const href = (m.match(/href=["']([^"']+)/i) || [])[1];
    if (href) tags.push({ tag: 'link', attrs: { rel: 'canonical', href } });
    return '';
  });
  h = h.replace(/<meta\b[^>]*\bname=["'](description|robots)["'][^>]*>/gi, (m, name) => {
    const c = (m.match(/content=["']([\s\S]*?)["']/i) || [])[1] || '';
    tags.push({ tag: 'meta', attrs: { name, content: decodeAttr(c) } });
    return '';
  });
  h = h.replace(/<meta\b[^>]*\bproperty=["'](og:[^"']+|article:[^"']+)["'][^>]*>/gi, (m, prop) => {
    const c = (m.match(/content=["']([\s\S]*?)["']/i) || [])[1] || '';
    tags.push({ tag: 'meta', attrs: { property: prop, content: decodeAttr(c) } });
    return '';
  });
  h = h.replace(/<meta\b[^>]*\bname=["'](twitter:[^"']+)["'][^>]*>/gi, (m, name) => {
    const c = (m.match(/content=["']([\s\S]*?)["']/i) || [])[1] || '';
    tags.push({ tag: 'meta', attrs: { name, content: decodeAttr(c) } });
    return '';
  });
  h = h.replace(/<meta\b[^>]*\bcharset=[^>]*>/gi, '');
  h = h.replace(/<meta\b[^>]*\bname=["']viewport["'][^>]*>/gi, '');
  return { title: decodeAttr(title), tags, head: h };
}

function cleanHead(head: string): string {
  let h = head.replace(/<!--[\s\S]*?-->/g, '');
  const drop = [
    /<link[^>]+rel=["']EditURI["'][^>]*>/gi,
    /<link[^>]+rel=["']wlwmanifest["'][^>]*>/gi,
    /<link[^>]+rel=["']pingback["'][^>]*>/gi,
    /<link[^>]+rel=["']shortlink["'][^>]*>/gi,
    /<link[^>]+rel=["']https:\/\/api\.w\.org\/["'][^>]*>/gi,
    /<link[^>]+type=["']application\/json\+oembed["'][^>]*>/gi,
    /<link[^>]+type=["']text\/xml\+oembed["'][^>]*>/gi,
    /<link[^>]+href=["'][^"']*\/wp-json\/[^"']*["'][^>]*>/gi,
    /<link[^>]+type=["']application\/rss\+xml["'][^>]*>/gi,
    /<link[^>]+rel=["']dns-prefetch["'][^>]*>/gi,
    /<link[^>]+rel=["']profile["'][^>]*>/gi,
    /<meta[^>]+name=["']generator["'][^>]*>/gi,
  ];
  for (const re of drop) h = h.replace(re, '');
  return h.replace(/\n{2,}/g, '\n').trim();
}

function makeLinkRewriter(host: string, localPaths: Set<string>): (html: string) => string {
  const re = new RegExp(
    `(href=")(https?://(?:www\\.)?${escapeRegExp(host)})(/[^"]*)?(")`,
    'gi',
  );
  return (html: string) =>
    html.replace(re, (m, p1, _dom, p3, q) => {
      const full = p3 || '/';
      const cut = full.search(/[?#]/);
      const basePath = cut === -1 ? full : full.slice(0, cut);
      const suffix = cut === -1 ? '' : full.slice(cut);
      if (basePath === '/' || basePath === '') return p1 + '/' + suffix + q;
      const withSlash = basePath.endsWith('/') ? basePath : basePath + '/';
      if (localPaths.has(withSlash)) return p1 + withSlash + suffix + q;
      return m;
    });
}

function routeToAstroPath(route: string): string {
  return route === '/' || route === '' ? 'index' : route.replace(/^\/|\/$/g, '');
}

function routeToSlug(route: string): string {
  return route === '/' || route === ''
    ? 'index'
    : route.replace(/^\/|\/$/g, '').replace(/\//g, '__');
}

function hostFromCanonical(href: string): string | null {
  try {
    return new URL(href).hostname.replace(/^www\./i, '');
  } catch {
    return null;
  }
}

function pathFromCanonical(href: string): string | null {
  try {
    return new URL(href).pathname || '/';
  } catch {
    return null;
  }
}

// ---- static scaffolding templates ------------------------------------------

const TPL_GITIGNORE = `node_modules/
dist/
.astro/
.DS_Store
`;

const TPL_TSCONFIG = `{
  "extends": "astro/tsconfigs/strict",
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@layouts/*": ["src/layouts/*"],
      "@components/*": ["src/components/*"],
      "@data/*": ["src/page-data/*"],
      "@lib/*": ["src/lib/*"]
    }
  }
}
`;

const TPL_SEO_ASTRO = `---
// Herbruikbaar SEO-component. Rendert de per-pagina meta-tags (title,
// description, robots, canonical, Open Graph) die uit de originele pagina's
// zijn gehaald. Zo blijven de SEO-gegevens per pagina exact behouden.
interface SeoTag {
  tag: 'meta' | 'link';
  attrs: Record<string, string>;
}
interface Props {
  title?: string;
  tags?: SeoTag[];
}
const { title = '', tags = [] } = Astro.props;
---
<title>{title}</title>
{
  tags.map((t) =>
    t.tag === 'link' ? <link {...t.attrs} /> : <meta {...t.attrs} />
  )
}
`;

const TPL_HEADER_ASTRO = `---
// Gedeelde site-header (logo + navigatie), één keer gedefinieerd in plaats van
// herhaald op elke pagina. De originele Elementor-markup blijft ongewijzigd;
// alleen het actieve menu-item wordt per route gezet.
import raw from './header.html?raw';
import { markActive } from '@lib/markActive.js';
const { route = '/' } = Astro.props;
const html = markActive(raw, route);
---
<Fragment set:html={html} />
`;

const TPL_FOOTER_ASTRO = `---
// Gedeelde site-footer, één keer gedefinieerd. Originele Astra-markup blijft
// ongewijzigd; alleen het actieve menu-item wordt per route gezet.
import raw from './footer.html?raw';
import { markActive } from '@lib/markActive.js';
const { route = '/' } = Astro.props;
const html = markActive(raw, route);
---
<Fragment set:html={html} />
`;

const TPL_BASE_LAYOUT = `---
// Gedeelde paginalayout: HTML-skelet + gedeelde header/footer + per-pagina
// <head> en inhoud. De originele opmaak (externe stylesheets + inline CSS)
// wordt 1-op-1 als ruwe HTML ingevoegd, zodat het ontwerp identiek blijft.
import Seo from '@components/Seo.astro';
import Header from '@components/Header.astro';
import Footer from '@components/Footer.astro';
import beforePage from '@data/_shell/before.html?raw';
import afterPage from '@data/_shell/after.html?raw';

interface Props {
  seo: { title?: string; tags?: { tag: 'meta' | 'link'; attrs: Record<string, string> }[] };
  headInner?: string;
  content?: string;
  bodyClass?: string;
  route?: string;
}
const { seo, headInner = '', content = '', bodyClass = '', route = '/' } = Astro.props;
---
<!doctype html>
<html lang="nl-NL">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <Seo title={seo.title} tags={seo.tags} />
    <Fragment set:html={headInner} />
  </head>
  <body class={bodyClass}>
    <Fragment set:html={beforePage} />
    <div class="hfeed site" id="page">
      <Header route={route} />
      <Fragment set:html={content} />
      <Footer route={route} />
    </div>
    <Fragment set:html={afterPage} />
  </body>
</html>
`;

const TPL_MARK_ACTIVE = `/**
 * Markeert het actieve menu-item voor de huidige route.
 *
 * In de originele WordPress-export had elke pagina haar eigen header/footer met
 * de juiste \`current-menu-item\`-klasse al ingebakken. Wij gebruiken nu één
 * gedeelde header/footer en zetten die actieve staat hier per route.
 *
 * @param {string} html   De (gedeelde) header- of footer-HTML.
 * @param {string} route  De huidige route, bv. "/pilates/".
 * @returns {string}
 */
export function markActive(html, route) {
  if (!route) return html;
  const liRe =
    /(<li\\b[^>]*\\bclass=")([^"]*\\bmenu-item\\b[^"]*)("[^>]*>\\s*<a\\b)([^>]*\\bhref=")([^"]*)(")/gi;
  return html.replace(liRe, (m, p1, cls, p3, aPre, href, qEnd) => {
    if (href !== route) return m;
    if (/\\bcurrent-menu-item\\b/.test(cls)) return m;
    return (
      p1 + cls + ' current-menu-item current_page_item' + p3 + aPre + href + qEnd + ' aria-current="page"'
    );
  });
}
`;

function tplAstroConfig(siteOrigin: string): string {
  return `import { defineConfig } from 'astro/config';

// Statische site-generatie. We bewaren de originele permalink-structuur
// (met trailing slash) zodat SEO en interne links identiek blijven aan WordPress.
export default defineConfig({
  site: '${siteOrigin}',
  trailingSlash: 'always',
  build: { format: 'directory' },
});
`;
}

function tplPackageJson(name: string): string {
  return `${JSON.stringify(
    {
      name,
      type: 'module',
      version: '1.0.0',
      private: true,
      scripts: {
        dev: 'astro dev',
        build: 'astro build',
        preview: 'astro preview',
      },
      devDependencies: {
        astro: '^5.13.0',
      },
    },
    null,
    2,
  )}\n`;
}

function tplReadme(siteName: string, host: string, routes: string[]): string {
  const examples = routes
    .filter((r) => r !== '/')
    .slice(0, 6)
    .map((r) => '`' + r + '`')
    .join(', ');
  return `# ${siteName} — opgeschoonde website

Dit is de geherstructureerde versie van ${host}. De oorspronkelijke export
bestond uit losse HTML-pagina's waarin de volledige header, navigatie en footer
op elke pagina opnieuw stonden (veel herhaalde code). Hier is dat teruggebracht
tot één gedeelde header, footer, layout en SEO-component — zonder iets aan het
ontwerp of de teksten te veranderen.

## Snel starten

\`\`\`bash
npm install
npm run dev      # ontwikkelserver met live preview
npm run build    # bouwt de statische site naar ./dist
npm run preview  # bekijk de gebouwde site lokaal
\`\`\`

Vereist Node.js 18 of nieuwer.

## Structuur

\`\`\`
src/
  pages/        Eén bestand per pagina (dunne wrappers). De mappen volgen exact
                de originele permalinks.
  layouts/      BaseLayout.astro — het gedeelde HTML-skelet (head + body).
  components/   Header.astro, Footer.astro, Seo.astro + de ruwe header/footer-HTML.
  lib/          markActive.js — zet het juiste actieve menu-item per pagina.
  page-data/    Per pagina de bewaarde <head> (stijlen) en de pagina-inhoud,
                plus de gedeelde body-omhulling (_shell).
public/         Statische bestanden die rechtstreeks worden geserveerd.
\`\`\`

## Routes

De nette, leesbare routes komen overeen met de originele WordPress-permalinks,
zodat alle bestaande links en SEO blijven kloppen.${examples ? ` Voorbeelden: ${examples}.` : ''}

## Belangrijke keuzes

- **Ontwerp 1-op-1 behouden.** De originele opmaak (externe stylesheets én de
  inline-CSS) is per pagina exact overgenomen, in dezelfde volgorde.
- **SEO per pagina intact.** Title, meta-description, robots, canonical en
  Open Graph-tags zijn per pagina bewaard via het \`Seo\`-component.
- **WordPress-rommel verwijderd.** Dode verwijzingen zoals \`wp-json\`, RSS-feeds,
  \`oembed\`, \`xmlrpc\`, pingback en generator-tags zijn weggehaald.
- **Interne links opgeschoond.** Verwijzingen naar de eigen site wijzen nu naar
  de lokale, nette routes.
- **Afbeeldingen.** De media (foto's, logo) worden nog steeds vanaf ${host}
  geladen — de beeldbestanden zaten niet in de export. Wil je de site volledig
  los van het oude domein? Download dan de afbeeldingen naar \`public/\` en pas de
  verwijzingen aan.
`;
}

// ---- main -------------------------------------------------------------------

/**
 * Build a clean Astro project from raw imported WordPress/Astra/Elementor
 * pages. Returns a map of relative output path -> file content, or null if the
 * project does not look like a supported import.
 */
export function buildAstroExport(files: ExportFile[]): Map<string, string> | null {
  const byPath = new Map<string, string>();
  for (const f of files) byPath.set(f.path, f.content ?? '');

  const index = byPath.get('index.html');
  if (
    !index ||
    !index.includes(HEADER_MARKER) ||
    !index.includes(FOOTER_MARKER) ||
    !index.includes(PAGE_MARKER)
  ) {
    return null;
  }

  const indexCanonical = canonicalHref(index);
  if (!indexCanonical) return null;
  const host = hostFromCanonical(indexCanonical);
  if (!host) return null;
  const siteOrigin = `https://${host}`;

  // Only the .html pages participate; keep deterministic ordering.
  const pages = files
    .filter((f) => f.path.endsWith('.html'))
    .sort((a, b) => a.path.localeCompare(b.path));

  // Build the set of local permalinks from every page's canonical.
  const canonByPath = new Map<string, string>();
  const localPaths = new Set<string>();
  for (const f of pages) {
    const href = canonicalHref(f.content ?? '');
    const route = href ? pathFromCanonical(href) : null;
    const finalRoute = route || '/';
    canonByPath.set(f.path, finalRoute);
    localPaths.add(finalRoute);
  }

  const rewriteLinks = makeLinkRewriter(host, localPaths);

  const out = new Map<string, string>();

  // ---- shared shell / header / footer from index baseline ----
  const sh = index.indexOf(HEADER_MARKER);
  const headerRaw = index.slice(sh, index.indexOf('</header>', sh) + 9);
  const ft = index.indexOf(FOOTER_MARKER);
  const footerEnd = index.indexOf('</footer>', ft) + 9;
  const footerRaw = index.slice(ft, footerEnd);

  out.set('src/components/header.html', rewriteLinks(headerRaw).trim());
  out.set('src/components/footer.html', rewriteLinks(footerRaw).trim());

  const bodyOpen = index.search(/<body[^>]*>/i);
  const bodyOpenEnd = index.indexOf('>', bodyOpen) + 1;
  const pageOpenIdx = index.indexOf(PAGE_MARKER);
  const beforePage = index
    .slice(bodyOpenEnd, pageOpenIdx)
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim();
  const bodyClose = index.lastIndexOf('</body>');
  const afterPage = index
    .slice(footerEnd, bodyClose)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^\s*<\/div>/, '')
    .trim();

  out.set('src/page-data/_shell/before.html', beforePage);
  out.set('src/page-data/_shell/after.html', afterPage);

  // ---- per-page ----
  const routes: string[] = [];
  for (const f of pages) {
    const h = f.content ?? '';
    const route = canonByPath.get(f.path) || '/';
    const slug = routeToSlug(route);

    const headFull = (h.match(/<head[^>]*>([\s\S]*?)<\/head>/i) || ['', ''])[1];
    const seoResult = extractSeo(headFull);
    const headInner = rewriteLinks(cleanHead(seoResult.head));
    const bodyClass = (h.match(/<body[^>]*\bclass="([^"]*)"/i) || ['', ''])[1];

    const shp = h.indexOf(HEADER_MARKER);
    const fStart = h.indexOf(FOOTER_MARKER);
    let content: string;
    if (shp !== -1 && fStart !== -1) {
      const cStart = h.indexOf('</header>', shp) + 9;
      content = rewriteLinks(h.slice(cStart, fStart)).trim();
    } else {
      // Page without the expected markers: keep its full body inner so nothing
      // is lost (the layout still wraps it with the shared header/footer).
      const bo = h.search(/<body[^>]*>/i);
      const boEnd = bo === -1 ? 0 : h.indexOf('>', bo) + 1;
      const bc = h.lastIndexOf('</body>');
      content = rewriteLinks(h.slice(boEnd, bc === -1 ? undefined : bc)).trim();
    }

    out.set(`src/page-data/${slug}.head.html`, headInner);
    out.set(`src/page-data/${slug}.content.html`, content);
    out.set(
      `src/page-data/${slug}.meta.json`,
      JSON.stringify({ route, bodyClass, seo: { title: seoResult.title, tags: seoResult.tags } }, null, 1),
    );

    const astroPath = routeToAstroPath(route);
    const astro =
      `---\n` +
      `import BaseLayout from '@layouts/BaseLayout.astro';\n` +
      `import headInner from '@data/${slug}.head.html?raw';\n` +
      `import content from '@data/${slug}.content.html?raw';\n` +
      `import meta from '@data/${slug}.meta.json';\n` +
      `---\n` +
      `<BaseLayout headInner={headInner} content={content} seo={meta.seo} bodyClass={meta.bodyClass} route={meta.route} />\n`;
    out.set(`src/pages/${astroPath}.astro`, astro);
    routes.push(route);
  }

  // ---- static scaffolding ----
  const siteName = host.replace(/\.[a-z]+$/i, '').replace(/(^|[-.])([a-z])/g, (_m, sep, ch) => sep + ch.toUpperCase());
  const pkgName = host.replace(/[^a-z0-9]+/gi, '-').toLowerCase();

  out.set('src/components/Header.astro', TPL_HEADER_ASTRO);
  out.set('src/components/Footer.astro', TPL_FOOTER_ASTRO);
  out.set('src/components/Seo.astro', TPL_SEO_ASTRO);
  out.set('src/layouts/BaseLayout.astro', TPL_BASE_LAYOUT);
  out.set('src/lib/markActive.js', TPL_MARK_ACTIVE);
  out.set('public/.gitkeep', '');
  out.set('astro.config.mjs', tplAstroConfig(siteOrigin));
  out.set('tsconfig.json', TPL_TSCONFIG);
  out.set('.gitignore', TPL_GITIGNORE);
  out.set('package.json', tplPackageJson(pkgName));
  out.set('README.md', tplReadme(siteName, host, routes));

  return out;
}
