# Nebula Exporter (WordPress-plugin)

Exporteert een **complete** WordPress-site — alle `wp-content`-bestanden (thema's, plugins, uploads)
plus een **volledige database-dump** — en pusht alles naar een nieuw **Nebula-project**, zodat de hele
code in Nebula beschikbaar en bewerkbaar is.

## Installeren

1. Zip de map `nebula-exporter/` (zodat je `nebula-exporter.zip` krijgt met daarin `nebula-exporter.php`).
2. In WordPress: **Plugins → Nieuwe plugin → Plugin uploaden** → kies de zip → **Nu installeren** → **Activeren**.
   - Of kopieer de map `nebula-exporter/` naar `wp-content/plugins/` en activeer 'm.

## Gebruiken

1. Ga naar **Extra → Nebula Export**.
2. Vul in en sla op:
   - **Nebula API-URL** — de basis-URL van je Nebula-server (bijv. `https://jouw-nebula.onrender.com`), **zonder** `/api`.
   - **Nebula-token** — je Nebula-sessietoken. Log in op de Nebula-console; het token staat in
     `localStorage` (de sleutel waarmee je bent ingelogd). Kopieer die waarde.
3. Kies wat je meestuurt (bestanden / uploads / database) en klik **Exporteren naar Nebula**.

De plugin maakt een nieuw project aan onder jouw Nebula-account en stuurt in batches:
- alle bestanden uit `wp-content` + de PHP-bestanden in de WordPress-root,
- een `wordpress-database.sql` met een volledige dump (`SHOW CREATE TABLE` + `INSERT`s).

## Wat er gebeurt aan de Nebula-kant

De plugin praat met deze endpoints (in `artifacts/api-server/src/routes/import-wordpress.ts`):

| Endpoint | Doel |
| --- | --- |
| `POST /api/import/wordpress/init` | Maakt het project (owned door de token-eigenaar). |
| `POST /api/import/wordpress/files` | Batch bestanden; `append:true` voor gechunkte grote bestanden. |
| `POST /api/import/wordpress/finalize` | Rondt af, geeft het totaal aantal bestanden terug. |

**Tekstbestanden** (PHP/HTML/CSS/JS/SQL/…) worden een `project_files`-rij (`path` + `content` +
`language`) — bladerbaar en bewerkbaar in de console.

**Binaire media** (afbeeldingen, fonts, video, de hele `uploads`-map) gaan níét in Postgres, maar als
**echte bestanden naar de Render persistent disk** (`MEDIA_DIR`, standaard `/data`). Een
`project_assets`-rij wijst ernaar (`path` → `storageKey` + `contentType` + `size`). Bij het serveren
van een gepubliceerde site (`serveProjectSite`) worden ze rechtstreeks van disk gestreamd met de
juiste content-type en een lange cache-header.

## Grenzen / let op

- **wp-admin / wp-includes (WP-core) gaan niet mee** — dat is boilerplate en enorm. Wil je dat toch,
  breid dan `$targets` in `send_files()` uit.
- **Geheimen**: `wp-config.php` wordt gesaniteerd (DB-wachtwoord + salts worden verwijderd) voordat
  het verstuurd wordt.
- **Grote sites**: bestanden > 80 MB worden overgeslagen; bestanden > ~4 MB worden in stukken gestuurd
  (chunked/append). Media landt op de persistent disk, dus de uploads-map belast Postgres niet meer —
  maar houd de disk-grootte in de gaten (standaard 10 GB in `render.yaml`, ophoogbaar in het dashboard).
- **Disk vereist**: media-serving werkt alleen als de Render-service de persistent disk op `/data` heeft
  (staat in `render.yaml`) of als `MEDIA_DIR` naar een schrijfbare map wijst. Lokaal valt hij terug op
  `.media-data/` in de repo.
- **Editor-preview**: de in-console preview toont media nog via het originele domein (zoals de
  URL-import); de gepubliceerde site serveert media van disk. Zolang de oude WP-site nog online staat
  zie je in beide alles; is die offline, dan tonen alleen gepubliceerde sites de media correct.
- Draai de export op een moment dat de PHP `max_execution_time`/geheugen het aankan; de plugin zet
  `set_time_limit(0)` en `memory_limit=512M`, maar sommige hosts negeren dat.
