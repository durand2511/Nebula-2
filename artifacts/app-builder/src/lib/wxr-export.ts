/**
 * Client-side "WordPress importable package" export for imported
 * WordPress/Astra/Elementor sites.
 *
 * Instead of (or alongside) a static download, this turns the raw imported
 * pages into a WordPress eXtended RSS (WXR) file — the exact format WordPress
 * reads under Tools → Import → WordPress. Each page becomes a published `page`
 * post with its original title, slug, content, meta description and internal
 * links preserved. The original permalink hierarchy is reproduced with real
 * parent/child pages (post_parent), so nested URLs like /category/mindfulness/
 * resolve exactly as before and the internal links keep working. A Dutch README
 * with step-by-step import instructions is bundled alongside it.
 *
 * The package is built fresh at download time; it never mutates the stored
 * project. If the project does not look like a supported import (no index.html
 * or the expected markup markers are missing), `buildWordPressExport` returns
 * null so the caller can fall back to the plain formatted-source download.
 */

export interface ExportFile {
  path: string;
  content: string | null;
}

const HEADER_MARKER = '<header data-elementor-type="header"';
const FOOTER_MARKER = '<footer class="site-footer"';
const PAGE_MARKER = '<div class="hfeed site" id="page">';

/** Escape text for use in a non-CDATA XML text node or attribute value. */
function xmlEscape(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Wrap a string in CDATA, breaking any "]]>" sequences so it stays valid. */
function cdata(s: string): string {
  return '<![CDATA[' + String(s ?? '').replace(/]]>/g, ']]]]><![CDATA[>') + ']]>';
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&#x27;/gi, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function firstMatch(re: RegExp, html: string): string | null {
  const m = html.match(re);
  return m ? m[1] : null;
}

function metaContent(html: string, key: 'name' | 'property', value: string): string | null {
  const re = new RegExp(`<meta\\b[^>]*\\b${key}=["']${value}["'][^>]*>`, 'i');
  const tag = html.match(re);
  if (!tag) return null;
  const c = tag[0].match(/content=["']([\s\S]*?)["']/i);
  return c ? decodeEntities(c[1]) : null;
}

function canonicalHref(html: string): string | null {
  const m = html.match(/<link\b[^>]*\brel=["']canonical["'][^>]*>/i);
  if (!m) return null;
  const href = m[0].match(/href=["']([^"']+)["']/i);
  return href ? href[1] : null;
}

function hostFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return null;
  }
}

function pathFromUrl(url: string): string | null {
  try {
    return new URL(url).pathname || '/';
  } catch {
    return null;
  }
}

function normalizeRoute(route: string): string {
  let r = route || '/';
  if (!r.startsWith('/')) r = '/' + r;
  if (!r.endsWith('/')) r = r + '/';
  return r.replace(/\/{2,}/g, '/');
}

function humanize(segment: string): string {
  const s = segment.replace(/[-_]+/g, ' ').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : segment;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function fmtDate(iso: string | null): string {
  const d = iso ? new Date(iso) : null;
  const date = d && !Number.isNaN(d.getTime()) ? d : new Date('2024-01-01T00:00:00Z');
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
  );
}

function rssDate(iso: string | null): string {
  const d = iso ? new Date(iso) : null;
  const date = d && !Number.isNaN(d.getTime()) ? d : new Date();
  return date.toUTCString();
}

function extractStyles(head: string): string {
  const blocks = head.match(/<style\b[^>]*>[\s\S]*?<\/style>/gi) || [];
  return blocks.join('\n');
}

function extractContent(html: string): string {
  const shp = html.indexOf(HEADER_MARKER);
  const fStart = html.indexOf(FOOTER_MARKER);
  if (shp !== -1 && fStart !== -1) {
    const cStart = html.indexOf('</header>', shp) + 9;
    return html.slice(cStart, fStart).trim();
  }
  const bo = html.search(/<body[^>]*>/i);
  const boEnd = bo === -1 ? 0 : html.indexOf('>', bo) + 1;
  const bc = html.lastIndexOf('</body>');
  return html.slice(boEnd, bc === -1 ? undefined : bc).trim();
}

interface PageData {
  route: string;
  title: string;
  content: string;
  metadesc: string | null;
  published: string | null;
  modified: string | null;
}

interface WxrNode {
  id: number;
  slug: string;
  path: string;
  parentPath: string | null;
  parentId: number;
  depth: number;
  title: string;
  page?: PageData;
}

/**
 * Build a parent/child node tree from the pages' permalinks so the original URL
 * hierarchy is reproduced exactly. Missing intermediate segments (e.g. the
 * `/category/` parent of `/category/mindfulness/`) get a thin placeholder page
 * so WordPress can resolve the nested permalink.
 */
function buildNodes(pages: PageData[]): WxrNode[] {
  const byPath = new Map<string, WxrNode>();

  const ensure = (path: string, slug: string, depth: number, parentPath: string | null) => {
    let node = byPath.get(path);
    if (!node) {
      node = { id: 0, slug, path, parentPath, parentId: 0, depth, title: humanize(slug) };
      byPath.set(path, node);
    }
    return node;
  };

  for (const page of pages) {
    const route = normalizeRoute(page.route);
    const segments = route.replace(/^\/|\/$/g, '').split('/').filter(Boolean);

    if (segments.length === 0) {
      // Homepage: a normal top-level page (the user can set it as the front
      // page under Settings → Reading after import).
      const node = ensure('/', 'home', 0, null);
      node.page = page;
      node.title = page.title || node.title;
      continue;
    }

    for (let k = 1; k <= segments.length; k++) {
      const path = '/' + segments.slice(0, k).join('/') + '/';
      const parentPath = k === 1 ? null : '/' + segments.slice(0, k - 1).join('/') + '/';
      const slug = segments[k - 1].toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'page';
      const node = ensure(path, slug, k, parentPath);
      if (k === segments.length) {
        if (node.page) {
          // Two pages resolve to the same permalink: keep both by appending a
          // distinct suffix to the second one.
          const altPath = path.replace(/\/$/, '-2/');
          const alt = ensure(altPath, node.slug + '-2', k, parentPath);
          alt.page = page;
          alt.title = page.title || alt.title;
        } else {
          node.page = page;
          node.title = page.title || node.title;
        }
      }
    }
  }

  // Stable order: parents before children, then alphabetical.
  const nodes = [...byPath.values()].sort((a, b) => a.depth - b.depth || a.path.localeCompare(b.path));
  // Assign ids, then resolve parentId from parentPath.
  nodes.forEach((n, i) => (n.id = 1000 + i));
  for (const n of nodes) n.parentId = n.parentPath ? byPath.get(n.parentPath)?.id ?? 0 : 0;
  return nodes;
}

function buildItem(node: WxrNode, siteOrigin: string): string {
  const page = node.page;
  const date = page?.published || page?.modified || null;
  const styledContent = page
    ? `<!-- Geïmporteerd uit ${siteOrigin} -->\n${page.content}`
    : `<!-- Bovenliggende pagina (automatisch toegevoegd om de URL-structuur te behouden). -->`;
  const link = siteOrigin + node.path;

  const postmeta: string[] = [];
  if (page?.metadesc) {
    postmeta.push(
      `\t\t<wp:postmeta>\n` +
        `\t\t\t<wp:meta_key>${cdata('_yoast_wpseo_metadesc')}</wp:meta_key>\n` +
        `\t\t\t<wp:meta_value>${cdata(page.metadesc)}</wp:meta_value>\n` +
        `\t\t</wp:postmeta>`,
    );
  }
  postmeta.push(
    `\t\t<wp:postmeta>\n` +
      `\t\t\t<wp:meta_key>${cdata('_wp_page_template')}</wp:meta_key>\n` +
      `\t\t\t<wp:meta_value>${cdata('default')}</wp:meta_value>\n` +
      `\t\t</wp:postmeta>`,
  );

  return (
    `\t<item>\n` +
    `\t\t<title>${cdata(node.title)}</title>\n` +
    `\t\t<link>${xmlEscape(link)}</link>\n` +
    `\t\t<pubDate>${xmlEscape(rssDate(date))}</pubDate>\n` +
    `\t\t<dc:creator>${cdata('admin')}</dc:creator>\n` +
    `\t\t<guid isPermaLink="false">${xmlEscape(`${siteOrigin}/?page_id=${node.id}`)}</guid>\n` +
    `\t\t<description></description>\n` +
    `\t\t<content:encoded>${cdata(styledContent)}</content:encoded>\n` +
    `\t\t<excerpt:encoded>${cdata('')}</excerpt:encoded>\n` +
    `\t\t<wp:post_id>${node.id}</wp:post_id>\n` +
    `\t\t<wp:post_date>${cdata(fmtDate(date))}</wp:post_date>\n` +
    `\t\t<wp:post_date_gmt>${cdata(fmtDate(date))}</wp:post_date_gmt>\n` +
    `\t\t<wp:comment_status>${cdata('closed')}</wp:comment_status>\n` +
    `\t\t<wp:ping_status>${cdata('closed')}</wp:ping_status>\n` +
    `\t\t<wp:post_name>${cdata(node.slug)}</wp:post_name>\n` +
    `\t\t<wp:status>${cdata('publish')}</wp:status>\n` +
    `\t\t<wp:post_parent>${node.parentId}</wp:post_parent>\n` +
    `\t\t<wp:menu_order>0</wp:menu_order>\n` +
    `\t\t<wp:post_type>${cdata('page')}</wp:post_type>\n` +
    `\t\t<wp:post_password>${cdata('')}</wp:post_password>\n` +
    `\t\t<wp:is_sticky>0</wp:is_sticky>\n` +
    postmeta.join('\n') +
    `\n\t</item>`
  );
}

function buildWxr(siteTitle: string, siteOrigin: string, nodes: WxrNode[]): string {
  const items = nodes.map((n) => buildItem(n, siteOrigin)).join('\n');
  return (
    `<?xml version="1.0" encoding="UTF-8" ?>\n` +
    `<!-- This is a WordPress eXtended RSS file generated as an export of your site. -->\n` +
    `<!-- It may be imported via WordPress: Tools > Import > WordPress. -->\n` +
    `<rss version="2.0"\n` +
    `\txmlns:excerpt="http://wordpress.org/export/1.2/excerpt/"\n` +
    `\txmlns:content="http://purl.org/rss/1.0/modules/content/"\n` +
    `\txmlns:wfw="http://wellformedweb.org/CommentAPI/"\n` +
    `\txmlns:dc="http://purl.org/dc/elements/1.1/"\n` +
    `\txmlns:wp="http://wordpress.org/export/1.2/"\n` +
    `>\n` +
    `<channel>\n` +
    `\t<title>${cdata(siteTitle)}</title>\n` +
    `\t<link>${xmlEscape(siteOrigin)}</link>\n` +
    `\t<description>${cdata('')}</description>\n` +
    `\t<pubDate>${xmlEscape(new Date().toUTCString())}</pubDate>\n` +
    `\t<language>nl-NL</language>\n` +
    `\t<wp:wxr_version>1.2</wp:wxr_version>\n` +
    `\t<wp:base_site_url>${xmlEscape(siteOrigin)}</wp:base_site_url>\n` +
    `\t<wp:base_blog_url>${xmlEscape(siteOrigin)}</wp:base_blog_url>\n` +
    `\t<wp:author>\n` +
    `\t\t<wp:author_id>1</wp:author_id>\n` +
    `\t\t<wp:author_login>${cdata('admin')}</wp:author_login>\n` +
    `\t\t<wp:author_email>${cdata('admin@example.com')}</wp:author_email>\n` +
    `\t\t<wp:author_display_name>${cdata('admin')}</wp:author_display_name>\n` +
    `\t\t<wp:author_first_name>${cdata('')}</wp:author_first_name>\n` +
    `\t\t<wp:author_last_name>${cdata('')}</wp:author_last_name>\n` +
    `\t</wp:author>\n` +
    `\t<generator>https://wordpress.org/?v=6.5</generator>\n` +
    items +
    `\n</channel>\n</rss>\n`
  );
}

function buildReadme(siteTitle: string, host: string, fileBase: string, pageCount: number): string {
  return `# WordPress-import: ${siteTitle}

Dit pakket zet je website terug in WordPress. Het bevat:

- \`${fileBase}.wordpress.xml\` — het WordPress-importbestand (WXR) met alle pagina's: titels, slugs (permalinks), inhoud, meta-descriptions en interne links. De originele URL-structuur (ook nette mappen zoals \`/category/mindfulness/\`) blijft behouden.
- \`README.md\` — dit bestand.

## 1. Welke plugins heb je nodig?

- **WordPress Importer** (verplicht voor de import). Je installeert deze straks vanzelf via het importscherm.
- **Yoast SEO** (aanbevolen). De meta-descriptions in dit bestand worden opgeslagen in het Yoast-veld \`_yoast_wpseo_metadesc\`. Met Yoast geïnstalleerd verschijnen ze meteen op de juiste plek.
- *(Optioneel)* Een plugin om externe afbeeldingen binnen te halen, bijv. **Auto Upload Images**, als je de foto's lokaal in je nieuwe WordPress wilt opslaan (zie stap 4).

## 2. Hoe importeer je het in WordPress?

1. Log in op je WordPress-beheer (\`/wp-admin\`).
2. Ga naar **Gereedschap → Importeren** (Tools → Import).
3. Zoek **WordPress** onderaan de lijst en klik op **Nu installeren** en daarna op **Importprogramma uitvoeren**.
4. Klik op **Bestand kiezen** en selecteer het \`.xml\`-bestand uit deze ZIP.
5. Klik op **Bestand uploaden en importeren**.

## 3. Waar upload je het bestand?

Op het scherm uit stap 2-4 (Gereedschap → Importeren → WordPress). Je hoeft dus niets via FTP te uploaden — alleen het \`.xml\`-bestand kiezen op die pagina.

Bij het importeren:
- **Auteur toewijzen:** kies een bestaande gebruiker of laat WordPress een nieuwe aanmaken.
- **"Download and import file attachments"** aanvinken als je wilt dat WordPress de gekoppelde media probeert op te halen.

> Let op: grote \`.xml\`-bestanden kunnen de upload-limiet van je host overschrijden. Krijg je een foutmelding over de bestandsgrootte? Verhoog dan \`upload_max_filesize\` en \`post_max_size\` (vraag je host of pas \`php.ini\` aan).

## 4. Wat controleer je daarna?

- **Pagina's:** ga naar **Pagina's** en controleer of alle ${pageCount} pagina's er staan.
- **Permalinks/slugs:** open een paar pagina's en check of de URL klopt (bijv. \`/pilates/\`). Stel onder **Instellingen → Permalinks** "Berichtnaam" in als de URL's afwijken.
- **Interne links:** klik door enkele links. Importeer je naar een **ander domein**? Dan wijzen interne links en afbeeldingen nog naar \`${host}\`. Gebruik dan een zoek-en-vervang-plugin (bijv. **Better Search Replace**) om \`https://${host}\` te vervangen door je nieuwe domein.
- **Afbeeldingen:** de foto's verwijzen naar \`https://${host}/wp-content/...\`. Zolang de oude site online staat, laden ze. Wil je ze in je nieuwe WordPress opslaan, gebruik dan de plugin uit stap 1.
- **Meta-descriptions:** controleer met Yoast (tabblad onderaan de pagina) of de beschrijving is ingevuld.

## Belangrijk om te weten

- De **pagina-inhoud, teksten, koppen en structuur** worden 1-op-1 overgenomen, inclusief de pagina-specifieke inline-CSS, zodat de opmaak grotendeels meekomt.
- Enkele **bovenliggende pagina's** (zoals \`category\`) zijn automatisch toegevoegd om de nette URL-structuur te behouden. Je kunt ze laten staan of aanpassen.
- De **volledige originele vormgeving** leunt deels op het oorspronkelijke thema (Astra) en Elementor. Voor een 100% identieke look installeer je in je nieuwe WordPress hetzelfde thema/dezelfde paginabouwer. De teksten en indeling zijn hoe dan ook compleet aanwezig.
`;
}

/**
 * Build a WordPress-importable package (WXR `.xml` + Dutch README) from raw
 * imported pages. Returns a map of relative output path -> file content, or
 * null if the project is not a supported import.
 */
export function buildWordPressExport(
  files: ExportFile[],
  projectName?: string,
): Map<string, string> | null {
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
  const host = hostFromUrl(indexCanonical);
  if (!host) return null;
  const siteOrigin = `https://${host}`;

  const siteTitle = metaContent(index, 'property', 'og:site_name') || projectName || host;

  const htmlPages = files
    .filter((f) => f.path.endsWith('.html'))
    .sort((a, b) => a.path.localeCompare(b.path));

  const pages: PageData[] = [];
  for (const f of htmlPages) {
    const html = f.content ?? '';
    const headFull = (html.match(/<head[^>]*>([\s\S]*?)<\/head>/i) || ['', ''])[1];
    const canon = canonicalHref(html);
    const route = (canon && pathFromUrl(canon)) || `/${f.path.replace(/\.html$/, '')}/`;

    const rawTitle =
      metaContent(html, 'property', 'og:title') ||
      firstMatch(/<title[^>]*>([\s\S]*?)<\/title>/i, html) ||
      f.path.replace(/\.html$/, '');

    const styles = extractStyles(headFull);
    const body = extractContent(html);

    pages.push({
      route,
      title: decodeEntities(rawTitle).trim(),
      content: styles ? `${styles}\n${body}` : body,
      metadesc: metaContent(html, 'name', 'description'),
      published: metaContent(html, 'property', 'article:published_time'),
      modified: metaContent(html, 'property', 'article:modified_time'),
    });
  }

  if (pages.length === 0) return null;

  const nodes = buildNodes(pages);
  const xml = buildWxr(siteTitle, siteOrigin, nodes);
  const fileBase = host.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const readme = buildReadme(siteTitle, host, fileBase, nodes.length);

  const out = new Map<string, string>();
  out.set(`${fileBase}.wordpress.xml`, xml);
  out.set('README.md', readme);
  return out;
}
