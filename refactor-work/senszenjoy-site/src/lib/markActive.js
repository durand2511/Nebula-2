/**
 * Markeert het actieve menu-item voor de huidige route.
 *
 * In de originele WordPress-export had elke pagina haar eigen header/footer met
 * de juiste `current-menu-item`-klasse al ingebakken. Wij gebruiken nu één
 * gedeelde header/footer en zetten die actieve staat hier per route.
 *
 * @param {string} html   De (gedeelde) header- of footer-HTML.
 * @param {string} route  De huidige route, bv. "/pilates/".
 * @returns {string}
 */
export function markActive(html, route) {
  if (!route) return html;
  const liRe =
    /(<li\b[^>]*\bclass=")([^"]*\bmenu-item\b[^"]*)("[^>]*>\s*<a\b)([^>]*\bhref=")([^"]*)(")/gi;
  return html.replace(liRe, (m, p1, cls, p3, aPre, href, qEnd) => {
    if (href !== route) return m;
    if (/\bcurrent-menu-item\b/.test(cls)) return m;
    return (
      p1 + cls + ' current-menu-item current_page_item' + p3 + aPre + href + qEnd + ' aria-current="page"'
    );
  });
}
