# Nebula — live zetten op Railway + Neon

Dit zet de **API-server** (die de booking-apps, de gepubliceerde sites, custom domains en alle
`/api`-endpoints serveert) + een **Neon Postgres-database** online. Daarmee is je product live en
deelt elke studio z'n data over alle apparaten.

> Deel **nooit** echte API-keys in een chat. Alles hieronder zet je zelf in de dashboards.
> `PORT` zet je niet — Railway injecteert die automatisch.

---

## Stap 1 — Database (Neon)
1. Ga naar https://neon.tech → maak een account → **New Project** (regio: EU, bijv. Frankfurt).
2. Open **Connection string** en kies de **Pooled connection** (bevat `-pooler` in de host).
3. Kopieer die string — dat wordt straks `DATABASE_URL`. Vorm:
   `postgresql://USER:PASSWORD@ep-...-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require`

## Stap 2 — Tabellen aanmaken in Neon (eenmalig, vanaf je Mac)
Dit maakt alle tabellen (`studio_*`, `invoices`, `domains`, …) in de lege Neon-database:
```bash
cd ~/Nebula-2
DATABASE_URL="<jouw-neon-pooled-url>" pnpm --filter @workspace/db run push-force
```
Herhaal dit commando later alleen als het databaseschema verandert.

## Stap 3 — Code naar GitHub
De repo staat al op `github.com/durand2511/Nebula-2` (branch `main`). Zorg dat al het werk gepusht is
(zie onderaan — dit doen we samen). Railway leest `railway.json` uit de repo-root.

## Stap 4 — Railway-project
1. Ga naar https://railway.app → **New Project** → **Deploy from GitHub repo** → kies `Nebula-2`.
2. Railway leest automatisch `railway.json`:
   - build: `pnpm --filter @workspace/api-server run build`
   - start: `node artifacts/api-server/dist/index.mjs`
   - healthcheck: `/api/healthz`
3. Ga naar de **Variables**-tab en zet de variabelen uit `.env.example`:
   - `DATABASE_URL` (Neon, pooled) · `NODE_ENV=production` · `EMAIL_SECRET_KEY` (lange random string, **constant houden**)
   - `SMTP_HOST/PORT/SECURE/USER/PASS/FROM` (Gmail app-password van durand2511@gmail.com)
   - `STRIPE_SECRET_KEY` · `STRIPE_WEBHOOK_SECRET`
   - `ANTHROPIC_API_KEY`
   - `PLATFORM_HOST=nebulabookings.com` · `CUSTOMERS_TARGET=customers.nebulabookings.com`
   - `PUBLIC_APP_URL` / `PUBLIC_API_URL` → eerst de Railway-URL, later `https://nebulabookings.com`
4. Railway bouwt + start. Check de **Deploy logs**: je wilt `Server listening` zien en healthcheck groen.

## Stap 5 — Domein koppelen
1. Railway → **Settings → Networking → Custom Domain** → `nebulabookings.com` (en `www`).
2. Zet bij je domeinregistrar de DNS-records die Railway toont (CNAME/A). SSL regelt Railway zelf.
3. Update daarna `PUBLIC_APP_URL`/`PUBLIC_API_URL` naar `https://nebulabookings.com`.

## Stap 6 — Stripe webhook
1. Stripe Dashboard → **Developers → Webhooks → Add endpoint**:
   `https://nebulabookings.com/api/stripe/webhook`
2. Kopieer de **Signing secret** (`whsec_...`) → zet als `STRIPE_WEBHOOK_SECRET` in Railway.
3. Studios koppelen hun eigen Stripe via de Connect-onboarding in de app (Integraties → Stripe).

## Klaar
- `https://<railway-url>/api/healthz` geeft `{"status":"ok"}`.
- Een gepubliceerde site op een gekoppeld klantdomein wordt door de API geserveerd.
- De booking-app draait nu volledig server-backed (data in Neon, gedeeld over apparaten).

### Later (optioneel)
- **Custom domains van klanten**: Cloudflare for SaaS vóór Railway voor automatische SSL per klantdomein.
- **App-builder UI** (de Vite-console waar jij sites bouwt): kan als 2e Railway-service of lokaal.
- **Restpunten**: Mindbody-activatie → server-wallet, account verwijderen, instellingen server-side.
