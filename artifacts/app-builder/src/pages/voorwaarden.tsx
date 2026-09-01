// Algemene voorwaarden voor Nebula — nebulabookings.com (Nederlands recht).
export function Voorwaarden() {
  return (
    <div className="flex-1 w-full px-4 py-10 pb-24">
      <div className="mx-auto max-w-3xl rounded-2xl border border-border bg-card/95 backdrop-blur shadow-lg p-8 md:p-10">
        <h1 className="text-3xl font-bold tracking-tight">Algemene voorwaarden</h1>
        <p className="mt-2 text-sm text-foreground/50">Laatst bijgewerkt: 1 september 2026</p>

        <p className="mt-6 text-foreground/80 leading-relaxed">
          Deze algemene voorwaarden zijn van toepassing op alle opdrachten en
          overeenkomsten van Nebula, een web design bureau van Durand van Konijnenburg
          (KVK 70776857), bereikbaar via nebulabookings.com.
        </p>

        <Section title="1. Definities">
          <ul className="space-y-1">
            <li><strong>Nebula</strong>: het web design bureau van Durand van Konijnenburg.</li>
            <li><strong>Klant</strong>: de ondernemer of organisatie die Nebula een opdracht geeft.</li>
            <li><strong>Website</strong>: de website, webapplicatie of het digitale product dat Nebula in opdracht van de Klant ontwerpt en bouwt.</li>
            <li><strong>Oplevering</strong>: het moment waarop Nebula de Website aan de Klant overdraagt en de Klant daar zelf toegang toe heeft.</li>
          </ul>
        </Section>

        <Section title="2. Wat Nebula levert">
          <p>
            Nebula ontwerpt en bouwt websites, webapplicaties en andere digitale producten op maat.
            Nebula werkt daarbij met AI-ontwikkeltools, in het bijzonder <strong>Claude Code</strong>,
            waarmee vrijwel alles gemaakt kan worden: van een eenvoudige zakelijke website tot
            complete webapplicaties met eigen functionaliteit, koppelingen en SEO. Het ontwerpen en
            bouwen zelf brengt Nebula niet apart in rekening: de Klant betaalt per opdracht alleen
            een vast maandbedrag voor het gebruik van Claude Code (zie artikel 5).
          </p>
        </Section>

        <Section title="3. Eigendom en beheer">
          <p>
            Na oplevering en volledige betaling is de Klant <strong>volledig eigenaar</strong> van de
            Website, inclusief het ontwerp, de inhoud en de broncode die specifiek voor de Klant is
            gemaakt. De Klant is tevens <strong>zelf beheerder</strong> van de Website: de Klant
            beschikt over de toegang tot de Website, het domein en (indien van toepassing) de hosting
            en kan de Website naar eigen inzicht aanpassen, verplaatsen of laten onderhouden door
            derden. Nebula behoudt geen rechten op de Website en maakt geen aanspraak op het domein
            van de Klant.
          </p>
          <p className="mt-3">
            Generieke tools, bibliotheken en werkwijzen die Nebula ook voor andere projecten gebruikt,
            blijven eigendom van Nebula of van de betreffende licentiegevers. Nebula mag de opgeleverde
            Website tonen als referentie in haar portfolio, tenzij de Klant daar bezwaar tegen maakt.
          </p>
        </Section>

        <Section title="4. Verantwoordelijkheden van de Klant">
          <p>
            De Klant levert tijdig de informatie, teksten, afbeeldingen en toegangen aan die nodig zijn
            voor de opdracht en staat ervoor in dat hij daar de rechten op heeft. Na oplevering is de
            Klant als eigenaar en beheerder zelf verantwoordelijk voor de inhoud, het gebruik, de
            beveiliging van zijn inloggegevens en de naleving van wet- en regelgeving (waaronder de
            AVG) op zijn Website.
          </p>
        </Section>

        <Section title="5. Prijs en betaling">
          <ul className="space-y-1">
            <li>Nebula werkt niet met offertes of uurtarieven. Per opdracht betaalt de Klant uitsluitend een <strong>vast bedrag per maand voor Claude Code</strong>, de AI-ontwikkeltool waarmee de Website wordt gebouwd.</li>
            <li>Het ontwerp- en bouwwerk van Nebula zelf wordt niet apart in rekening gebracht.</li>
            <li>Het maandbedrag wordt per maand vooraf betaald en is <strong>maandelijks opzegbaar</strong>; na opzegging blijft de Klant eigenaar en beheerder van alles wat tot dan toe is opgeleverd.</li>
            <li>Prijzen zijn inclusief btw, tenzij anders vermeld.</li>
            <li>Kosten van derden die de Klant zelf afneemt (zoals domeinregistratie of hosting bij een externe partij) vallen buiten het maandbedrag.</li>
          </ul>
        </Section>

        <Section title="6. Oplevering en feedback">
          <p>
            Nebula levert de Website op zoals met de Klant afgesproken. De Klant krijgt de gelegenheid
            om de Website te beoordelen en binnen de afgesproken feedbackrondes wijzigingen door te
            geven. Als de Klant niet binnen 14 dagen na oplevering reageert, geldt de Website als
            geaccepteerd.
          </p>
        </Section>

        <Section title="7. Beschikbaarheid en hosting">
          <p>
            Als de Klant de Website bij een derde partij host, is die partij verantwoordelijk voor de
            beschikbaarheid. Als Nebula in opdracht van de Klant de hosting verzorgt, spant Nebula zich
            naar redelijkheid in voor een goede beschikbaarheid, maar geeft{" "}
            <strong>geen garantie op ononderbroken beschikbaarheid (uptime)</strong>. Onderhoud,
            storingen bij derden of overmacht kunnen tot tijdelijke onderbrekingen leiden.
          </p>
        </Section>

        <Section title="8. Aansprakelijkheid">
          <p>
            De aansprakelijkheid van Nebula is beperkt tot directe schade en tot maximaal het bedrag
            dat de Klant in de drie maanden voorafgaand aan de schadeveroorzakende gebeurtenis voor
            de betreffende opdracht heeft betaald. Nebula is niet aansprakelijk voor
            indirecte schade, gevolgschade, gederfde winst, gemiste besparingen of schade door uitval
            of fouten van ingeschakelde derden, noch voor wijzigingen die de Klant of derden na
            oplevering aan de Website aanbrengen. Deze beperkingen gelden niet bij opzet of bewuste
            roekeloosheid van Nebula.
          </p>
        </Section>

        <Section title="9. Gegevensverwerking">
          <p>
            Op de verwerking van persoonsgegevens is ons{" "}
            <a className="text-primary font-medium hover:underline" href="/privacy">privacybeleid</a>{" "}
            van toepassing. De Klant is als eigenaar en beheerder van zijn Website de
            verwerkingsverantwoordelijke voor de gegevens van zijn bezoekers. Voor zover Nebula
            tijdens het project of bij onderhoud persoonsgegevens verwerkt in opdracht van de Klant,
            gebeurt dit als verwerker conform de AVG.
          </p>
        </Section>

        <Section title="10. Wijzigingen">
          <p>
            Nebula mag deze voorwaarden en het maandbedrag van tijd tot tijd aanpassen. Wezenlijke
            wijzigingen worden vooraf aangekondigd; de Klant kan de opdracht dan maandelijks opzeggen.
          </p>
        </Section>

        <Section title="11. Toepasselijk recht">
          <p>
            Op deze voorwaarden en op alle overeenkomsten met Nebula is <strong>Nederlands recht</strong>{" "}
            van toepassing.
          </p>
        </Section>

        <Section title="12. Contact">
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
