// Privacybeleid (AVG/GDPR) voor Nebula — nebulabookings.com.
export function Privacy() {
  return (
    <div className="flex-1 w-full px-4 py-10 pb-24">
      <div className="mx-auto max-w-3xl rounded-2xl border border-border bg-card/95 backdrop-blur shadow-lg p-8 md:p-10">
        <h1 className="text-3xl font-bold tracking-tight">Privacybeleid</h1>
        <p className="mt-2 text-sm text-foreground/50">Laatst bijgewerkt: 1 september 2026</p>

        <p className="mt-6 text-foreground/80 leading-relaxed">
          Nebula respecteert jouw privacy en verwerkt persoonsgegevens in overeenstemming met de
          Algemene Verordening Gegevensbescherming (AVG). In dit beleid leggen we uit welke gegevens
          we verzamelen, waarom, hoe lang we ze bewaren en welke rechten je hebt.
        </p>

        <Section title="1. Wie zijn wij">
          <p>
            Nebula is een web design bureau van Durand van Konijnenburg, gevestigd in Nederland en
            ingeschreven bij de Kamer van Koophandel onder nummer <strong>70776857</strong>. Wij
            ontwerpen en bouwen websites, webapplicaties en andere digitale producten op maat. Dat
            doen wij met behulp van AI-ontwikkeltools, in het bijzonder <strong>Claude Code</strong>,
            waarmee wij vrijwel alles kunnen maken wat een klant nodig heeft. De opgeleverde website
            is en blijft eigendom van de klant; de klant is zelf eigenaar en beheerder.
          </p>
          <ul className="mt-3 space-y-1">
            <li>Verwerkingsverantwoordelijke: Durand van Konijnenburg</li>
            <li>KVK: 70776857</li>
            <li>Telefoon: 0638255972</li>
            <li>E-mail: <a className="text-primary font-medium hover:underline" href="mailto:durand2511@gmail.com">durand2511@gmail.com</a></li>
            <li>Website: <a className="text-primary font-medium hover:underline" href="https://nebulabookings.com">nebulabookings.com</a></li>
          </ul>
        </Section>

        <Section title="2. Welke gegevens verzamelen wij">
          <p>Afhankelijk van je relatie met ons verwerken wij de volgende gegevens:</p>
          <p className="mt-3 font-semibold text-foreground">Klanten en opdrachtgevers</p>
          <ul className="mt-1 space-y-1">
            <li>Naam, e-mailadres en telefoonnummer</li>
            <li>Bedrijfsnaam, adres, KVK- en btw-nummer (voor offertes en facturen)</li>
            <li>Correspondentie over het project (e-mails, briefings, feedback)</li>
            <li>Inloggegevens of toegang tot systemen die je ons voor het project tijdelijk verstrekt (bijvoorbeeld domein- of hostingaccounts)</li>
          </ul>
          <p className="mt-3 font-semibold text-foreground">Bezoekers van nebulabookings.com</p>
          <ul className="mt-1 space-y-1">
            <li>Technische gegevens zoals IP-adres, browsertype en bezochte pagina's (serverlogs)</li>
            <li>Gegevens die je zelf invult wanneer je contact met ons opneemt</li>
          </ul>
          <p className="mt-3 font-semibold text-foreground">Bezoekers van websites die wij voor klanten bouwen</p>
          <ul className="mt-1 space-y-1">
            <li>
              De klant is eigenaar en beheerder van zijn eigen website en daarmee de
              verwerkingsverantwoordelijke voor de gegevens van zijn bezoekers. Nebula verwerkt die
              gegevens alleen voor zover dat nodig is om de website te bouwen, op te leveren of — op
              verzoek — te onderhouden.
            </li>
          </ul>
        </Section>

        <Section title="3. Waarvoor gebruiken wij uw gegevens">
          <ul className="space-y-1">
            <li>Het opstellen van offertes en het uitvoeren van de opdracht (ontwerpen, bouwen en opleveren van je website);</li>
            <li>Communicatie over het project, feedbackrondes en oplevering;</li>
            <li>Facturatie en administratie;</li>
            <li>Het beveiligen van onze systemen en het voorkomen van misbruik;</li>
            <li>Het voldoen aan wettelijke verplichtingen (zoals de boekhoudplicht).</li>
          </ul>
          <p className="mt-3">
            De wettelijke grondslagen zijn de uitvoering van de overeenkomst, het voldoen aan een
            wettelijke verplichting en ons gerechtvaardigd belang bij een goede en veilige
            bedrijfsvoering.
          </p>
        </Section>

        <Section title="4. AI-tools en Claude Code">
          <p>
            Bij het ontwerpen en bouwen van websites maken wij gebruik van AI-ontwikkeltools,
            waaronder Claude Code van Anthropic. Daarbij kunnen projectgegevens (zoals teksten,
            afbeeldingen, broncode en briefings) worden verwerkt door deze tool. Wij delen geen
            persoonsgegevens met AI-tools die niet nodig zijn voor het bouwen van de website en
            gebruiken geen gegevens van klanten of hun bezoekers om AI-modellen te trainen.
          </p>
        </Section>

        <Section title="5. Hoe lang bewaren wij uw gegevens">
          <ul className="space-y-1">
            <li>Projectgegevens en correspondentie: tot 2 jaar na oplevering, zodat wij je bij vragen of vervolgopdrachten kunnen helpen;</li>
            <li>Tijdelijk verstrekte toegangsgegevens: direct na oplevering verwijderd of teruggegeven;</li>
            <li>Financiële gegevens (offertes, facturen): 7 jaar, conform de wettelijke boekhoudplicht;</li>
            <li>Serverlogs van nebulabookings.com: maximaal 90 dagen.</li>
          </ul>
        </Section>

        <Section title="6. Delen wij gegevens met derden">
          <p>
            Wij verkopen je gegevens nooit. Voor onze dienstverlening schakelen wij de volgende
            partijen in, die uitsluitend in onze opdracht gegevens verwerken:
          </p>
          <ul className="mt-3 space-y-1">
            <li><strong>Anthropic (Claude Code)</strong> — AI-ontwikkeltool waarmee wij websites bouwen;</li>
            <li><strong>Render</strong> en <strong>Neon</strong> — hosting en databaseopslag van nebulabookings.com en, indien afgesproken, van opgeleverde websites;</li>
            <li><strong>Resend</strong> — verzenden van e-mails;</li>
            <li><strong>Stripe</strong> — betalingsverwerking, uitsluitend wanneer je online bij ons betaalt.</li>
          </ul>
          <p className="mt-3">
            Daarnaast kunnen wij gegevens delen wanneer wij daartoe wettelijk verplicht zijn.
          </p>
        </Section>

        <Section title="7. Uw rechten">
          <p>Op grond van de AVG heb je het recht op:</p>
          <ul className="mt-3 space-y-1">
            <li>Inzage in de persoonsgegevens die wij van je verwerken;</li>
            <li>Correctie van onjuiste of onvolledige gegevens;</li>
            <li>Verwijdering van je gegevens ("recht op vergetelheid");</li>
            <li>Beperking van of bezwaar tegen de verwerking;</li>
            <li>Overdraagbaarheid van je gegevens (dataportabiliteit).</li>
          </ul>
          <p className="mt-3">
            Een verzoek indienen kan via <a className="text-primary font-medium hover:underline" href="mailto:durand2511@gmail.com">durand2511@gmail.com</a>.
            Je hebt ook het recht een klacht in te dienen bij de Autoriteit Persoonsgegevens.
          </p>
        </Section>

        <Section title="8. Beveiliging">
          <p>
            Wij nemen passende technische en organisatorische maatregelen om je gegevens te
            beschermen. Verbindingen verlopen via versleuteld verkeer (HTTPS), toegangsgegevens
            worden veilig bewaard en na oplevering verwijderd, en betalingsgegevens worden uitsluitend
            door Stripe verwerkt — wij slaan geen rauwe kaartgegevens op.
          </p>
        </Section>

        <Section title="9. Contact">
          <p>
            Vragen over dit privacybeleid of over je gegevens? Neem contact op:
          </p>
          <ul className="mt-3 space-y-1">
            <li>E-mail: <a className="text-primary font-medium hover:underline" href="mailto:durand2511@gmail.com">durand2511@gmail.com</a></li>
            <li>Telefoon: 0638255972</li>
            <li>KVK: 70776857</li>
          </ul>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-xl font-semibold tracking-tight text-foreground">{title}</h2>
      <div className="mt-2 text-foreground/80 leading-relaxed [&_ul]:list-disc [&_ul]:pl-5">{children}</div>
    </section>
  );
}
