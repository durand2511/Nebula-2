// Privacybeleid (AVG/GDPR) voor Nebula — nebulabookings.com.
export function Privacy() {
  return (
    <div className="flex-1 w-full px-4 py-10 pb-24">
      <div className="mx-auto max-w-3xl rounded-2xl border border-border bg-card/95 backdrop-blur shadow-lg p-8 md:p-10">
        <h1 className="text-3xl font-bold tracking-tight">Privacybeleid</h1>
        <p className="mt-2 text-sm text-foreground/50">Laatst bijgewerkt: 29 juni 2026</p>

        <p className="mt-6 text-foreground/80 leading-relaxed">
          Nebula respecteert jouw privacy en verwerkt persoonsgegevens in overeenstemming met de
          Algemene Verordening Gegevensbescherming (AVG). In dit beleid leggen we uit welke gegevens
          we verzamelen, waarom, hoe lang we ze bewaren en welke rechten je hebt.
        </p>

        <Section title="1. Wie zijn wij">
          <p>
            Nebula is een dienst van Durand van Konijnenburg, gevestigd in Nederland en ingeschreven
            bij de Kamer van Koophandel onder nummer <strong>70776857</strong>. Nebula is een
            platform waarmee yoga- en fitnessstudio's een website en een volledig boekingssysteem
            kunnen opzetten en beheren.
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
          <p>Afhankelijk van je rol verwerken wij de volgende gegevens:</p>
          <p className="mt-3 font-semibold text-foreground">Studio-eigenaren</p>
          <ul className="mt-1 space-y-1">
            <li>Naam en e-mailadres</li>
            <li>Bedrijfsnaam en bedrijfsgegevens</li>
            <li>Wachtwoord (uitsluitend versleuteld/gehasht opgeslagen)</li>
            <li>Stripe Connect-accountgegevens voor uitbetalingen</li>
          </ul>
          <p className="mt-3 font-semibold text-foreground">Leerlingen/klanten van studio's</p>
          <ul className="mt-1 space-y-1">
            <li>Naam en e-mailadres</li>
            <li>Boekings- en reserveringsgeschiedenis</li>
          </ul>
          <p className="mt-3 font-semibold text-foreground">Overig</p>
          <ul className="mt-1 space-y-1">
            <li>Betalingsgegevens — verwerkt via Stripe. Nebula slaat zelf <strong>geen</strong> rauwe kaartgegevens op.</li>
            <li>Websitecontent — teksten en afbeeldingen die studio's uploaden.</li>
            <li>Gebruiksdata — logbestanden en sessiegegevens voor beveiliging en goede werking.</li>
          </ul>
        </Section>

        <Section title="3. Waarvoor gebruiken wij uw gegevens">
          <ul className="space-y-1">
            <li>Het leveren en beheren van je account, website en boekingssysteem;</li>
            <li>Het verwerken van boekingen, betalingen en uitbetalingen;</li>
            <li>Het versturen van transactionele e-mails (bevestigingen, herinneringen, facturen);</li>
            <li>Het beveiligen van het platform en het voorkomen van misbruik;</li>
            <li>Het voldoen aan wettelijke verplichtingen (zoals de boekhoudplicht).</li>
          </ul>
          <p className="mt-3">
            De wettelijke grondslagen zijn de uitvoering van de overeenkomst, het voldoen aan een
            wettelijke verplichting en ons gerechtvaardigd belang bij een veilig, werkend platform.
          </p>
        </Section>

        <Section title="4. Hoe lang bewaren wij uw gegevens">
          <ul className="space-y-1">
            <li>Actieve accounts: zolang het account bestaat;</li>
            <li>Na verwijdering: nog 30 dagen, daarna definitief verwijderd;</li>
            <li>Financiële gegevens: 7 jaar, conform de wettelijke boekhoudplicht.</li>
          </ul>
        </Section>

        <Section title="5. Delen wij gegevens met derden">
          <p>
            Wij verkopen je gegevens nooit. Voor de werking van het platform schakelen wij de
            volgende verwerkers in, die uitsluitend in onze opdracht en onder een
            verwerkersovereenkomst gegevens verwerken:
          </p>
          <ul className="mt-3 space-y-1">
            <li><strong>Stripe</strong> — betalingsverwerking en uitbetalingen;</li>
            <li><strong>Neon (PostgreSQL)</strong> — opslag van databasegegevens;</li>
            <li><strong>Render</strong> — hosting van het platform;</li>
            <li><strong>Resend</strong> — verzenden van transactionele e-mails.</li>
          </ul>
          <p className="mt-3">
            Daarnaast kunnen wij gegevens delen wanneer wij daartoe wettelijk verplicht zijn.
          </p>
        </Section>

        <Section title="6. Uw rechten">
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

        <Section title="7. Beveiliging">
          <p>
            Wij nemen passende technische en organisatorische maatregelen om je gegevens te
            beschermen. Wachtwoorden worden uitsluitend versleuteld (gehasht) opgeslagen, verbindingen
            verlopen via versleuteld verkeer (HTTPS) en betalingsgegevens worden uitsluitend door
            Stripe verwerkt — wij slaan geen rauwe kaartgegevens op.
          </p>
        </Section>

        <Section title="8. Contact">
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
