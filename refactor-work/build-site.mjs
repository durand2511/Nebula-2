import fs from 'node:fs';
import path from 'node:path';

const RAW = 'refactor-work/raw';
const OUT = 'refactor-work/senszenjoy-site';
const files = fs.readdirSync(RAW).filter((f) => f.endsWith('.html')).sort();
const read = (f) => fs.readFileSync(path.join(RAW, f), 'utf8');
const pagemap = JSON.parse(fs.readFileSync('refactor-work/inspect/pagemap.json', 'utf8'));

const canonOf = (f) =>
  (pagemap[f]?.canonical || '').replace(/^https?:\/\/(?:www\.)?senszenjoy\.nl/i, '') || '/';
const localPaths = new Set(files.map(canonOf));

const routeToAstroPath = (route) => (route === '/' || route === '' ? 'index' : route.replace(/^\/|\/$/g, ''));
const routeToSlug = (route) =>
  route === '/' || route === '' ? 'index' : route.replace(/^\/|\/$/g, '').replace(/\//g, '__');

function rewriteLinks(html) {
  return html.replace(/(href=")(https?:\/\/(?:www\.)?senszenjoy\.nl)(\/[^"]*)?(")/gi, (m, p1, dom, p3, q) => {
    const full = p3 || '/';
    const cut = full.search(/[?#]/);
    const basePath = cut === -1 ? full : full.slice(0, cut);
    const suffix = cut === -1 ? '' : full.slice(cut); // keep #anchor / ?query
    if (basePath === '/' || basePath === '') return p1 + '/' + suffix + q;
    const withSlash = basePath.endsWith('/') ? basePath : basePath + '/';
    if (localPaths.has(withSlash)) return p1 + withSlash + suffix + q;
    return m;
  });
}

function decodeAttr(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&#x27;/gi, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function extractSeo(head) {
  const tags = [];
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

function cleanHead(head) {
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

// ---- shared shell / header / footer from index baseline ----
const idx = read('index.html');
const sh = idx.indexOf('<header data-elementor-type="header"');
const headerRaw = idx.slice(sh, idx.indexOf('</header>', sh) + 9);
const ft = idx.indexOf('<footer class="site-footer"');
const footerEnd = idx.indexOf('</footer>', ft) + 9;
const footerRaw = idx.slice(ft, footerEnd);
const headerLocal = rewriteLinks(headerRaw);
const footerLocal = rewriteLinks(footerRaw);

const bodyOpen = idx.search(/<body[^>]*>/i);
const bodyOpenEnd = idx.indexOf('>', bodyOpen) + 1;
const pageOpenIdx = idx.indexOf('<div class="hfeed site" id="page">');
let beforePage = idx.slice(bodyOpenEnd, pageOpenIdx).replace(/<!--[\s\S]*?-->/g, '').trim();
const bodyClose = idx.lastIndexOf('</body>');
let afterPage = idx
  .slice(footerEnd, bodyClose)
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/^\s*<\/div>/, '')
  .trim();

fs.mkdirSync(`${OUT}/src/page-data/_shell`, { recursive: true });
fs.writeFileSync(`${OUT}/src/page-data/_shell/before.html`, beforePage);
fs.writeFileSync(`${OUT}/src/page-data/_shell/after.html`, afterPage);
fs.writeFileSync(`${OUT}/src/components/header.html`, headerLocal.trim());
fs.writeFileSync(`${OUT}/src/components/footer.html`, footerLocal.trim());

// ---- active-state verification helper ----
function activeHrefsOriginal(fragment) {
  const local = rewriteLinks(fragment);
  const set = new Set();
  for (const m of local.matchAll(/<li\b[^>]*\bclass="([^"]*)"[^>]*>\s*<a\b[^>]*\bhref="([^"]*)"/gi)) {
    if (/current_page_item/.test(m[1])) set.add(m[2]);
  }
  return set;
}

const routes = [];
const mismatches = [];
let unbalanced = 0;

for (const f of files) {
  const h = read(f);
  const route = canonOf(f);
  const slug = routeToSlug(route);
  const headFull = (h.match(/<head[^>]*>([\s\S]*?)<\/head>/i) || ['', ''])[1];
  let { title, tags, head: headRest } = extractSeo(headFull);
  headRest = rewriteLinks(cleanHead(headRest));
  const bodyClass = (h.match(/<body[^>]*\bclass="([^"]*)"/i) || ['', ''])[1];

  const shp = h.indexOf('<header data-elementor-type="header"');
  const cStart = h.indexOf('</header>', shp) + 9;
  const fStart = h.indexOf('<footer class="site-footer"');
  let content = rewriteLinks(h.slice(cStart, fStart)).trim();

  // sanity: balanced divs in content chunk
  const opens = (content.match(/<div\b/gi) || []).length;
  const closes = (content.match(/<\/div>/gi) || []).length;
  if (opens !== closes) {
    unbalanced++;
    console.log(`  ! div imbalance in ${f}: ${opens} open / ${closes} close`);
  }

  // verify active state reproduces original (header)
  const origActive = activeHrefsOriginal(h.slice(shp, h.indexOf('</header>', shp) + 9));
  const mineActive = headerLocal.includes(`href="${route}"`) ? new Set([route]) : new Set();
  const same = origActive.size === mineActive.size && [...origActive].every((x) => mineActive.has(x));
  if (!same) mismatches.push({ f, route, orig: [...origActive], mine: [...mineActive] });

  fs.writeFileSync(`${OUT}/src/page-data/${slug}.head.html`, headRest);
  fs.writeFileSync(`${OUT}/src/page-data/${slug}.content.html`, content);
  fs.writeFileSync(
    `${OUT}/src/page-data/${slug}.meta.json`,
    JSON.stringify({ route, bodyClass, seo: { title, tags } }, null, 1)
  );

  const astroPath = routeToAstroPath(route);
  const pageFile = `${OUT}/src/pages/${astroPath}.astro`;
  fs.mkdirSync(path.dirname(pageFile), { recursive: true });
  const astro =
    `---\n` +
    `import BaseLayout from '@layouts/BaseLayout.astro';\n` +
    `import headInner from '@data/${slug}.head.html?raw';\n` +
    `import content from '@data/${slug}.content.html?raw';\n` +
    `import meta from '@data/${slug}.meta.json';\n` +
    `---\n` +
    `<BaseLayout headInner={headInner} content={content} seo={meta.seo} bodyClass={meta.bodyClass} route={meta.route} />\n`;
  fs.writeFileSync(pageFile, astro);
  routes.push({ route, astroPath, slug });
}

console.log('Pages generated:', routes.length);
console.log('Div-imbalanced content chunks:', unbalanced);
console.log('Active-state mismatches:', mismatches.length);
for (const mm of mismatches) console.log('  -', mm.f, 'route', mm.route, 'orig', mm.orig, 'mine', mm.mine);
console.log('\nRoutes -> astro file:');
for (const r of routes) console.log('  ', r.route, '->', 'src/pages/' + r.astroPath + '.astro');
