// Algemene voorwaarden voor Nebula — nebulabookings.com (Nederlands recht).
export function Voorwaarden() {
  return (
    <div className="flex-1 w-full px-4 py-10 pb-24">
      <div className="mx-auto max-w-3xl rounded-2xl border border-border bg-card/95 backdrop-blur shadow-lg p-8 md:p-10">
        <h1 className="text-3xl font-bold tracking-tight">Algemene voorwaarden</h1>
        <p className="mt-2 text-sm text-foreground/50">Laatst bijgewerkt: 29 juni 2026</p>

        <p className="mt-6 text-foreground/80 leading-relaxed">
          Deze algemene voorwaarden zijn van toepassing op het gebruik van Nebula, een dienst van
          Durand van Konijnenburg (KVK 70776857), bereikbaar via nebulabookings.com.
        </p>

        <Section title="1. Definities">
          <ul className="space-y-1">
            <li><strong>Nebula</strong>: het platform en de dienst van Durand van Konijnenburg.</li>
            <li><strong>Klant</strong>: de studio of ondernemer die een account bij Nebula afneemt.</li>
            <li><strong>Eindgebruiker</strong>: de leerling/klant die via de website van de Klant boekt.</li>
          </ul>
        </Section>

        <Section title="2. Wat Nebula levert">
          <p>
            Nebula stelt software beschikbaar waarmee de Klant een website en een boekingssysteem kan
            opzetten en beheren, inclusief lesroosters, boekingen, betalingen via Stripe, facturatie,
            e-mailcommunicatie en gerelateerde functionaliteit. Nebula levert de dienst "as a service"
            (in de cloud); er wordt geen software aan de Klant overgedragen.
          </p>
        </Section>

        <Section title="3. Account en gebruik">
          <p>
            De Klant is verantwoordelijk voor het juist instellen van zijn account, voor de inhoud die
            hij plaatst en voor het vertrouwelijk houden van zijn inloggegevens. De Klant gebruikt het
            platform niet voor onrechtmatige doeleinden en zorgt zelf voor een correcte verwerking van
            de gegevens van zijn eindgebruikers.
          </p>
        </Section>

        <Section title="4. Betaling en opzegging">
          <ul className="space-y-1">
            <li>Het abonnement kost <strong>€69,99 per maand</strong> (inclusief btw, tenzij anders vermeld).</li>
            <li>De betaling verloopt maandelijks vooraf via Stripe.</li>
            <li>Het abonnement is <strong>maandelijks opzegbaar</strong>; bij opzegging loopt de toegang door tot het einde van de reeds betaalde periode.</li>
            <li>Aanvullend AI-tegoed en eventuele extra aankopen worden los in rekening gebracht.</li>
            <li>Reeds betaalde bedragen worden niet gerestitueerd, behoudens dwingend recht.</li>
          </ul>
        </Section>

        <Section title="5. Beschikbaarheid">
          <p>
            Nebula spant zich naar redelijkheid in voor een goede beschikbaarheid van het platform,
            maar geeft <strong>geen garantie op ononderbroken beschikbaarheid (uptime)</strong>.
            Onderhoud, storingen bij derden (zoals hosting- of betaaldiensten) of overmacht kunnen tot
            tijdelijke onderbrekingen leiden.
          </p>
        </Section>

        <Section title="6. Aansprakelijkheid">
          <p>
            De aansprakelijkheid van Nebula is beperkt tot directe schade en tot maximaal het bedrag
            dat de Klant in de drie maanden voorafgaand aan de schadeveroorzakende gebeurtenis heeft
            betaald. Nebula is niet aansprakelijk voor indirecte schade, gevolgschade, gederfde winst,
            gemiste besparingen of schade door uitval of fouten van ingeschakelde derden. Deze
            beperkingen gelden niet bij opzet of bewuste roekeloosheid van Nebula.
          </p>
        </Section>

        <Section title="7. Gegevensverwerking">
          <p>
            Op de verwerking van persoonsgegevens is ons{" "}
            <a className="text-primary font-medium hover:underline" href="/privacy">privacybeleid</a>{" "}
            van toepassing. Voor zover Nebula persoonsgegevens verwerkt in opdracht van de Klant,
            gebeurt dit als verwerker conform de AVG.
          </p>
        </Section>

        <Section title="8. Wijzigingen">
          <p>
            Nebula mag deze voorwaarden en de dienst van tijd tot tijd aanpassen. Wezenlijke
            wijzigingen worden vooraf aangekondigd. Door het platform te blijven gebruiken, ga je
            akkoord met de gewijzigde voorwaarden.
          </p>
        </Section>

        <Section title="9. Toepasselijk recht">
          <p>
            Op deze voorwaarden en op alle overeenkomsten met Nebula is <strong>Nederlands recht</strong>{" "}
            van toepassing.
          </p>
        </Section>

        <Section title="10. Contact">
          <ul className="space-y-1">
            <li>Durand van Konijnenburg</li>
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
