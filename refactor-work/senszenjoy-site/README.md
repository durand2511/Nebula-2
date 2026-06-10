# SensZenjoy — opgeschoonde website

Dit is de geherstructureerde versie van senszenjoy.nl. De oorspronkelijke export
bestond uit 30 losse HTML-pagina's waarin de volledige header, navigatie en footer
op elke pagina opnieuw stonden (veel herhaalde code). Hier is dat teruggebracht
tot één gedeelde header, footer, layout en SEO-component — zonder iets aan het
ontwerp of de teksten te veranderen.

## Snel starten

```bash
npm install
npm run dev      # ontwikkelserver met live preview
npm run build    # bouwt de statische site naar ./dist
npm run preview  # bekijk de gebouwde site lokaal
```

Vereist Node.js 18 of nieuwer.

## Structuur

```
src/
  pages/        Eén bestand per pagina (dunne wrappers). De mappen volgen exact
                de originele permalinks, bv. /pilates/, /category/mindfulness/.
  layouts/      BaseLayout.astro — het gedeelde HTML-skelet (head + body).
  components/   Header.astro, Footer.astro, Seo.astro + de ruwe header/footer-HTML.
  lib/          markActive.js — zet het juiste actieve menu-item per pagina.
  page-data/    Per pagina de bewaarde <head> (stijlen) en de pagina-inhoud,
                plus de gedeelde body-omhulling (_shell).
public/         Statische bestanden die rechtstreeks worden geserveerd.
```

## Routes

De nette, leesbare routes komen overeen met de originele WordPress-permalinks,
zodat alle bestaande links en SEO blijven kloppen. Voorbeelden:

- `/` — home
- `/yoga-capelle-aan-den-ijssel/`, `/pilates/`, `/mindfulness/`
- `/lesrooster-en-contact/`, `/tarieven-senszenjoy/`, `/over-mij/`, `/blog-vlog/`

## Belangrijke keuzes

- **Ontwerp 1-op-1 behouden.** De originele opmaak (externe stylesheets én de
  inline-CSS) is per pagina exact overgenomen, in dezelfde volgorde. Er is niets
  aan kleuren, lettertypes of indeling gewijzigd.
- **SEO per pagina intact.** Title, meta-description, robots, canonical en
  Open Graph-tags zijn per pagina bewaard via het `Seo`-component.
- **WordPress-rommel verwijderd.** Dode verwijzingen zoals `wp-json`, RSS-feeds,
  `oembed`, `xmlrpc`, pingback en generator-tags zijn weggehaald.
- **Interne links opgeschoond.** Verwijzingen naar `https://senszenjoy.nl/...`
  binnen de site wijzen nu naar de lokale, nette routes.
- **Afbeeldingen.** De media (foto's, logo) worden nog steeds vanaf
  `senszenjoy.nl` geladen — de beeldbestanden zaten niet in de export. Wil je de
  site volledig los van het oude domein? Download dan de afbeeldingen naar
  `public/` en pas de verwijzingen aan.
- **Geen JavaScript.** De originele export bevatte geen scripts; de site is puur
  statische HTML/CSS. Dynamische onderdelen (zoals het momoyoga-lesrooster) tonen
  hun inhoud pas weer wanneer het bijbehorende script opnieuw wordt toegevoegd.
