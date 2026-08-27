# Nebula Bookings

Multi-tenant SaaS-platform waarop yogastudio's en sportscholen hun lesrooster,
abonnementen, betalingen en klantcommunicatie draaien. Elk account beheert zijn eigen
projecten; klanten publiceren hun site op een subdomein of een eigen domein met
automatisch SSL.

Draait in productie.

## Wat erin zit

**Rooster en boekingen** — terugkerende lessen, meerdere locaties, wachtlijsten,
presentielijst per les, no-show-registratie en kortingscodes.

**Betalingen via Stripe** — abonnementen met vaste looptijd, losse aankopen en
maandelijkse reset van tegoed. iDEAL, Klarna, PayPal en creditcard. Een
abonnementenoverzicht laat zien wie betaald heeft, zodat een niet-betaler geen lessen
meer boekt.

**Administratie, geautomatiseerd** — btw-export, creditnota's, betalingsherinneringen met
dunning, docenten-uitbetalingen, maandrapportage voor de eigenaar en automatische
review-verzoeken.

**Site-editor** — pagina's, secties en blog zonder code, plus een AI-editor gebouwd op de
Claude Agent SDK met een brug tussen database en schijf. Bestaande sites zijn te
importeren, inclusief eigen CSS en assets.

**Vindbaarheid** — een SEO-motor die artikelen schrijft tegen een vaste kostprijs per
stuk, met een harde limiet van één artikel per dag per site. Domeinverhuizingen met
301-redirects waarbij de posities behouden blijven.

**Koppelingen** — Google Calendar via OAuth met directe synchronisatie, en e-mail via SMTP.

**Meertalig** — Nederlands, Engels, Duits, Frans en Spaans.

## Architectuur

Node.js en Express met PostgreSQL (Neon). Elk record hangt aan een eigenaar; middleware
dwingt af dat een account alleen bij zijn eigen projecten kan. Deployment via Docker op
Render, waarbij de container bij het opstarten het schema bijwerkt.

Regressiesuite: 155 tests, allemaal groen.

## Draaien

```bash
npm install
cp .env.example .env    # vul je eigen sleutels in
npm start
```

Zie `DEPLOY.md` voor de omgevingsvariabelen en de deploy-stappen.

## Beveiliging

Het platform is doorgelicht op authenticatie, sessiebeheer en scheiding van klantgegevens.
Wat daaruit kwam is verholpen: ingebakken wachtwoorden verwijderd, brute-force-bescherming
op de login, en het lek waardoor een wachtwoord-vergeten-verzoek een account kon
overnemen.

Geen enkele sleutel staat in deze repository. Alles komt uit de omgeving; `.env.example`
laat zien welke variabelen nodig zijn.
