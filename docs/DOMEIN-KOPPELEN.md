# Runbook: klantdomein koppelen (alleen voor de eigenaar)

Klanten zien deze instructies NIET meer — zij typen alleen hun domein in het publiceer-venster en
klikken "Koppelen". Jij krijgt dan een e-mail (CONTACT_EMAIL, standaard durand2511@gmail.com) met het
domein en de records. Daarna doe jij onderstaande stappen; de klant hoeft niets te doen.

## 1. DNS-records instellen (bij de domeinprovider van de klant)

Voor domein `jouwstudio.nl`:

| # | Naam | Type  | Waarde |
|---|------|-------|--------|
| 1 | `www` | CNAME | `customers.nebulabookings.com` |
| 2 | `@` (of leeg) | A | `216.24.57.1` |
| 3 | `@` (of leeg) | A | `216.24.57.9` |

- TTL: standaardwaarde van de provider is prima (meestal 1 uur).
- Sommige providers ondersteunen ALIAS/ANAME op het hoofddomein — dan mag je i.p.v. de twee
  A-records één ALIAS naar `customers.nebulabookings.com` zetten (de verificatie accepteert beide:
  elk IP in Renders blok `216.24.57.x` telt als goed).
- Let op per provider: bij TransIP/Strato heet `@` soms een leeg naamveld; bij Cloudflare de proxy
  (oranje wolkje) UIT zetten voor deze records (DNS only), anders faalt de CNAME-verificatie.

## 2. Verifiëren (in Nebula)

Open het project → publiceer-venster → klik **Verifiëren** naast het domein (mag ook de klant doen).
De server checkt echte DNS: CNAME → `customers.nebulabookings.com` voor subdomeinen, of een A/ALIAS
in het `216.24.57.x`-blok voor het hoofddomein (`lib/domains.ts → verifyDomain`).

## 3. Render + SSL — automatisch

Bij een geslaagde verificatie voegt de server het domein zelf toe aan de Render-service via de
Render-API (`addRenderDomain`, vereist `RENDER_API_KEY` + `RENDER_SERVICE_ID` in de omgeving) en
regelt Render het SSL-certificaat. Duurt enkele minuten tot een paar uur na DNS-propagatie.

## 4. Controle

- `https://www.jouwstudio.nl` én `https://jouwstudio.nl` tonen de gepubliceerde site met slotje.
- In het publiceer-venster staat het domein op "● Live (SSL actief)".
- Bij een SEO-verhuizing (oud domein → nieuw): gebruik `domains.redirect_to` (301), zie de
  redirect-feature (sukhaloveyoga.nl → senszenjoy.nl als voorbeeld).

## Problemen

- "Wordt gekoppeld" blijft staan → DNS nog niet gepropageerd (check `dig www.domein CNAME` en
  `dig domein A`), of Cloudflare-proxy staat aan.
- SSL ontbreekt terwijl DNS klopt → check of het domein in Render onder Custom Domains staat; zo
  niet: RENDER_API_KEY/RENDER_SERVICE_ID ontbreken → voeg het domein handmatig toe in het
  Render-dashboard (Settings → Custom Domains).
