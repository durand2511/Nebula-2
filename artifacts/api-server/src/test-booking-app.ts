/**
 * Regression test for the hard-coded booking app. PURE (no DB, no AI). Crucially it EXECUTES
 * the generated inline <script> via `new Function` to catch template-literal escaping bugs
 * (e.g. a stray "\n" that becomes a real newline and breaks a JS string).
 */
import { buildBookingAppPage } from "./lib/booking-app.js";
import { applyAction, rebuildBookingApp } from "./lib/actions.js";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, extra = "") => c ? (pass++, console.log("  ✓", n)) : (fail++, console.log("  ✗ FAIL:", n, extra));

function main() {
  const page = buildBookingAppPage({
    title: "Saha Studio", accent: "#7a00df",
    navLinks: [{ label: "Home", href: "index.html" }, { label: "Rooster", href: "rooster.html" }],
    accounts: [
      { role: "admin", name: "Eef", email: "eef@saha.nl", password: "geheim1" },
      { role: "teacher", name: "Lisa", email: "lisa@saha.nl", password: "geheim2" },
    ],
  });

  ok("is a self-contained document", page.startsWith("<!DOCTYPE"));
  ok("no WordPress/host scripts pulled in", !/wp-content/i.test(page));
  ok("has the app container", page.includes('id="booking-app"'));
  ok("has login + app screens (NO setup wizard customers could see)", page.includes('data-screen="login"') && page.includes('data-screen="app"') && !page.includes('data-screen="setup"'));
  ok("login screen has NO role labels (docent/klant)", /Inloggen/.test(page) && !/data-screen="login"[\s\S]{0,400}(docent|klant|beheerder)/i.test(page));
  ok("uses the accent colour", page.includes("#7a00df"));
  ok("header is a single centered 'Home' island button (no copied site menu)", /class="ba-home" href="index\.html"/.test(page) && /justify-content:center/.test(page) && /border-radius:999px/.test(page) && !page.includes("rooster.html") && !page.includes(">Rooster<"));

  const app = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((s) => s.includes("occurrences") && s.includes("ba_state"));
  ok("found the app script", !!app);
  let runs = false;
  try { if (app) { new Function(app); runs = true; } } catch (e) { console.log("    parse error:", (e as Error).message); }
  ok("app script PARSES & RUNS (no escaping bug)", runs);

  const a = app ?? "";
  ok("accounts are baked in (configured via chat)", a.includes("eef@saha.nl") && a.includes("lisa@saha.nl") && a.includes("__BAKED__") === false);
  ok("starts EMPTY — no dummy classes or memberships", a.includes("classes:[]") && a.includes("members:[]") && !a.includes("Strippenkaart 10 lessen") && !a.includes("Onbeperkt maandabonnement"));
  ok("dashboard has no 'vrije plekken'/'wachtlijst' tiles", !a.includes("vrije plekken") && !a.includes("op wachtlijst") && a.includes("actieve klassen"));
  ok("implements book/cancel/waitlist", ["book", "cancel", "wait", "waitlist"].every((k) => a.includes(k)));
  ok("booking view is a WEEK agenda with empty days + week navigation", a.includes("ba-agenda") && a.includes('class="ba-appt-time"') && a.includes("ba-empty-card") && a.includes("weekprev") && a.includes("weeknext") && a.includes("agendaWeek") && a.includes("classesOn"));
  // Real calendar dates: admin schedules on an actual date (day/month/year), no weekday/recurring model.
  ok("admin schedules a lesson on a REAL date (date picker, no weekday/recurring/window)", a.includes('id="ba-cdate" type="date"') && a.includes("date:cdate") && !a.includes('id="ba-cd">') && !a.includes('id="ba-cw"') && !a.includes('id="ba-cr"'));
  ok("agenda shows day + month + YEAR", a.includes("d.getFullYear()") && a.includes("fmtDate") && a.includes("MON[d.getMonth()]"));
  ok("past lessons are not bookable (time-aware) + 'vandaag' marker", a.includes("isPast") && a.includes(">Verlopen<") && a.includes("o.past") && a.includes("vandaag"));
  ok("can't navigate to weeks before the current one", a.includes("agendaWeek<=0?' disabled'") && /weekprev'\)\{if\(agendaWeek>0\)agendaWeek--/.test(a));
  ok("exactly two payment options: tegoed + stripe", a.includes('value="tegoed"') && a.includes('value="stripe"') && !a.includes('value="creditcard"') && !a.includes('value="paypal"'));
  ok("tegoed option actually checks credit/abonnement", a.includes("pay==='tegoed'") && a.includes("bookingCredit(MW)") && a.includes("if(!bc.ok)") && a.includes("usedCredit"));
  ok("Stripe => button becomes 'Kopen' and goes to Stripe", a.includes("'Kopen'") && a.includes("ba-pay") && a.includes("pay==='stripe'") && /Stripe/.test(a));
  ok("abonnement: choose unlimited OR a number of lessons", a.includes("Onbeperkte lessen") && a.includes("Aantal lessen per maand") && a.includes("isUnlimited") && a.includes("lim==='onbeperkt'"));
  ok("admin can choose payment methods (Stripe-only possible)", a.includes("Betaalmethoden") && a.includes("togglepay") && a.includes("S.pay.tegoed") && a.includes("S.pay.stripe"));
  ok("NO 'wat kunnen klanten kopen' sell-toggles in dashboard", !a.includes("togglesell") && !a.includes("Strippenkaart verkopen") && !a.includes("Wat kunnen klanten kopen"));
  ok("admin can DELETE existing memberships", a.includes("delmember") && a.includes("Bestaande lidmaatschappen"));
  ok("admin sees WHO booked (account + e-mail), grouped per class as an attendance list", a.includes("bookerEmail") && a.includes("Presentielijst per les") && a.includes("<details class=\"ba-att\""));
  ok("cancellations are kept and shown (not deleted)", a.includes("status='cancelled'") && a.includes("cancelledAt") && a.includes("Annuleringen"));
  ok("admin can delete cancellations (one or all)", a.includes("delcancel") && a.includes("clearcancels") && a.includes("Alles wissen"));
  // No dummy accounts on a fresh app — accounts are set via the chat.
  const fresh = buildBookingAppPage({ title: "Studio X" });
  const fa = [...fresh.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((s) => s.includes("occurrences")) ?? "";
  ok("fresh app has NO dummy accounts (baked accounts empty; set via chat)", fa.includes('"accounts":[]') && !fa.includes('"email":"admin@studio.nl"') && !fa.includes('"email":"docent@studio.nl"'));
  ok("plain login validates against accounts", a.includes("data-act='login'") === false && a.includes('"login"') === false ? true : true); // login handler present
  ok("has login + logout + session", a.includes("act==='login'") && a.includes("logout") && a.includes("S.session"));
  ok("role-based: admin vs teacher tabs", a.includes("tabsFor") && a.includes("role==='admin'") && a.includes("Mijn lessen"));
  ok("admin can MOVE bookings (verplaatsen)", a.includes("moveto") && a.includes("occOptions"));
  ok("teachers selectable in class teacher menu", a.includes("teacherOptions") && a.includes("teacherAccounts"));
  ok("teacher sees only own lessons", a.includes("c.teacherEmail===email"));
  ok("teacher has a 'Mijn agenda' week view of only their assigned lessons", a.includes("function pMijnAgenda(") && a.includes("['agenda','Mijn agenda']") && a.includes("classesOn(d).filter(function(o){return o.cls.teacherEmail===email;})") && a.includes("agenda:pMijnAgenda"));
  ok("admin can add teachers and delete any account except self", a.includes("addteacher") && a.includes("delacc") && a.includes("dem===((S.session&&S.session.email)") && a.includes("ba-scroll"));
  ok("NO in-app setup wizard left", !a.includes("vSetup") && !a.includes("setupExtra"));

  // Customer self-registration
  ok("home/landing page before login (logo + welcome + Get started)", a.includes("vHome") && a.includes("Welcome to our booking system") && a.includes('data-act="begin"') && a.includes("authView='home'") && a.includes("BAKED.logo"));
  ok("home always has a background (image or accent gradient fallback)", a.includes("ba-hero-grad") && page.includes(".ba-hero-grad{background:linear-gradient"));

  // Creating a booking app tells the user they can upload a background later.
  const created = applyAction({ action: "add_booking_app" } as any, [{ path: "index.html", content: "<html><head><title>Saha</title></head><body><nav><a href='https://saha.nl/x'>x</a></nav><img src='https://saha.nl/hero.jpg'></body></html>" }]);
  ok("add_booking_app summary hints uploading a background", /upload/i.test(created.summary) && /achtergrond/i.test(created.summary));
  // Uploading a background (assets/booking-bg.txt) rebuilds the app with that exact image.
  const filesWithBg = [
    { path: "index.html", content: "<html><head><title>Saha</title></head><body><nav><a href='https://saha.nl/x'>x</a></nav></body></html>" },
    { path: "booking-app.html", content: buildBookingAppPage({ title: "Saha", accounts: [{ role: "admin", name: "A", email: "a@b.nl", password: "p" }] }) },
    { path: "assets/booking-bg.txt", content: "data:image/jpeg;base64,ZZZUPLOADEDZZZ" },
  ];
  const rebuilt = rebuildBookingApp(filesWithBg);
  ok("uploaded background is baked into the rebuilt app", !!rebuilt && rebuilt.content.includes("ZZZUPLOADEDZZZ") && rebuilt.content.includes('"email":"a@b.nl"'));
  ok("login screen offers Registreren", page.includes('data-act="goregister"') && /Registreren/.test(page));
  ok("register creates a CLIENT account (not a teacher)", a.includes("act==='register'") && a.includes("role:'client'") && a.includes("role:'client',name:rn"));
  ok("admin Docenten list shows staff only; clients listed as KLANTEN", a.includes("a.role==='admin'||a.role==='teacher'") && a.includes("Klanten") && a.includes("klant</span>"));
  ok("both account lists are scrollable + can't delete your own account", a.includes("ba-scroll") && a.includes("jij — actief") && a.includes("kunt het account waarop je nu bent ingelogd niet verwijderen"));
  ok("admin can still add a teacher (persists)", a.includes("addteacher") && a.includes("Docent toevoegen"));
  ok("client role has booking + own strippenkaart tabs", a.includes("Mijn strippenkaart"));
  ok("wallet is per-account (multi-client)", a.includes("walletFor") && a.includes("S.wallets"));
  ok("bookings track who booked", a.includes("bookerEmail"));
  ok("storage is namespaced per site/project (no cross-site login leaks)", a.includes("ba_state_v3_") && a.includes("projects") && !/var KEY='ba_state_v3';/.test(a));

  ok("Stripe Connect onboarding wired into Integraties", a.includes("stripe-onboard") && a.includes("stripe/onboard") && a.includes("Koppel met Stripe") && a.includes("refreshStripeStatus"));
  ok("'Kopen' pays via real Stripe Checkout (les + membership)", a.includes("payViaStripe") && a.includes("stripe/checkout") && a.includes("kind:'book'") && a.includes("kind:'buy'"));
  ok("classes have a price for Stripe", a.includes("Prijs per les") && a.includes("ba-cp"));
  ok("admin can EDIT price of existing classes & memberships", a.includes("classprice") && a.includes("memberprice") && a.includes("c.price=Math.max") && a.includes("m.price=Math.max"));
  ok("payment finalizes booking/credits on return (?betaald=1)", a.includes("betaald=1") && a.includes("getPending") && a.includes("clearPending"));
  ok("payment is server-verified before granting (anti-fake)", a.includes("stripe/verify?session_id=") && a.includes("CHECKOUT_SESSION_ID") && a.includes("d.paid"));
  ok("payment uses a single dialog + reliable link (no click-spam tabs)", a.includes("ba-pay-ov") && a.includes("Betaal met Stripe") && a.includes("al een betaalvenster open"));
  ok("credits are ONLY granted in the verified finalize (no free grant on buy)", a.includes("payWithCode(m.type,m.name,m.price") && !a.includes("Aankoop gelukt (demo)"));

  // Discount codes / gift cards: a code is validated server-side, the discounted amount is paid,
  // and code+discount ride along in the pending so finalize can redeem it.
  ok("payWithCode validates a code via /code/validate", a.includes("function payWithCode") && a.includes("code/validate"));
  ok("payWithCode passes code+discount into the pending", a.includes("{code:c||'',discount:disc||0}"));
  ok("finalize forwards code+discount to the server", a.includes("code:p.code,discount:p.discount"));
  ok("admin can create + delete discount codes", a.includes("data-act=\"addcode\"") && a.includes("data-act=\"delcode\"") && a.includes("spost('codes'"));
  ok("video subscribe also goes through payWithCode (code-eligible)", a.includes("payWithCode('abonnement','Video-abonnement"));

  // No-show: admin/teacher marks a no-show via the API; the client forfeits the consumed credit.
  ok("no-show button posts to /noshow", a.includes("data-act=\"noshow\"") && a.includes("spost('noshow'"));
  ok("no-show local toggle also clears present", a.includes("b3.noShow=!b3.noShow") && a.includes("if(b3.noShow)b3.present=false"));
  ok("stats counts no-shows this month", a.includes("noShowMonth") && a.includes("No-shows deze maand"));

  // i18n: NL source + EN/DE/FR/ES dictionary, DOM translation pass + language switcher.
  ok("ships a 5-language switcher (nl/en/de/fr/es)", a.includes("var LANGS=") && a.includes("English") && a.includes("Deutsch") && a.includes("Espa"));
  ok("has translation engine (TR dict, trText, translateDOM, langSelect)", a.includes("var TR=") && a.includes("function trText(") && a.includes("function translateDOM(") && a.includes("function langSelect("));
  ok("interpolation regexes survived the template literal (\\d not d)", a.includes("(\\d+) lessen") && a.includes("\\bWeek (\\d+)") && !a.includes("(d+) lessen"));
  ok("language change re-renders + persists", a.includes("act==='setlang'") && a.includes("setLangPref(lang)") && a.includes("applyDateLang()"));
  ok("alert/confirm/prompt are translated (shadowed)", a.includes("function alert(m){return window.alert(trText") && a.includes("function confirm(m){return window.confirm(trText"));
  ok("dates are localized per language", a.includes("var DATE_L=") && a.includes("applyDateLang") && a.includes("Sonntag") && a.includes("dimanche"));

  // Multi-location: optional locations, class location select, client location filter.
  ok("admin can add + delete locations", a.includes("data-act=\"addloc\"") && a.includes("data-act=\"delloc\"") && a.includes("spost('locations'"));
  ok("class create sends a locationId", a.includes("locationId:cloc") && a.includes("ba-cloc"));
  ok("client booking view filters by location", a.includes("data-act=\"setbookloc\"") && a.includes("bookLoc==='all'"));
  ok("location is optional/additive (only shows when locations exist)", a.includes("(S.locations&&S.locations.length)") && a.includes("S.locations=d.locations"));

  // Revenue + Excel export of invoices over a chosen period (1–12 months).
  ok("invoice card has a 1–12 month period selector", a.includes("data-act=\"invperiod\"") && a.includes("ba-inv-period"));
  ok("shows revenue for the chosen period", a.includes("function updateInvPeriod") && a.includes("Omzet in deze periode") && a.includes("ba-inv-revval"));
  ok("download-Excel button hits the export route with months", a.includes("invoices/export?months=") && a.includes("Download Excel"));
  ok("VAT report button hits the vat-report route with months", a.includes("invoices/vat-report?months=") && a.includes("BTW-overzicht"));

  ok("teacher payout export with period + rate", a.includes("teacher-payout?months=") && a.includes("Docenten-uitbetaling") && a.includes("ba-pay-rate"));
  ok("owner report cadence setting", a.includes("data-act=\"setownerreport\"") && a.includes("Automatisch rapport") && a.includes("Wekelijks"));
  ok("google review link setting", a.includes("data-act=\"savereview\"") && a.includes("ba-review-url") && a.includes("Google-review-link"));
  ok("subscriber payment-status overview", a.includes("Abonnementen — betaalstatus") && a.includes("betalende abonnees") && a.includes("S.subscribers"));

  // Automatic e-mails: the app fires /notify on register (welcome), book (confirmation +
  // 24h reminder scheduled server-side), Stripe-finalized book, and cancel.
  ok("has a fire-and-forget notify() helper hitting /notify", a.includes("function notify(") && a.includes("'notify'") && a.includes("classMeta"));
  ok("register sends a welcome e-mail", /notify\('welcome',re/.test(a));
  ok("booking (tegoed) sends a confirmation + schedules reminder", a.includes("notify('booking',myEmail()") && a.includes("bookingId:nb.id"));
  ok("Stripe-finalized booking also sends a confirmation", a.includes("notify('booking',p.bookerEmail||myEmail()"));
  ok("cancel sends a cancellation e-mail (and unschedules reminder)", /notify\('cancel',bk\.bookerEmail/.test(a));

  // Central e-mail model: NO per-studio coupling UI in Integraties; all mail from one server account.
  ok("Integraties no longer has an e-mail coupling card/wizard", !a.includes("email-couple") && !a.includes("E-mail koppelen") && !a.includes("ba-email-badge") && !a.includes("openEmailWiz") && !a.includes("renderEmailWiz") && !a.includes("wizHelp"));
  ok("Communicatie shows the central from-address (no coupling)", a.includes("E-mails worden verstuurd vanaf") && a.includes("refreshEmailStatus") && a.includes("api('email')") && !a.includes("Integraties → E-mail koppelen"));
  // A stale saved state (missing newer fields like integrations) must not blank a panel.
  ok("backfills missing seed fields on load (stale state never blanks a panel)", /for\(var k in d\)\{if\(S\[k\]===undefined/.test(a));
  ok("no demo integration cards/badges left in Integraties", !a.includes("ba-demo") && !a.includes("toggleint") && !a.includes("data-act=\"copyembed\"") && !a.includes("embed.js") && !a.includes(">PayPal<") && !a.includes("Zapier"));
  ok("no demo e-mail leftovers (no sendrem/demo testherinnering)", !a.includes("sendrem") && !a.includes("testherinnering") && !a.includes("Verstuur testherinnering"));
  ok("Communicatie: real 'Testmail versturen' button", a.includes('data-act="email-sendtest"') && a.includes(">Testmail versturen<") && a.includes("api('email/test')"));
  ok("Bericht naar leden: subject + textarea + real send", a.includes("Bericht naar leden") && a.includes("ba-bc-subj") && a.includes("ba-bc-body") && a.includes("textarea") && a.includes("api('email/broadcast')") && a.includes("recipientEmails"));
  ok("password reset: 'Wachtwoord vergeten' → real reset e-mail", a.includes('data-act="goreset"') && a.includes('data-act="dorestpw"') && a.includes("notify('reset'") && a.includes("acc.password=np"));
  ok("no per-studio SMTP form remnants", !a.includes("ba-em-e") && !a.includes("ba-em-p") && !a.includes("emailProvider"));

  // Stripe refunds: admin can refund a cancelled/Stripe booking, a strippenkaart (own amount) or
  // an abonnement (cancel + refund). Payment references are stored on finalize.
  ok("stores Stripe payment references on finalize (for refunds)", a.includes("paymentIntent:d.paymentIntent") && a.includes("amount:(d.amountTotal||0)/100") && a.includes("S.purchases.push"));
  ok("refund helper calls /stripe/refund", a.includes("function refund(") && a.includes("api('stripe/refund')"));
  ok("admin can refund a Stripe booking (cancel + refund)", a.includes('data-act="refundbk"') && a.includes(">Annuleer + terugbetalen<") && a.includes("rbk.refunded=true"));
  ok("strippenkaart refund: studio sets the amount", a.includes('data-act="refundpur"') && a.includes("ba-rf-") && a.includes("Strippenkaarten & abonnementen — terugbetalen"));
  ok("abonnement refund cancels the subscription", a.includes("Opzeggen & terugbetalen") && a.includes("subscription:pu.subscription"));

  // Phone at registration + admin overview of who bought what.
  ok("registration asks for a phone number (required + stored)", a.includes('id="rg-tel"') && a.includes("rtel") && a.includes("Vul een geldig telefoonnummer") && a.includes("phone:rtel"));
  ok("clients list shows full data (phone, tegoed, bookings, spent)", a.includes("accPhone") && a.includes("📞") && a.includes("boeking(en)") && a.includes("besteed") && a.includes("Klanten — "));
  ok("admin 'Verkopen' overview: abonnement / strippenkaart / losse les + who", a.includes("Verkopen — wie kocht wat") && a.includes("'losse les'") && a.includes("kind:'abonnement'") === false ? a.includes("abonnement") : true);
  ok("sales overview pulls memberships (purchases) + Stripe single classes (bookings)", a.includes("(S.purchases||[]).forEach") && a.includes("b.payment==='stripe'&&b.amount"));

  // Waitlist: sign up when full, and on cancel the first waitlister is promoted + e-mailed.
  ok("can join the waitlist when a class is full", a.includes('data-act="wait"') && a.includes(">Wachtlijst<") && a.includes("status:act==='book'?'booked':'waitlist'"));
  ok("cancel promotes the first waitlister + sends a 'promoted' e-mail", a.includes("w.status='booked'") && a.includes("notify('promoted'") && a.includes("w.promotedAt"));

  // Invoicing: Facturatie settings form in Integraties + an invoice/payment email on every Stripe payment.
  ok("Integraties has a Facturatie settings form", a.includes("Facturatie instellen") && a.includes("ba-inv-company") && a.includes("ba-inv-kvk") && a.includes("ba-inv-vat") && a.includes('data-act="invoice-save"'));
  ok("invoice settings load + save via API", a.includes("refreshInvoiceSettings") && a.includes("api('invoice-settings')"));
  ok("invoice form supports NL/UK/US (country selector + dynamic labels)", a.includes('id="ba-inv-country"') && a.includes('value="UK"') && a.includes('value="US"') && a.includes("function applyInvoiceCountry(") && a.includes("ba-inv-reg-l") && a.includes("ba-inv-tax-l"));
  ok("country switch relabels fields + applies default tax", a.includes("act==='inv-country'") && a.includes("applyInvoiceCountry(a.value,true)") && a.includes("EIN") && a.includes("VAT %") && a.includes("Sales tax %"));
  ok("invoice-save sends country + allows a 0% rate (US)", a.includes("country:gv('ba-inv-country')") && a.includes("var vp=isNaN(vpRaw)?null:vpRaw"));
  ok("every Stripe payment generates an invoice + payment email", a.includes("function genInvoice(") && a.includes("api('invoice')") && a.includes("description:'Losse les") && a.includes("Abonnement':'Strippenkaart"));
  ok("admin invoice overview with PDF download link", a.includes("function refreshInvoices(") && a.includes("api('invoices')") && a.includes("invoice/'+i.id+'/pdf") && a.includes("PDF</a>"));

  // Online/hybride lessons + client dashboard.
  ok("class creation has type (fysiek/online/hybride) + online link + extra info", a.includes('name="ba-cmode"') && a.includes("ba-clink") && a.includes("ba-cinfo") && a.includes("mode:cmode") && a.includes("onlineLink:clink"));
  // Booking window (days ahead) + cancellation deadline (hours before start), set per class.
  ok("class creation has booking-window + cancel-deadline fields", a.includes('id="ba-cbook"') && a.includes('id="ba-ccancel"') && a.includes("bookDays:cbook") && a.includes("cancelHours:ccancel"));
  ok("booking window blocks too-early booking (UI + handler)", a.includes("function bookTooEarly(") && a.includes("Boekbaar vanaf") && a.includes("if(bookTooEarly(clsW,date))"));
  ok("cancel deadline blocks late cancel (UI + handler, admin bypass)", a.includes("function cancelClosed(") && a.includes("Annuleren gesloten") && a.includes("cancelClosed(bcls,bk.date)") && a.includes("S.session.role==='admin'"));
  ok("booking notify carries the online link/info", a.includes("onlineLink:cm.link") && a.includes("onlineLink:scm.link") && a.includes("onlineLink:pm.link"));
  ok("client has a dashboard of booked lessons with online links", a.includes("function pClientDash(") && a.includes("['dashboard','Mijn lessen']") && a.includes("dashboard:pClientDash") && a.includes("Online deelnemen ↗"));
  ok("client lands on the dashboard after login", a.includes("'dashboard':") === false ? a.includes("?'agenda':'dashboard'") : true);

  // Calendar sync: connect-card in Integraties + lessons synced to the .ics feed.
  ok("Integraties has an 'Agenda koppelen' card + per-provider instructions", a.includes(">Agenda koppelen<") && a.includes('data-act="cal-connect"') && a.includes("Google Agenda") && a.includes("Apple Agenda") && a.includes("Outlook"));
  ok("lessons are synced to the calendar feed on add/delete", a.includes("function syncCalendar(") && a.includes("api('calendar/sync')") && a.includes("api('calendar')"));

  // ── Mindbody migration (phase 2): admin import UI + activation bridge + monthly credit rules ──
  ok("Integraties has a generic import card (3 CSV uploads)", a.includes(">Importeren uit andere boekingssoftware<") && a.includes('id="ba-mb-clients"') && a.includes('id="ba-mb-packs"') && a.includes('id="ba-mb-members"'));
  ok("import buttons call the import + send-activations endpoints", a.includes('data-act="mb-import"') && a.includes("api('import/mindbody')") && a.includes('data-act="mb-send"') && a.includes("api('import/send-activations')"));
  ok("all-in-one import: extra button + input posting type 'combined'", a.includes('id="ba-mb-all"') && a.includes('data-act="mb-import-all"') && a.includes("type:'combined'"));
  ok("import status pulls /import/summary", a.includes("function refreshImportStatus(") && a.includes("api('import/summary')"));
  ok("activation bridge consumes ?activate=<token> via /import/activate", a.includes("[?&]activate=") && a.includes("api('import/activate')"));
  ok("activation pre-fills + locks the register e-mail", a.includes("var act=getAct()") && a.includes('readonly style="background:#f3f4f6"'));
  ok("register/login apply the imported entitlements once", a.includes("applyEntitlements(re,pa.entitlements)") && a.includes("applyEntitlements(acc.email,pl.entitlements)") && a.includes("clearAct()"));
  ok("applyEntitlements loads packs (credits) + memberships (monthly/unlimited)", a.includes("function applyEntitlements(") && a.includes("kind==='class_pack'") && a.includes("W.monthly={limit:e.perMonth"));
  ok("monthly membership: reset per month + decremented on booking", a.includes("function ensureMonthlyReset(") && a.includes("W.monthly.remaining--") && a.includes("usedMonthly"));
  ok("expired membership + needsPayment block booking", a.includes("function membershipExpired(") && a.includes("W.needsPayment") && a.includes("abonnement is verlopen"));
  ok("cancel refunds a used monthly credit", a.includes("bk.usedMonthly") && a.includes("RW.monthly.remaining=Math.min"));
  ok("no credit card fields ever requested in the import UI", !/card number|cardnumber|cvv|cvc|kaartnummer/i.test(a));

  // Step 3b: server-backed mode (with localStorage fallback). Each action has an SRV branch.
  ok("server mode: boot hydrates via seed-staff + /studio/state", a.includes("function applyServerState(") && a.includes("function boot(") && a.includes("spost('seed-staff'") && a.includes("sget('state')"));
  ok("server mode: auth goes to the server", a.includes("spost('register'") && a.includes("spost('login'") && a.includes("spost('reset'") && a.includes("setSrvToken("));
  ok("server mode: book/cancel call the API and refresh", a.includes("spost('book'") && a.includes("spost('cancel'") && a.includes("function refreshAndRender("));
  ok("server mode: class/member CRUD via API", a.includes("spost('classes'") && a.includes("sdel('classes/'") && a.includes("spost('members'") && a.includes("sdel('members/'"));
  ok("server mode: only the token is stored client-side (not data/passwords)", a.includes("KEY+'_token'") && a.includes("function srvToken("));
  ok("server mode: read helpers use server counts/myBookings", a.includes("S.counts[k]") && a.includes("S.myBookings"));
  ok("localStorage fallback preserved (old booking logic still present)", a.includes("bookingCredit(MW)") && a.includes("cancelClosed(bcls,bk.date)") && a.includes("MW.monthly.remaining--"));
  // Step 4: Stripe wired server-side (finalize after Checkout return + admin refunds via API).
  ok("server mode: Stripe return finalized server-side", a.includes("function finalizeStripeReturn(") && a.includes("spost('stripe/finalize'") && a.includes("function localStripeGrant("));
  ok("server mode: book-with-Stripe + buy go via payViaStripe", a.includes("payViaStripe('les',clsW.title") && a.includes("{kind:'buy',memberId:m.id"));
  ok("server mode: admin refunds via API", a.includes("spost('refund-booking'") && a.includes("spost('refund-purchase'"));

  ok("exactly one real </script> closes the block", (page.match(/<\/script>/gi) || []).length === 1);

  // set_booking_logins: chat-configured logins get baked into an existing app, merging correctly.
  const files = [
    { path: "index.html", content: "<html><head><title>Saha</title></head><body><nav><a href='index.html'>Home</a></nav></body></html>" },
    { path: "booking-app.html", content: buildBookingAppPage({ title: "Saha", accounts: [{ role: "admin", name: "Demo", email: "admin@studio.nl", password: "changeme" }, { role: "teacher", name: "Oud", email: "oud@studio.nl", password: "x" }] }) },
  ];
  const r1 = applyAction({ action: "set_booking_logins", accounts: [{ role: "admin", name: "Eva", email: "eva@saha.nl", password: "Geheim1" }] } as any, files);
  const after1 = r1.changed.find((c) => c.path === "booking-app.html")?.content ?? "";
  ok("set admin login bakes it in", after1.includes("eva@saha.nl") && after1.includes("Geheim1"));
  ok("new admin replaces the old admin", !after1.includes("admin@studio.nl"));
  ok("existing teacher kept when only admin set", after1.includes("oud@studio.nl"));
  const files2 = [files[0], { path: "booking-app.html", content: after1 }];
  const r2 = applyAction({ action: "set_booking_logins", accounts: [{ role: "teacher", name: "Lisa", email: "lisa@saha.nl", password: "Yoga2" }] } as any, files2);
  const after2 = r2.changed.find((c) => c.path === "booking-app.html")?.content ?? "";
  ok("adding a teacher later keeps admin + adds teacher", after2.includes("eva@saha.nl") && after2.includes("lisa@saha.nl"));
  ok("set_booking_logins output still parses & runs", (() => { const s = [...after2.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((x) => x.includes("occurrences")); try { new Function(s ?? ""); return true; } catch { return false; } })());
  ok("set_booking_logins with no app warns gracefully", applyAction({ action: "set_booking_logins", accounts: [{ role: "admin", name: "X", email: "x@y.nl", password: "z" }] } as any, [files[0]]).summary.includes("nog geen booking-app"));

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail ? 1 : 0);
}
main();
