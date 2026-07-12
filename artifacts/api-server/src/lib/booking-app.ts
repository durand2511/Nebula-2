/**
 * HARD-CODED booking app — inserted deterministically (no AI generation) when a user asks
 * for a "booking app". A self-contained, working front-end: all client + studio features run
 * in the browser via localStorage. Backend-dependent features (Stripe, e-mail, Zoom/Calendar/
 * Zapier/Mailchimp, native apps) are shown as polished demo UI, ready to wire to a real backend.
 *
 * The whole app is scoped under #booking-app and uses `font-family: inherit` + the site's
 * primary colour (var(--buildly-primary)) so it blends into the host site's styling.
 *
 * NOTE: the app's own JS uses string concatenation (no backticks / no ${...}) on purpose, so
 * this module can hold it inside a single template literal without escaping headaches.
 */

const BOOKING_APP_MAIN = `<section id="booking-app">
<style>
#booking-app{--ba:#c8b89a;--ba-bg:#0f0f0f;--ba-line:rgba(255,255,255,.10);--ba-line2:rgba(255,255,255,.17);--ba-ink:#f2f0ea;--ba-muted:#9a968c;--ba-card:rgba(255,255,255,.035);--ba-ring:rgba(200,184,154,.35);position:relative;z-index:1;font-family:inherit;color:var(--ba-ink);max-width:1080px;margin:0 auto;padding:28px 20px 72px;box-sizing:border-box;-webkit-font-smoothing:antialiased}
#booking-app *{box-sizing:border-box}
#booking-app .ba-h{font-family:'Instrument Serif',Georgia,serif;font-size:44px;font-weight:400;letter-spacing:-.01em;line-height:1.05;margin:0 0 6px;color:#fff}
#booking-app .ba-sub{color:var(--ba-muted);margin:0 0 24px;font-size:14px;font-weight:300}
#booking-app .ba-tabs{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;padding:6px;background:rgba(14,14,14,.9);border:1px solid var(--ba-line);border-radius:14px;overflow-x:auto;backdrop-filter:blur(14px);position:sticky;top:10px;z-index:20}
#booking-app .ba-appsec{padding:34px 0 8px;border-top:1px solid var(--ba-line);margin-top:22px;scroll-margin-top:90px}
#booking-app .ba-appsec:first-child{border-top:0;margin-top:8px;padding-top:14px}
#booking-app .ba-tab{appearance:none;border:0;background:none;font:inherit;font-weight:500;font-size:13.5px;color:var(--ba-muted);padding:9px 16px;cursor:pointer;border-radius:10px;white-space:nowrap;transition:background .2s,color .2s;letter-spacing:.01em}
#booking-app .ba-tab:hover{color:var(--ba-ink);background:rgba(255,255,255,.05)}
#booking-app .ba-tab.is-on{color:#0a0a0a;background:var(--ba);font-weight:600}
#booking-app .ba-panel{display:none;animation:bafade .3s ease}
#booking-app .ba-panel.is-on{display:block}
@keyframes bafade{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
#booking-app .ba-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px}
#booking-app .ba-card{border:1px solid var(--ba-line);border-radius:16px;padding:20px;background:var(--ba-card);backdrop-filter:blur(10px)}
#booking-app .ba-card h4{margin:0 0 3px;font-size:16px;font-weight:600;letter-spacing:-.01em;color:#fff}
#booking-app .ba-meta{color:var(--ba-muted);font-size:13px;margin:0 0 12px;line-height:1.5;font-weight:300}
#booking-app .ba-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px;margin-bottom:26px}
#booking-app .ba-stat{border:1px solid var(--ba-line);border-radius:16px;padding:20px 18px;background:var(--ba-card);backdrop-filter:blur(10px);transition:transform .2s,border-color .2s}
#booking-app .ba-stat:hover{transform:translateY(-3px);border-color:var(--ba-ring)}
#booking-app .ba-stat b{display:block;font-family:'Instrument Serif',serif;font-size:38px;line-height:1;font-weight:400;color:var(--ba);letter-spacing:-.01em}
#booking-app .ba-stat span{color:var(--ba-muted);font-size:13px;font-weight:300}
#booking-app .ba-btn{appearance:none;border:0;border-radius:11px;background:var(--ba);color:#0a0a0a;font:inherit;font-weight:600;font-size:14px;padding:11px 18px;cursor:pointer;transition:filter .2s,box-shadow .2s,transform .05s;letter-spacing:.01em}
#booking-app .ba-btn:hover{filter:brightness(1.08);box-shadow:0 6px 22px -6px var(--ba-ring)}
#booking-app .ba-btn:active{transform:translateY(1px)}
#booking-app .ba-btn:focus-visible{outline:none;box-shadow:0 0 0 3px var(--ba-ring)}
#booking-app .ba-btn[disabled]{opacity:.4;cursor:not-allowed;box-shadow:none;filter:none}
#booking-app .ba-btn.ghost{background:transparent;color:var(--ba-ink);border:1px solid var(--ba-line2)}
#booking-app .ba-btn.ghost:hover{background:rgba(255,255,255,.06);filter:none}
#booking-app .ba-btn.warn{background:transparent;color:#f87171;border:1px solid rgba(248,113,113,.4)}
#booking-app .ba-btn.warn:hover{background:rgba(248,113,113,.12);filter:none}
#booking-app .ba-btn.warn:focus-visible{box-shadow:0 0 0 3px rgba(248,113,113,.25)}
#booking-app .ba-btn.sm{padding:8px 13px;font-size:13px;border-radius:9px}
#booking-app .ba-badge{display:inline-flex;align-items:center;gap:4px;font-size:12px;font-weight:500;padding:3px 11px;border-radius:999px;background:rgba(255,255,255,.07);color:var(--ba-ink);border:1px solid var(--ba-line)}
#booking-app .ba-badge.full{background:rgba(248,113,113,.14);color:#f87171;border-color:rgba(248,113,113,.35)}
#booking-app .ba-badge.ok{background:rgba(52,211,153,.14);color:#34d399;border-color:rgba(52,211,153,.35)}
#booking-app .ba-badge.warn{background:rgba(251,191,36,.14);color:#fbbf24;border-color:rgba(251,191,36,.35)}
#booking-app .ba-att{border:1px solid var(--ba-line);border-radius:12px;margin-bottom:8px;overflow:hidden;background:var(--ba-card)}
#booking-app .ba-att>summary{cursor:pointer;padding:12px 14px;font-size:15px;list-style:none;background:rgba(255,255,255,.03);user-select:none;color:var(--ba-ink)}
#booking-app .ba-att>summary::-webkit-details-marker{display:none}
#booking-app .ba-att>summary:before{content:"\\25B8";display:inline-block;margin-right:8px;color:var(--ba-muted);transition:transform .15s}
#booking-app .ba-att[open]>summary:before{transform:rotate(90deg)}
#booking-app .ba-att[open]>summary{border-bottom:1px solid var(--ba-line)}
#booking-app .ba-att .ba-item{margin:0;border-radius:0;border:0;border-bottom:1px solid var(--ba-line);padding:10px 14px}
#booking-app .ba-att .ba-item:last-child{border-bottom:0}
#booking-app .ba-row{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
#booking-app label.ba-f{display:block;font-size:13px;font-weight:500;color:var(--ba-ink);margin:12px 0 5px}
#booking-app input,#booking-app select,#booking-app textarea{font:inherit;font-size:14px;width:100%;min-height:44px;padding:11px 13px;border:1px solid var(--ba-line2);border-radius:11px;background:rgba(255,255,255,.04);color:var(--ba-ink);transition:border-color .2s,box-shadow .2s}
#booking-app input::placeholder,#booking-app textarea::placeholder{color:#6f6b62}
#booking-app input:focus,#booking-app select:focus,#booking-app textarea:focus{outline:none;border-color:var(--ba);box-shadow:0 0 0 3px var(--ba-ring)}
#booking-app select option{background:#141414;color:var(--ba-ink)}
#booking-app .ba-2{display:grid;grid-template-columns:1fr 1fr;gap:14px}
#booking-app .ba-list{display:flex;flex-direction:column;gap:10px}
#booking-app .ba-scroll{max-height:320px;overflow-y:auto;padding-right:6px}
#booking-app .ba-agenda{display:flex;flex-direction:column;gap:18px}
#booking-app .ba-day-h{font-family:'Instrument Serif',serif;font-weight:400;font-size:22px;text-transform:capitalize;margin:0 0 12px;padding-bottom:8px;border-bottom:1px solid var(--ba-line);color:#fff}
#booking-app .ba-appt{display:flex;gap:14px;align-items:stretch;margin-bottom:10px}
#booking-app .ba-appt-time{flex:0 0 72px;font-weight:500;font-size:14px;color:var(--ba-muted);padding-top:15px;text-align:right;white-space:nowrap}
#booking-app .ba-appt-card{flex:1;border:1px solid var(--ba-line);border-left:3px solid var(--ba);border-radius:12px;padding:13px 15px;background:var(--ba-card);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;transition:border-color .2s,transform .2s}
#booking-app .ba-appt-card:hover{transform:translateX(2px);border-left-color:#e6d9bf}
#booking-app .ba-appt-card.is-full{border-left-color:#f87171}
#booking-app .ba-appt-card.is-mine{border-left-color:#34d399;background:rgba(52,211,153,.08)}
#booking-app .ba-appt-main{min-width:0}
#booking-app .ba-appt-main b{font-size:15px;color:#fff;font-weight:500}
#booking-app .ba-empty{display:flex;gap:14px}
#booking-app .ba-empty .ba-empty-card{flex:1;border:1px dashed var(--ba-line2);border-radius:12px;padding:12px 14px;color:#6f6b62;font-size:13px;font-style:italic;margin-left:70px}
#booking-app .ba-weeknav{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:18px}
#booking-app .ba-weeknav b{font-size:16px;color:#fff;font-weight:500}
#booking-app .ba-item{border:1px solid var(--ba-line);border-radius:13px;padding:14px 16px;background:var(--ba-card);backdrop-filter:blur(8px);transition:border-color .2s,transform .2s}
#booking-app .ba-item:hover{border-color:var(--ba-ring);transform:translateY(-1px)}
#booking-app .ba-note{font-size:12px;color:#6f6b62;margin-top:8px;line-height:1.5}
#booking-app pre{background:rgba(0,0,0,.5);color:#d8d3c7;padding:12px;border-radius:10px;overflow:auto;font-size:12px;border:1px solid var(--ba-line)}
@media(max-width:560px){#booking-app{padding:18px 14px 56px}#booking-app .ba-2{grid-template-columns:1fr}#booking-app .ba-card{padding:16px}#booking-app .ba-h{font-size:34px}#booking-app .ba-row{gap:8px}#booking-app .ba-tabs{gap:5px}}
#booking-app .ba-hero2{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;position:relative;padding:60px 20px;overflow:visible;border-radius:0}
#booking-app .ba-hero2>*{position:relative;z-index:1}
#booking-app .ba-status{display:inline-flex;align-items:center;gap:10px;background:rgba(255,255,255,.06);border:1px solid var(--ba-line2);border-radius:999px;padding:9px 18px;font-size:13px;color:var(--ba-ink);text-align:left}
#booking-app .ba-status .sd{width:8px;height:8px;border-radius:50%;background:#34d399;box-shadow:0 0 0 0 rgba(52,211,153,.6);animation:bapulse 2s infinite}
#booking-app .ba-status.full .sd{background:#f87171;box-shadow:0 0 0 0 rgba(248,113,113,.6);animation:bapulseR 2s infinite}
@keyframes bapulseR{0%{box-shadow:0 0 0 0 rgba(248,113,113,.5)}70%{box-shadow:0 0 0 7px rgba(248,113,113,0)}100%{box-shadow:0 0 0 0 rgba(248,113,113,0)}}
#booking-app .ba-status .sl{display:block;font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:var(--ba-muted)}
@keyframes bapulse{0%{box-shadow:0 0 0 0 rgba(52,211,153,.5)}70%{box-shadow:0 0 0 7px rgba(52,211,153,0)}100%{box-shadow:0 0 0 0 rgba(52,211,153,0)}}
#booking-app .ba-clock{position:absolute;top:16px;right:18px;z-index:2;font-family:'Inter';font-size:11px;letter-spacing:.14em;color:var(--ba-muted);text-transform:uppercase}
#booking-app .ba-hero2-bg{position:absolute !important;inset:0;z-index:0 !important;overflow:hidden;pointer-events:none;background:#0a0a0a}
#booking-app .ba-hero2-bg iframe{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:100vw;height:56.25vw;min-height:100%;min-width:177.78vh;border:0;pointer-events:none;opacity:.6}
#booking-app .ba-hero2-bg::after{content:"";position:absolute;inset:0;background:radial-gradient(130% 130% at 50% 0%,rgba(10,10,10,.3),rgba(10,10,10,.9))}
#booking-app .ba-hero2.sm{min-height:auto;padding:14px 0 6px;align-items:flex-start;text-align:left}
#booking-app .ba-hero2 .eyebrow2{font-family:'Inter';font-size:12px;letter-spacing:.28em;text-transform:uppercase;color:#c8b89a;margin-bottom:20px;font-weight:500}
#booking-app .ba-hero2 h1{font-family:'Instrument Serif',serif;font-weight:400;font-size:clamp(46px,9vw,92px);line-height:.98;letter-spacing:-.02em;margin:0 0 18px;color:#fff}
#booking-app .ba-hero2.sm h1{font-size:clamp(34px,6vw,58px);margin:0}
#booking-app .ba-hero2 .sub2{font-size:18px;color:var(--ba-muted);max-width:46ch;margin:0 0 30px;font-weight:300;line-height:1.5}
#booking-app .ba-hero2 .cta2{display:flex;gap:12px;flex-wrap:wrap;justify-content:center;align-items:center}
#booking-app .ba-hero2.sm .cta2{justify-content:flex-start}
#booking-app .ba-scrolldown{position:absolute;bottom:6px;left:50%;transform:translateX(-50%);color:var(--ba-muted);font-size:11px;letter-spacing:.18em;text-transform:uppercase;text-decoration:none;display:flex;flex-direction:column;align-items:center;gap:9px}
#booking-app .ba-scrolldown:hover{color:var(--ba-ink)}
#booking-app .ba-scrolldown .dot{width:28px;height:28px;border:1px solid var(--ba-line2);border-radius:50%;display:flex;align-items:center;justify-content:center;animation:babob 1.8s ease-in-out infinite}
@keyframes babob{0%,100%{transform:translateY(0)}50%{transform:translateY(6px)}}
#booking-app .ba-section{padding:44px 0 6px;border-top:1px solid var(--ba-line);margin-top:26px;scroll-margin-top:80px}
#booking-app .ba-secnum{font-family:'Inter';font-size:12px;letter-spacing:.24em;text-transform:uppercase;color:#c8b89a;margin:0 0 10px;font-weight:500}
#booking-app .ba-section-h{font-family:'Instrument Serif',serif;font-weight:400;font-size:clamp(28px,4vw,44px);color:#fff;margin:0 0 18px;letter-spacing:-.01em}
#booking-app .ba-island{background:rgba(18,18,18,.6);backdrop-filter:blur(18px);border:1px solid var(--ba-line2);box-shadow:0 30px 80px -20px rgba(0,0,0,.65);padding:24px}
#booking-app .ba-segt{display:flex;gap:4px;background:rgba(255,255,255,.05);border:1px solid var(--ba-line);border-radius:12px;padding:4px;margin-bottom:16px}
#booking-app .ba-seg{flex:1;appearance:none;border:0;background:none;font:inherit;font-weight:500;font-size:14px;color:var(--ba-muted);padding:10px;border-radius:9px;cursor:pointer;transition:all .2s}
#booking-app .ba-seg.is-on{background:var(--ba);color:#0a0a0a;font-weight:600}
#booking-app .ba-auth{max-width:480px;margin:8vh auto 10px}
#booking-app .ba-auth h2{font-family:'Instrument Serif',serif;font-size:40px;font-weight:400;margin:0 0 6px;color:#fff}
#booking-app .ba-3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px}
@media(max-width:560px){#booking-app .ba-3{grid-template-columns:1fr}}
</style>

<div class="ba-screen" data-screen="login"></div>
<div class="ba-screen" data-screen="app" style="display:none"></div>

<script>
(function(){
  var root=document.getElementById('booking-app'); if(!root||root.__init)return; root.__init=1;
  // Storage is namespaced PER SITE/PROJECT so logins, bookings and accounts never leak from
  // one website's booking app into another's (the preview shares one localStorage origin).
  var KEY=(function(){var id='';try{var m=(location.pathname||'').match(/projects\\/(\\d+)/);if(m)id=m[1];}catch(e){}
    if(!id){try{id=(location.hostname||'')+(location.pathname||'');}catch(e){}}
    return 'ba_state_v3_'+(id||'default').replace(/[^a-zA-Z0-9_-]+/g,'-');})();
  // ── i18n: meertalige klant- + beheer-interface (NL is de bron, rest via woordenboek) ──
  var LANGS={nl:'Nederlands',en:'English',de:'Deutsch',fr:'Fran\\u00e7ais',es:'Espa\\u00f1ol'};
  function getLang(){try{var v=localStorage.getItem('ba_lang');if(v&&LANGS[v])return v;}catch(e){}return 'nl';}
  function setLangPref(l){try{localStorage.setItem('ba_lang',l);}catch(e){}}
  var lang=getLang();
  var DATE_L={
    nl:{DOW:['zo','ma','di','wo','do','vr','za'],DOWF:['zondag','maandag','dinsdag','woensdag','donderdag','vrijdag','zaterdag'],MON:['jan','feb','mrt','apr','mei','jun','jul','aug','sep','okt','nov','dec']},
    en:{DOW:['Sun','Mon','Tue','Wed','Thu','Fri','Sat'],DOWF:['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'],MON:['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']},
    de:{DOW:['So','Mo','Di','Mi','Do','Fr','Sa'],DOWF:['Sonntag','Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag'],MON:['Jan','Feb','M\\u00e4r','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez']},
    fr:{DOW:['dim','lun','mar','mer','jeu','ven','sam'],DOWF:['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'],MON:['janv','f\\u00e9vr','mars','avr','mai','juin','juil','ao\\u00fbt','sept','oct','nov','d\\u00e9c']},
    es:{DOW:['dom','lun','mar','mi\\u00e9','jue','vie','s\\u00e1b'],DOWF:['domingo','lunes','martes','mi\\u00e9rcoles','jueves','viernes','s\\u00e1bado'],MON:['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']}
  };
  var DOW,DOWF,MON;
  function applyDateLang(){var L=DATE_L[lang]||DATE_L.nl;DOW=L.DOW;DOWF=L.DOWF;MON=L.MON;}
  applyDateLang();
  var activeTab='boeken';
  var authView='browse';
  var SRV=false; // server-mode: data komt van de API i.p.v. localStorage (gezet tijdens boot)
  var videoCat='yoga'; // gekozen categorie in de Video's-tab
  var agendaWeek=0; // 0 = deze week; navigeren met de week-knoppen
  var bookLoc='all'; // locatiefilter in de boekweergave ('all' of een locationId)
  var _invRows=[]; // geladen facturen (admin) voor de omzet + Excel-export per periode
  // Accounts are configured VIA THE CHAT (the AI asks) and baked into the line below by
  // buildBookingAppPage, so customers never see a setup screen — only a plain login.
  var BAKED=__BAKED__;
  function bakedAccounts(){return ((BAKED&&BAKED.accounts)||[]).map(function(a){return {role:a.role,name:a.name,email:(a.email||'').toLowerCase(),password:a.password};});}
  function uid(){return Date.now().toString(36)+Math.floor(Math.random()*1e4).toString(36);}
  function pad(n){return (n<10?'0':'')+n;}
  function ymd(d){return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());}
  // Is this date+time already in the past? (so you can't book lessons that have started/passed)
  function isPast(dateStr,time){try{return new Date((dateStr||'')+'T'+(time||'00:00')+':00').getTime()<Date.now();}catch(e){return false;}}
  // The exact start moment of a lesson (date + time) as a timestamp.
  function lessonStart(cls,date){try{return new Date((date||'')+'T'+((cls&&cls.time)||'00:00')+':00').getTime();}catch(e){return NaN;}}
  // Booking window: bookDays = how many days BEFORE the lesson booking opens (0 = no limit).
  function bookTooEarly(cls,date){var bd=cls&&cls.bookDays;if(!bd||bd<=0)return false;var t=lessonStart(cls,date);return !isNaN(t)&&Date.now()<t-bd*86400000;}
  function bookOpensOn(cls,date){var bd=cls&&cls.bookDays;if(!bd||bd<=0)return '';var t=lessonStart(cls,date);if(isNaN(t))return '';return ymd(new Date(t-bd*86400000));}
  // Cancellation deadline: cancelHours = until how many hours before the start you may cancel (0 = always).
  function cancelClosed(cls,date){var ch=cls&&cls.cancelHours;if(!ch||ch<=0)return false;var t=lessonStart(cls,date);return !isNaN(t)&&Date.now()>t-ch*3600000;}
  // Readable date like "ma 23 jun 2026" from a YYYY-MM-DD string.
  function fmtDate(dateStr){var p=(dateStr||'').split('-');if(p.length!==3)return dateStr||'';var d=new Date(+p[0],+p[1]-1,+p[2]);return DOW[d.getDay()]+' '+d.getDate()+' '+MON[d.getMonth()]+' '+d.getFullYear();}
  function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}

  // ---------- i18n engine ----------
  // TR: exact phrase (Dutch source) -> [en,de,fr,es]. SUB: regex rules for interpolated/embedded
  // text. Anything not found stays Dutch (graceful fallback). Apostrophes use \\u2019 (’) so they
  // never close the single-quoted strings.
  function LIDX(){return {en:0,de:1,fr:2,es:3}[lang];}
  var TR={
    // tabs
    'Lessen boeken':['Book classes','Kurse buchen','Réserver des cours','Reservar clases'],
    'Studio-beheer':['Studio admin','Studio-Verwaltung','Gestion du studio','Administración del estudio'],
    'Docenten':['Teachers','Lehrer','Enseignants','Profesores'],
    'Lidmaatschappen':['Memberships','Mitgliedschaften','Abonnements','Membresías'],
    'Videos':['Videos','Videos','Vidéos','Vídeos'],
    'Statistieken':['Statistics','Statistiken','Statistiques','Estadísticas'],
    'Communicatie':['Communication','Kommunikation','Communication','Comunicación'],
    'Integraties':['Integrations','Integrationen','Intégrations','Integraciones'],
    'Mijn agenda':['My calendar','Mein Kalender','Mon agenda','Mi agenda'],
    'Mijn lessen':['My classes','Meine Kurse','Mes cours','Mis clases'],
    'Mijn strippenkaart':['My class pass','Meine Karte','Ma carte','Mi bono'],
    'Abonnementen':['Subscriptions','Abonnements','Abonnements','Suscripciones'],
    // header / auth
    'Boekingen':['Bookings','Buchungen','Réservations','Reservas'],
    'Uitloggen':['Log out','Abmelden','Se déconnecter','Cerrar sesión'],
    'Inloggen':['Log in','Anmelden','Se connecter','Iniciar sesión'],
    'Log in om verder te gaan.':['Log in to continue.','Melde dich an, um fortzufahren.','Connectez-vous pour continuer.','Inicia sesión para continuar.'],
    'E-mailadres':['Email address','E-Mail-Adresse','Adresse e-mail','Correo electrónico'],
    'Wachtwoord':['Password','Passwort','Mot de passe','Contraseña'],
    'Wachtwoord vergeten?':['Forgot password?','Passwort vergessen?','Mot de passe oublié ?','¿Olvidaste la contraseña?'],
    'Wachtwoord vergeten':['Forgot password','Passwort vergessen','Mot de passe oublié','Contraseña olvidada'],
    'Vul je e-mailadres in; we sturen je een nieuw wachtwoord.':['Enter your email; we’ll send you a new password.','Gib deine E-Mail ein; wir senden dir ein neues Passwort.','Saisissez votre e-mail ; nous vous enverrons un nouveau mot de passe.','Introduce tu correo; te enviaremos una nueva contraseña.'],
    'Nieuw wachtwoord sturen':['Send new password','Neues Passwort senden','Envoyer un nouveau mot de passe','Enviar nueva contraseña'],
    '← Terug naar inloggen':['← Back to login','← Zurück zur Anmeldung','← Retour à la connexion','← Volver al inicio de sesión'],
    'De studio stelt de beheerder- en docent-logins in. Klant? Maak hieronder een account aan.':['The studio sets up admin and teacher logins. A customer? Create an account below.','Das Studio richtet die Admin- und Lehrer-Logins ein. Kunde? Erstelle unten ein Konto.','Le studio configure les accès admin et enseignant. Client ? Créez un compte ci-dessous.','El estudio configura los accesos de administrador y profesor. ¿Cliente? Crea una cuenta abajo.'],
    'Nog geen account?':['No account yet?','Noch kein Konto?','Pas encore de compte ?','¿Aún no tienes cuenta?'],
    'Registreren':['Sign up','Registrieren','S’inscrire','Registrarse'],
    '← Terug':['← Back','← Zurück','← Retour','← Volver'],
    'Account aanmaken':['Create account','Konto erstellen','Créer un compte','Crear cuenta'],
    'Maak een account om lessen te boeken.':['Create an account to book classes.','Erstelle ein Konto, um Kurse zu buchen.','Créez un compte pour réserver des cours.','Crea una cuenta para reservar clases.'],
    'Naam':['Name','Name','Nom','Nombre'],
    'Telefoonnummer':['Phone number','Telefonnummer','Numéro de téléphone','Número de teléfono'],
    'Al een account?':['Already have an account?','Schon ein Konto?','Déjà un compte ?','¿Ya tienes cuenta?'],
    'Je gegevens zijn gevonden. Maak een wachtwoord aan om je strippenkaart/abonnement te activeren.':['We found your details. Create a password to activate your class pass/membership.','Wir haben deine Daten gefunden. Erstelle ein Passwort, um deine Karte/Mitgliedschaft zu aktivieren.','Vos données ont été trouvées. Créez un mot de passe pour activer votre carte/abonnement.','Encontramos tus datos. Crea una contraseña para activar tu bono/membresía.'],
    'Welcome to our booking system':['Welcome to our booking system','Willkommen in unserem Buchungssystem','Bienvenue dans notre système de réservation','Bienvenido a nuestro sistema de reservas'],
    'Get started':['Get started','Loslegen','Commencer','Empezar'],
    // booking flow
    'geen tegoed':['no credit','kein Guthaben','aucun crédit','sin crédito'],
    'geboekt':['booked','gebucht','réservé','reservado'],
    'wachtlijst':['waitlist','Warteliste','liste d’attente','lista de espera'],
    'Wachtlijst':['Waitlist','Warteliste','Liste d’attente','Lista de espera'],
    'Annuleren gesloten':['Cancellation closed','Stornierung geschlossen','Annulation fermée','Cancelación cerrada'],
    'Annuleren':['Cancel','Stornieren','Annuler','Cancelar'],
    'Van wachtlijst af':['Leave waitlist','Warteliste verlassen','Quitter la liste d’attente','Salir de la lista de espera'],
    'Verlopen':['Expired','Abgelaufen','Expiré','Caducado'],
    'Boeken':['Book','Buchen','Réserver','Reservar'],
    'Kopen':['Buy','Kaufen','Acheter','Comprar'],
    'vandaag':['today','heute','aujourd’hui','hoy'],
    'Geen lessen':['No classes','Keine Kurse','Aucun cours','Sin clases'],
    '← Vorige week':['← Previous week','← Vorige Woche','← Semaine précédente','← Semana anterior'],
    'Volgende week →':['Next week →','Nächste Woche →','Semaine suivante →','Semana siguiente →'],
    '💻 Online':['💻 Online','💻 Online','💻 En ligne','💻 En línea'],
    '🔀 Hybride':['🔀 Hybrid','🔀 Hybrid','🔀 Hybride','🔀 Híbrido'],
    '📍 Fysiek':['📍 In person','📍 Vor Ort','📍 Sur place','📍 Presencial'],
    'Fysiek':['In person','Vor Ort','Sur place','Presencial'],
    'Online':['Online','Online','En ligne','En línea'],
    'Hybride':['Hybrid','Hybrid','Hybride','Híbrido'],
    'Online les openen ↗':['Open online class ↗','Online-Kurs öffnen ↗','Ouvrir le cours en ligne ↗','Abrir clase en línea ↗'],
    'Online deelnemen ↗':['Join online ↗','Online teilnehmen ↗','Participer en ligne ↗','Unirse en línea ↗'],
    'Video openen ↗':['Open video ↗','Video öffnen ↗','Ouvrir la vidéo ↗','Abrir vídeo ↗'],
    '(geweest)':['(past)','(vorbei)','(passé)','(pasado)'],
    // client dashboard / memberships
    'Mijn geboekte lessen':['My booked classes','Meine gebuchten Kurse','Mes cours réservés','Mis clases reservadas'],
    'Er zijn op dit moment geen lidmaatschappen te koop.':['There are currently no memberships for sale.','Derzeit sind keine Mitgliedschaften erhältlich.','Aucun abonnement n’est en vente pour le moment.','Por ahora no hay membresías a la venta.'],
    'Onbeperkte lessen':['Unlimited classes','Unbegrenzte Kurse','Cours illimités','Clases ilimitadas'],
    'Aantal lessen per maand':['Number of classes per month','Anzahl Kurse pro Monat','Nombre de cours par mois','Número de clases al mes'],
    'Aantal lessen':['Number of classes','Anzahl Kurse','Nombre de cours','Número de clases'],
    'Strippenkaart':['Class pass','Mehrfachkarte','Carte','Bono'],
    'Abonnement (maand)':['Membership (monthly)','Abo (monatlich)','Abonnement (mensuel)','Membresía (mensual)'],
    'Toevoegen':['Add','Hinzufügen','Ajouter','Añadir'],
    'Verwijderen':['Delete','Löschen','Supprimer','Eliminar'],
    'Opslaan':['Save','Speichern','Enregistrer','Guardar'],
    'Opzeggen':['Cancel subscription','Kündigen','Résilier','Cancelar suscripción'],
    'Maandelijks abonnement':['Monthly subscription','Monatsabo','Abonnement mensuel','Suscripción mensual'],
    'Je hebt geen lopende abonnementen.':['You have no active subscriptions.','Du hast keine laufenden Abos.','Vous n’avez aucun abonnement en cours.','No tienes suscripciones activas.'],
    // videos
    'Nog geen videos in deze categorie.':['No videos in this category yet.','Noch keine Videos in dieser Kategorie.','Aucune vidéo dans cette catégorie.','Aún no hay vídeos en esta categoría.'],
    'Aanmaken':['Create','Erstellen','Créer','Crear'],
    'Code':['Code','Code','Code','Código'],
    'Waarde':['Value','Wert','Valeur','Valor'],
    'Kortingscode of cadeaubon':['Discount code or gift card','Rabattcode oder Gutschein','Code promo ou carte cadeau','Código de descuento o tarjeta regalo'],
    'Verloopt op (optioneel)':['Expires on (optional)','Läuft ab am (optional)','Expire le (facultatif)','Caduca el (opcional)'],
    'Nog geen codes.':['No codes yet.','Noch keine Codes.','Aucun code pour l’instant.','Aún no hay códigos.'],
    // admin common
    'Titel':['Title','Titel','Titre','Título'],
    'Datum':['Date','Datum','Date','Fecha'],
    'Tijd':['Time','Zeit','Heure','Hora'],
    'Type':['Type','Typ','Type','Tipo'],
    'Land':['Country','Land','Pays','País'],
    'Adres':['Address','Adresse','Adresse','Dirección'],
    'Plaats':['City','Stadt','Ville','Ciudad'],
    'Postcode':['Postcode','PLZ','Code postal','Código postal'],
    'Bedrijfsnaam':['Company name','Firmenname','Nom de l’entreprise','Nombre de la empresa'],
    'Nieuwe les inplannen':['Schedule a new class','Neuen Kurs planen','Planifier un nouveau cours','Programar una nueva clase'],
    'Les toevoegen':['Add class','Kurs hinzufügen','Ajouter le cours','Añadir clase'],
    'Type les':['Class type','Kursart','Type de cours','Tipo de clase'],
    'Docent':['Teacher','Lehrer','Enseignant','Profesor'],
    'Docent toevoegen':['Add teacher','Lehrer hinzufügen','Ajouter un enseignant','Añadir profesor'],
    'Nieuw lidmaatschap':['New membership','Neue Mitgliedschaft','Nouvel abonnement','Nueva membresía'],
    'Facturen':['Invoices','Rechnungen','Factures','Facturas'],
    'Laden…':['Loading…','Lädt…','Chargement…','Cargando…'],
    'Nog geen facturen.':['No invoices yet.','Noch keine Rechnungen.','Aucune facture pour l’instant.','Aún no hay facturas.'],
    'Nog geen boekingen.':['No bookings yet.','Noch keine Buchungen.','Aucune réservation pour l’instant.','Aún no hay reservas.'],
    'Nog geen aankopen.':['No purchases yet.','Noch keine Käufe.','Aucun achat pour l’instant.','Aún no hay compras.'],
    'Omzet per type':['Revenue by type','Umsatz nach Typ','Chiffre d’affaires par type','Ingresos por tipo'],
    'Nog geen omzet.':['No revenue yet.','Noch kein Umsatz.','Aucun chiffre d’affaires.','Aún no hay ingresos.'],
    'Drukste lessen (op boekingen)':['Busiest classes (by bookings)','Beliebteste Kurse (nach Buchungen)','Cours les plus fréquentés (par réservations)','Clases más concurridas (por reservas)'],
    'no-show':['no-show','No-Show','absence','ausencia'],
    'Annuleer':['Cancel','Stornieren','Annuler','Cancelar'],
    'Terugbetalen':['Refund','Erstatten','Rembourser','Reembolsar'],
    // alerts / confirms
    'Betalen werkt in de gepubliceerde app.':['Payments work in the published app.','Zahlungen funktionieren in der veröffentlichten App.','Les paiements fonctionnent dans l’app publiée.','Los pagos funcionan en la app publicada.'],
    'Code kon niet worden gecontroleerd.':['The code could not be checked.','Der Code konnte nicht geprüft werden.','Le code n’a pas pu être vérifié.','No se pudo comprobar el código.'],
    'Geef een code op.':['Enter a code.','Gib einen Code ein.','Saisissez un code.','Introduce un código.'],
    'Deze code verwijderen?':['Delete this code?','Diesen Code löschen?','Supprimer ce code ?','¿Eliminar este código?'],
    'Voor deze categorie is nog geen abonnementsprijs ingesteld.':['No subscription price has been set for this category yet.','Für diese Kategorie wurde noch kein Abopreis festgelegt.','Aucun tarif d’abonnement n’a été défini pour cette catégorie.','Aún no se ha fijado un precio de suscripción para esta categoría.'],
    'Je video-abonnement opzeggen? Je houdt toegang tot het einde van de betaalde periode.':['Cancel your video subscription? You keep access until the end of the paid period.','Video-Abo kündigen? Du behältst den Zugang bis zum Ende des bezahlten Zeitraums.','Résilier votre abonnement vidéo ? Vous gardez l’accès jusqu’à la fin de la période payée.','¿Cancelar tu suscripción de vídeo? Mantienes el acceso hasta el final del período pagado.'],
    'Opgezegd. Je houdt toegang tot het einde van de periode.':['Cancelled. You keep access until the end of the period.','Gekündigt. Du behältst den Zugang bis zum Ende des Zeitraums.','Résilié. Vous gardez l’accès jusqu’à la fin de la période.','Cancelado. Mantienes el acceso hasta el final del período.'],
    'Je lessen-abonnement opzeggen? Je houdt toegang tot het einde van de betaalde periode.':['Cancel your class membership? You keep access until the end of the paid period.','Kurs-Abo kündigen? Du behältst den Zugang bis zum Ende des bezahlten Zeitraums.','Résilier votre abonnement de cours ? Vous gardez l’accès jusqu’à la fin de la période payée.','¿Cancelar tu membresía de clases? Mantienes el acceso hasta el final del período pagado.'],
    'Betaling gelukt! Je boeking/aankoop is bevestigd.':['Payment successful! Your booking/purchase is confirmed.','Zahlung erfolgreich! Deine Buchung/dein Kauf ist bestätigt.','Paiement réussi ! Votre réservation/achat est confirmé.','¡Pago realizado! Tu reserva/compra está confirmada.'],
    'Betaling kon niet bevestigd worden — er is niets toegekend.':['Payment could not be confirmed — nothing was granted.','Zahlung konnte nicht bestätigt werden — es wurde nichts gewährt.','Le paiement n’a pas pu être confirmé — rien n’a été accordé.','No se pudo confirmar el pago — no se concedió nada.'],
    'Geef de les een titel.':['Give the class a title.','Gib dem Kurs einen Titel.','Donnez un titre au cours.','Ponle un título a la clase.'],
    'Kies een datum.':['Pick a date.','Wähle ein Datum.','Choisissez une date.','Elige una fecha.'],
    'Geef een naam op.':['Enter a name.','Gib einen Namen ein.','Saisissez un nom.','Introduce un nombre.'],
    'Heb je een kortingscode of cadeaubon? Laat leeg als je er geen hebt.':['Do you have a discount code or gift card? Leave empty if not.','Hast du einen Rabattcode oder Gutschein? Leer lassen, falls nicht.','Avez-vous un code promo ou une carte cadeau ? Laissez vide sinon.','¿Tienes un código de descuento o tarjeta regalo? Déjalo vacío si no.'],
    'Code ongeldig.':['Invalid code.','Code ungültig.','Code invalide.','Código no válido.'],
    // locations
    'Locaties':['Locations','Standorte','Lieux','Ubicaciones'],
    'Locatie':['Location','Standort','Lieu','Ubicación'],
    'Alle locaties':['All locations','Alle Standorte','Tous les lieux','Todas las ubicaciones'],
    'Locatie toevoegen':['Add location','Standort hinzufügen','Ajouter un lieu','Añadir ubicación'],
    'Adres (optioneel)':['Address (optional)','Adresse (optional)','Adresse (facultatif)','Dirección (opcional)'],
    '— Geen specifieke locatie —':['— No specific location —','— Kein bestimmter Standort —','— Aucun lieu spécifique —','— Sin ubicación específica —'],
    'Nog geen locaties — de app werkt dan als één locatie.':['No locations yet — the app then works as a single location.','Noch keine Standorte — die App funktioniert dann als ein Standort.','Aucun lieu pour l’instant — l’app fonctionne alors comme un seul lieu.','Aún no hay ubicaciones — la app funciona como una sola ubicación.'],
    // invoices & revenue export
    'Facturen & omzet':['Invoices & revenue','Rechnungen & Umsatz','Factures & chiffre d’affaires','Facturas e ingresos'],
    'Periode':['Period','Zeitraum','Période','Período'],
    'Omzet in deze periode':['Revenue in this period','Umsatz in diesem Zeitraum','Chiffre d’affaires sur cette période','Ingresos en este período'],
    'Geen facturen in deze periode.':['No invoices in this period.','Keine Rechnungen in diesem Zeitraum.','Aucune facture sur cette période.','No hay facturas en este período.'],
    'Docenten-uitbetaling':['Teacher payout','Lehrer-Auszahlung','Paiement des enseignants','Pago a profesores'],
    'Tarief per les (€)':['Rate per class (€)','Satz pro Kurs (€)','Tarif par cours (€)','Tarifa por clase (€)'],
    'Automatisch rapport':['Automatic report','Automatischer Bericht','Rapport automatique','Informe automático'],
    'Frequentie':['Frequency','Häufigkeit','Fréquence','Frecuencia'],
    'Uit':['Off','Aus','Désactivé','Apagado'],
    'Wekelijks':['Weekly','Wöchentlich','Hebdomadaire','Semanal'],
    'Maandelijks':['Monthly','Monatlich','Mensuel','Mensual'],
    'Google-review-link':['Google review link','Google-Bewertungslink','Lien d’avis Google','Enlace de reseña de Google'],
    'Abonnementen — betaalstatus':['Subscriptions — payment status','Abos — Zahlungsstatus','Abonnements — statut de paiement','Suscripciones — estado de pago'],
    'Nog geen lopende abonnementen.':['No active subscriptions yet.','Noch keine laufenden Abos.','Aucun abonnement en cours.','Aún no hay suscripciones activas.'],
    'Betaling mislukt':['Payment failed','Zahlung fehlgeschlagen','Paiement échoué','Pago fallido'],
    'Actief':['Active','Aktiv','Actif','Activo']
  };
  // NB: regexes live inside a template literal, so EVERY backslash must be doubled (\\d, \\/, \\. …).
  var SUB=[
    [/Ingelogd als /g,['Logged in as ','Angemeldet als ','Connecté en tant que ','Conectado como ']],
    [/geldig t\\/m /g,['valid until ','gültig bis ','valable jusqu’au ','válido hasta ']],
    [/geldig (\\d+) dagen/g,['valid $1 days','gültig $1 Tage','valable $1 jours','válido $1 días']],
    [/(\\d+) lessen per maand/g,['$1 classes per month','$1 Kurse pro Monat','$1 cours par mois','$1 clases al mes']],
    [/onbeperkt lessen/g,['unlimited classes','unbegrenzte Kurse','cours illimités','clases ilimitadas']],
    [/(\\d+) lessen/g,['$1 classes','$1 Kurse','$1 cours','$1 clases']],
    [/automatisch verlengd/g,['auto-renewed','automatisch verlängert','renouvelé automatiquement','renovado automáticamente']],
    [/ per maand/g,[' per month',' pro Monat',' par mois',' al mes']],
    [/\\/maand/g,['/month','/Monat','/mois','/mes']],
    [/elke /g,['every ','jeden ','chaque ','cada ']],
    [/\\bWeek (\\d+)/g,['Week $1','Woche $1','Semaine $1','Semana $1']],
    [/Beschikbaar vanaf /g,['Available from ','Verfügbar ab ','Disponible à partir du ','Disponible desde ']],
    [/Boeken kan pas vanaf /g,['Booking opens from ','Buchung ab ','Réservation à partir du ','Reservas desde ']],
    [/(\\d+) boekingen/g,['$1 bookings','$1 Buchungen','$1 réservations','$1 reservas']],
    [/betalende abonnees/g,['paying subscribers','zahlende Abonnenten','abonnés payants','suscriptores que pagan']],
    [/Actief · betaald t\\/m /g,['Active · paid until ','Aktiv · bezahlt bis ','Actif · payé jusqu’au ','Activo · pagado hasta ']],
    [/Verlopen /g,['Expired ','Abgelaufen ','Expiré ','Caducado ']],
    [/(\\d+)\\/(\\d+) gebruikt/g,['$1/$2 used','$1/$2 verwendet','$1/$2 utilisé','$1/$2 usado']],
    [/(\\d+)x gebruikt/g,['$1× used','$1× verwendet','$1× utilisé','$1× usado']],
    [/Korting toegepast: -/g,['Discount applied: -','Rabatt angewendet: -','Remise appliquée : -','Descuento aplicado: -']],
    [/\\. Je betaalt nu /g,['. You now pay ','. Du zahlst jetzt ','. Vous payez maintenant ','. Ahora pagas ']],
    [/Terugbetaald: /g,['Refunded: ','Erstattet: ','Remboursé : ','Reembolsado: ']],
    [/Je bent geabonneerd \\(loopt maandelijks door\\)\\./g,['You are subscribed (renews monthly).','Du bist abonniert (verlängert sich monatlich).','Vous êtes abonné (renouvellement mensuel).','Estás suscrito (se renueva cada mes).']],
    [/Abonneer je/g,['Subscribe','Abonnieren','S’abonner','Suscríbete']],
    [/ingelogd/g,['logged in','angemeldet','connecté','conectado']],
    [/Download Excel/g,['Download Excel','Excel herunterladen','Télécharger Excel','Descargar Excel']],
    [/BTW-overzicht/g,['VAT report','USt-Übersicht','Récapitulatif TVA','Resumen de IVA']],
    [/(\\d+) facturen/g,['$1 invoices','$1 Rechnungen','$1 factures','$1 facturas']],
    [/(\\d+) maanden/g,['$1 months','$1 Monate','$1 mois','$1 meses']],
    [/(\\d+) maand\\b/g,['$1 month','$1 Monat','$1 mois','$1 mes']],
    [/\\(kwartaal\\)/g,['(quarter)','(Quartal)','(trimestre)','(trimestre)']],
    [/\\(jaar\\)/g,['(year)','(Jahr)','(an)','(año)']]
  ];
  function trText(s){
    if(lang==='nl'||s==null)return s;
    var i=LIDX();if(i==null)return s;
    var t=String(s).replace(/\\s+/g,' ').trim();if(!t)return s;
    var e=TR[t];if(e&&e[i]!=null)return String(s).replace(t,e[i]);
    var out=String(s),hit=false;
    for(var k=0;k<SUB.length;k++){var r=SUB[k];if(r[1][i]==null)continue;var before=out;out=out.replace(r[0],r[1][i]);if(out!==before)hit=true;}
    return hit?out:s;
  }
  function tr(s){var i=LIDX();if(i==null||lang==='nl')return s;var e=TR[s];return (e&&e[i]!=null)?e[i]:s;}
  function translateDOM(el){
    if(lang==='nl'||!el||typeof document==='undefined')return;
    try{
      var w=document.createTreeWalker(el,NodeFilter.SHOW_TEXT,null,false),ns=[],n;
      while((n=w.nextNode()))ns.push(n);
      ns.forEach(function(nd){var v=nd.nodeValue;if(!v||!/[A-Za-zÀ-ÿ]/.test(v))return;var nv=trText(v);if(nv!==v)nd.nodeValue=nv;});
      var q2=el.querySelectorAll('[placeholder],[title]');
      for(var j=0;j<q2.length;j++){var x=q2[j];
        if(x.getAttribute('placeholder')){var p=trText(x.getAttribute('placeholder'));if(p!==x.getAttribute('placeholder'))x.setAttribute('placeholder',p);}
        var ti=x.getAttribute('title');if(ti){var t2=trText(ti);if(t2!==ti)x.setAttribute('title',t2);}
      }
    }catch(e){}
  }
  function langSelect(){var o='';for(var k in LANGS){o+='<option value="'+k+'"'+(k===lang?' selected':'')+'>'+LANGS[k]+'</option>';}
    return '<select class="ba-lang" data-act="setlang" title="Taal / Language" style="width:auto;padding:6px 10px;font-size:13px;border:1px solid var(--ba-line);border-radius:9px;background:rgba(255,255,255,.06);color:var(--ba-ink)">'+o+'</select>';}
  var _i18nObs=null,_i18nBusy=false;
  function initI18n(){if(_i18nObs||typeof MutationObserver==='undefined'||!root)return;
    _i18nObs=new MutationObserver(function(){if(_i18nBusy||lang==='nl')return;_i18nBusy=true;try{translateDOM(root);}catch(e){}_i18nBusy=false;});
    _i18nObs.observe(root,{childList:true,subtree:true});}
  // Translate user-facing alert/confirm/prompt text too (shadows the globals inside this IIFE).
  function alert(m){return window.alert(trText(String(m==null?'':m)));}
  function confirm(m){return window.confirm(trText(String(m==null?'':m)));}
  function prompt(m,d){return window.prompt(trText(String(m==null?'':m)),d);}

  function seed(){
    var accs=bakedAccounts();
    var firstT=accs.filter(function(a){return a.role==='teacher';})[0]||accs[0]||{};
    return {
      accounts:accs, session:null,
      classes:[],   // leeg — de studio voegt zelf lessen toe
      bookings:[],
      members:[],    // leeg — de studio voegt zelf strippenkaarten/abonnementen toe
      wallets:{},
      pay:{tegoed:true,stripe:true},
      sell:{strippenkaart:true,abonnement:true},
      reminders:true,
      purchases:[],  // Stripe-aankopen (strippenkaart/abonnement) zodat de admin kan terugbetalen
      videos:[], videoPlans:[], videoAccess:[], mySubs:[],  // video-bibliotheek + abonnementen
      codes:[],  // kortingscodes / cadeaubonnen
      locations:[],  // fysieke locaties (multi-locatie)
      settings:{ownerReport:'off',reviewUrl:''},  // studio-instellingen (toggles)
      subscribers:[],  // abonnees + betaalstatus (admin)
      integrations:{stripe:false,paypal:false,mailchimp:false,gcal:false,zoom:false,zapier:false,api:false}
    };
  }
  var S; try{S=JSON.parse(localStorage.getItem(KEY))||seed();}catch(e){S=seed();}
  // Backfill fields added in later versions so an older saved state never crashes a panel
  // (e.g. a state from before "integrations" existed would blank the Integraties tab).
  (function(){var d=seed();for(var k in d){if(S[k]===undefined||S[k]===null)S[k]=d[k];}})();
  if(!S.classes||!S.accounts)S=seed();
  // Baked (chat-configured) accounts are authoritative; keep any teachers the admin added in-app.
  (function(){var baked=bakedAccounts();if(baked.length){var extra=(S.accounts||[]).filter(function(a){return !baked.some(function(b){return b.email===a.email;});});S.accounts=baked.concat(extra);
    if(S.session&&!S.accounts.some(function(a){return a.email===S.session.email&&a.password===(S.session.pw||a.password);}))S.session=null;}})();
  function save(){if(SRV)return;try{localStorage.setItem(KEY,JSON.stringify(S));}catch(e){}}

  // ── Stripe payment helpers ────────────────────────────────────────────────
  function setPending(p){try{localStorage.setItem(KEY+'_pending',JSON.stringify(p));}catch(e){}}
  function getPending(){try{return JSON.parse(localStorage.getItem(KEY+'_pending')||'null');}catch(e){return null;}}
  function clearPending(){try{localStorage.removeItem(KEY+'_pending');}catch(e){}}
  // Open a payment dialog with ONE reliable "Betaal met Stripe" link (Stripe can't be iframed,
  // so it opens a new tab). The overlay blocks repeat-clicks. We stash what's being paid for;
  // ONLY after returning (?betaald=1) AND server-verifying the payment are credits/booking granted.
  function payViaStripe(kind,name,amount,pending){
    if(!projId()){alert('Betalen werkt in de gepubliceerde app.');return;}
    if(root.querySelector('#ba-pay-ov'))return; // al een betaalvenster open
    setPending(pending);
    var ov=document.createElement('div');ov.id='ba-pay-ov';
    ov.style.cssText='position:fixed;inset:0;z-index:2147483647;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;padding:20px';
    ov.innerHTML='<div style="background:#fff;border-radius:14px;max-width:380px;width:100%;padding:22px;font:inherit;font-family:inherit;color:#1f2937"><h3 style="margin:0 0 4px;font-size:18px">Betalen</h3><p style="color:#6b7280;font-size:14px;margin:0 0 16px">'+esc(name)+' — €'+amount+'</p><div id="ba-pay-body" style="font-size:14px;color:#6b7280">Betaling voorbereiden…</div><div style="margin-top:18px;text-align:right"><button id="ba-pay-cancel" class="ba-btn ghost sm">Sluiten</button></div></div>';
    root.appendChild(ov);
    ov.querySelector('#ba-pay-cancel').onclick=function(){clearPending();ov.parentNode&&ov.parentNode.removeChild(ov);};
    var base=location.href.replace(/[?&](betaald|geannuleerd)=1/g,'').replace(/[?&]session_id=[^&]*/g,'');
    var sep=base.indexOf('?')>-1?'&':'?';
    fetch(api('stripe/checkout'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:kind,name:name,amount:amount,successUrl:base+sep+'betaald=1&session_id={CHECKOUT_SESSION_ID}',cancelUrl:base+sep+'geannuleerd=1'})})
      .then(function(r){return r.json();}).then(function(d){
        var body=ov.querySelector('#ba-pay-body');if(!body)return;
        if(d.url){body.innerHTML='<a href="'+d.url+'" target="_blank" rel="noopener" style="display:inline-block;background:var(--ba);color:#fff;text-decoration:none;font-weight:700;padding:10px 16px;border-radius:10px">Betaal met Stripe ↗</a><p style="color:#9ca3af;font-size:12px;margin:10px 0 0">Opent in een nieuw tabblad. Daarna kom je terug en wordt je aankoop bevestigd.</p>';}
        else{clearPending();body.textContent=d.error||'Afrekenen mislukt.';}
      }).catch(function(){clearPending();var body=ov.querySelector('#ba-pay-body');if(body)body.textContent='Afrekenen mislukt.';});
  }

  // Ask for an optional discount code / gift card, validate it server-side, then run go()
  // with the (possibly) discounted amount + the code + discount so finalize can redeem it.
  function payWithCode(kind,name,amount,pending){
    var code=prompt('Heb je een kortingscode of cadeaubon? Laat leeg als je er geen hebt.');
    function go(amt,c,disc){payViaStripe(kind,name,amt,Object.assign({},pending,{code:c||'',discount:disc||0}));}
    if(!code||!code.trim()){go(amount,'',0);return;}
    spost('code/validate',{code:code.trim(),amount:amount}).then(function(r){
      if(!r||!r.ok||!r.d){alert((r&&r.d&&r.d.error)||'Code ongeldig.');go(amount,'',0);return;}
      alert('Korting toegepast: -€'+r.d.discount+'. Je betaalt nu €'+r.d.newAmount+'.');
      go(r.d.newAmount,r.d.code,r.d.discount);
    }).catch(function(){alert('Code kon niet worden gecontroleerd.');go(amount,'',0);});
  }

  // ── Aanwezigheid in een APART VENSTER (modal) ──
  // A teacher/admin clicks a lesson and gets a focused pop-up with that lesson's booked students
  // and present / no-show toggles. attKey = "<classId>|<date>". Re-renders on every state change.
  var attKey=null;
  var infoKey=null;  // class-detail popup ("meer info") — key = classId|date
  function attBookings(){if(!attKey)return [];var cid=attKey.split('|')[0],dt=attKey.split('|')[1];
    return S.bookings.filter(function(b){return b.status==='booked'&&String(b.classId)===String(cid)&&b.date===dt;});}
  function renderAttModal(){var ov=root.querySelector('#ba-att-ov');if(!ov||!attKey)return;
    var cid=attKey.split('|')[0],dt=attKey.split('|')[1];
    var c=S.classes.filter(function(x){return String(x.id)===String(cid);})[0]||{};
    var arr=attBookings();var pres=arr.filter(function(b){return b.present;}).length;
    var h='<div style="background:#fff;border-radius:14px;max-width:460px;width:100%;max-height:85vh;overflow:auto;padding:22px;font-family:inherit;color:#1f2937" onclick="event.stopPropagation()">'+
      '<div class="ba-row" style="align-items:flex-start"><div><h3 style="margin:0 0 2px;font-size:18px">'+esc(c.title||'Les')+'</h3>'+
      '<p style="color:#6b7280;font-size:13px;margin:0">'+fmtDate(dt)+' &middot; '+esc(c.time||'')+locLabel(c)+'</p></div>'+
      '<button id="ba-att-x" class="ba-btn ghost sm">Sluiten</button></div>'+
      '<p class="ba-meta" style="margin:12px 0 8px">'+arr.length+' geboekt &middot; '+pres+' aanwezig</p><div class="ba-list">';
    if(!arr.length)h+='<p class="ba-meta">Nog geen boekingen op deze les.</p>';
    arr.forEach(function(b){
      h+='<div class="ba-item"><div class="ba-row"><span><b>'+esc(b.name)+'</b>'+(b.noShow?' <span class="ba-badge warn">no-show</span>':'')+'</span>'+
         '<div class="ba-row" style="gap:6px"><button class="ba-btn '+(b.present?'':'ghost')+' sm" data-act="present" data-b="'+b.id+'">'+(b.present?'✓ aanwezig':'markeer aanwezig')+'</button>'+
         '<button class="ba-btn '+(b.noShow?'warn':'ghost')+' sm" data-act="noshow" data-b="'+b.id+'">'+(b.noShow?'✓ no-show':'no-show')+'</button></div></div></div>';
    });
    h+='</div></div>';
    ov.innerHTML=h;
    var x=ov.querySelector('#ba-att-x');if(x)x.onclick=closeAttModal;
    translateDOM(ov);
  }
  function openAttModal(key){attKey=key;var ov=root.querySelector('#ba-att-ov');
    if(!ov){ov=document.createElement('div');ov.id='ba-att-ov';
      ov.style.cssText='position:fixed;inset:0;z-index:2147483646;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;padding:20px';
      ov.addEventListener('click',function(e){if(e.target===ov)closeAttModal();});
      root.appendChild(ov);}
    renderAttModal();
  }
  function closeAttModal(){attKey=null;var ov=root.querySelector('#ba-att-ov');if(ov&&ov.parentNode)ov.parentNode.removeChild(ov);}
  // Duur in minuten/uur, afgeleid uit begin- en eindtijd.
  function durationLabel(c){if(!c.time||!c.endTime)return '';var a=c.time.split(':'),b=c.endTime.split(':');var mins=(parseInt(b[0],10)*60+parseInt(b[1],10))-(parseInt(a[0],10)*60+parseInt(a[1],10));if(!(mins>0))return '';var h=Math.floor(mins/60),m=mins%60;return (h?h+' uur':'')+(h&&m?' ':'')+(m?m+' min':'');}
  // "Meer info"-popup voor een les: niveau, duur, locatie, docent, prijs, omschrijving.
  function renderInfoModal(){var ov=root.querySelector('#ba-info-ov');if(!ov||!infoKey)return;
    var cid=infoKey.split('|')[0],dt=infoKey.split('|')[1];
    var c=S.classes.filter(function(x){return String(x.id)===String(cid);})[0];
    if(!c){closeInfoModal();return;}
    var dur=durationLabel(c);var modeTxt=c.mode==='online'?'Online':c.mode==='hybride'?'Hybride (fysiek + online)':'Fysiek';
    var rows='';
    function row(label,val){if(!val)return;rows+='<div class="ba-row" style="gap:10px;align-items:baseline;margin:6px 0"><span class="ba-meta" style="min-width:96px;margin:0">'+label+'</span><span style="font-weight:500">'+val+'</span></div>';}
    row('Wanneer',fmtDate(dt)+' · '+tRange(c));
    row('Duur',dur);
    row('Niveau',c.level?esc(c.level):'');
    row('Docent',c.teacher?esc(c.teacher):'');
    row('Locatie',locName(c.locationId)?('📍 '+esc(locName(c.locationId))):'');
    row('Type les',modeTxt);
    row('Prijs',c.price?('€'+c.price):'');
    var desc=c.description?('<div style="margin-top:12px"><div class="ba-meta" style="margin:0 0 4px">Omschrijving</div><div style="white-space:pre-wrap;line-height:1.5">'+esc(c.description)+'</div></div>'):'';
    var onl=(S.session)?onlineLine(c):'';
    var h='<div style="background:#fff;border-radius:14px;max-width:480px;width:100%;max-height:85vh;overflow:auto;padding:22px;font-family:inherit;color:#1f2937" onclick="event.stopPropagation()">'+
      '<div class="ba-row" style="align-items:flex-start"><div><h3 style="margin:0 0 4px;font-size:19px">'+esc(c.title||'Les')+'</h3>'+
      (c.level?('<span class="ba-badge">'+esc(c.level)+'</span>'):'')+'</div>'+
      '<button id="ba-info-x" class="ba-btn ghost sm">Sluiten</button></div>'+
      '<div style="margin-top:14px">'+(rows||'<p class="ba-meta">Geen extra details.</p>')+'</div>'+desc+onl+'</div>';
    ov.innerHTML=h;
    var x=ov.querySelector('#ba-info-x');if(x)x.onclick=closeInfoModal;
    translateDOM(ov);
  }
  function openInfoModal(key){infoKey=key;var ov=root.querySelector('#ba-info-ov');
    if(!ov){ov=document.createElement('div');ov.id='ba-info-ov';
      ov.style.cssText='position:fixed;inset:0;z-index:2147483646;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;padding:20px';
      ov.addEventListener('click',function(e){if(e.target===ov)closeInfoModal();});
      root.appendChild(ov);}
    renderInfoModal();
  }
  function closeInfoModal(){infoKey=null;var ov=root.querySelector('#ba-info-ov');if(ov&&ov.parentNode)ov.parentNode.removeChild(ov);}

  function teacherAccounts(){return S.accounts.filter(function(a){return a.role==='teacher';});}
  function teacherOptions(sel){return teacherAccounts().map(function(a){return '<option value="'+esc(a.email)+'"'+(a.email===sel?' selected':'')+'>'+esc(a.name)+'</option>';}).join('');}
  function accName(email){var a=S.accounts.filter(function(x){return x.email===email;})[0];return a?a.name:'';}
  function accPhone(email){var a=S.accounts.filter(function(x){return x.email===email;})[0];return (a&&a.phone)||'';}
  function isValidEmail(e){return /.+@.+\..+/.test(e);}

  // occurrences for the next 14 days from recurring + one-off classes
  function occurrences(){
    var out=[],today=new Date();today.setHours(0,0,0,0);
    // Concrete dated lessons that are today or in the future.
    S.classes.forEach(function(c){
      if(!c.recurring&&c.date){var dd=new Date(c.date+'T00:00:00');if(dd>=today)out.push({cls:c,date:c.date,dow:dd.getDay()});}
    });
    // Legacy recurring weekly lessons, expanded over the next 4 weeks.
    for(var i=0;i<28;i++){
      var d=new Date(today);d.setDate(today.getDate()+i);var key=ymd(d);
      S.classes.forEach(function(c){if(c.recurring&&c.day===d.getDay())out.push({cls:c,date:key,dow:d.getDay()});});
    }
    out.sort(function(a,b){return (a.date+(a.cls.time||''))<(b.date+(b.cls.time||''))?-1:1;});
    return out;
  }
  function booked(classId,date){if(SRV){var k=classId+'|'+date;return (S.counts&&S.counts[k]&&S.counts[k].booked)||0;}return S.bookings.filter(function(b){return b.classId===classId&&b.date===date&&b.status==='booked';}).length;}
  function myEmail(){return (S.session&&S.session.email)||'';}
  function mine(classId,date){var e=myEmail();var list=SRV?(S.myBookings||[]):S.bookings;return list.filter(function(b){return b.classId===classId&&b.date===date&&b.bookerEmail===e&&(b.status==='booked'||b.status==='waitlist');})[0];}
  if(!S.wallets)S.wallets={};
  if(!S.pay)S.pay={tegoed:true,stripe:true};
  if(!S.sell)S.sell={strippenkaart:true,abonnement:true};
  function walletFor(email){if(!S.wallets[email])S.wallets[email]={credits:0,membership:null,validUntil:null,creditsUntil:null,creditLots:[]};return S.wallets[email];}
  // Strippenkaart-credits zijn verlopen als hun geldigheidsdatum (creditsUntil) gepasseerd is.
  function creditsExpired(W){return !!(W&&W.creditsUntil&&W.creditsUntil<ymd(new Date()));}
  // A membership is "unlimited" when explicitly flagged, or (legacy) an abonnement without a lesson count.
  function isUnlimited(m){return m.unlimited!=null?m.unlimited:(m.type==='abonnement'&&!m.credits);}
  // ── booking-credit rules (strippenkaart credits / unlimited / X-per-maand membership) ──
  // A membership has an expiry date (validUntil, YYYY-MM-DD); past that it no longer counts.
  function membershipExpired(W){return !!(W&&W.validUntil&&W.validUntil<ymd(new Date()));}
  // Monthly memberships ("8 lessen per maand") reset their allotment at the start of each month.
  function ensureMonthlyReset(W){if(!W||!W.monthly)return;var nowM=ymd(new Date()).slice(0,7);
    if(W.monthly.period!==nowM){W.monthly.period=nowM;W.monthly.remaining=W.monthly.limit;}}
  // What can THIS wallet use to book right now? Returns {ok, reason, type}. type: credit|unlimited|monthly.
  function bookingCredit(W){
    if(W.credits>0&&!creditsExpired(W))return {ok:true,type:'credit'};
    if(W.membership){
      if(membershipExpired(W))return {ok:false,reason:'Je abonnement is verlopen. Verleng het of betaal met Stripe.'};
      // No card was imported with a Mindbody membership → a payment method must be linked first.
      // TODO Stripe: when the studio links a Stripe payment method for this customer, clear needsPayment.
      if(W.needsPayment)return {ok:false,reason:'Je abonnement heeft nog geen betaalmethode. Neem contact op met de studio om je betaling te koppelen.'};
      if(W.monthly){ensureMonthlyReset(W);if(W.monthly.remaining>0)return {ok:true,type:'monthly'};
        return {ok:false,reason:'Je maandtegoed is op. Volgende maand heb je weer '+W.monthly.limit+' lessen.'};}
      return {ok:true,type:'unlimited'}; // unlimited (incl. legacy membership = string)
    }
    return {ok:false,reason:'Je hebt geen tegoed: geen strippenkaart-credits en geen lopend abonnement. Koop er een bij "Mijn strippenkaart" of betaal met Stripe.'};
  }
  // Human label for the current tegoed (credits / abonnement name / X per maand).
  function walletLabel(W){
    if(W.credits>0&&creditsExpired(W))return 'strippenkaart verlopen';
    if(W.credits>0)return W.credits+' credits'+(W.creditsUntil?(' · geldig t/m '+fmtDate(W.creditsUntil)):'');
    if(W.membership){if(membershipExpired(W))return 'abonnement verlopen';
      if(W.monthly){ensureMonthlyReset(W);return esc(W.membership)+' ('+W.monthly.remaining+'/'+W.monthly.limit+' deze maand)';}
      return esc(W.membership);}
    return '';
  }
  function walletBadge(W){var l=walletLabel(W);return l?('<span class="ba-badge ok">'+l+'</span>'):'<span class="ba-badge">geen tegoed</span>';}
  // Load Mindbody-imported entitlements into a customer's wallet (keyed by e-mail).
  function applyEntitlements(email,ents){var W=walletFor(email);
    (ents||[]).forEach(function(e){
      if(e.kind==='class_pack'){W.credits+=(e.remaining||0);}
      else if(e.kind==='membership'){W.membership=e.name||'Abonnement';W.needsPayment=!!e.needsPayment;
        if(e.expiresAt){try{W.validUntil=ymd(new Date(e.expiresAt));}catch(x){}}
        if(e.unlimited){W.unlimited=true;W.monthly=null;}
        else if(e.perMonth){W.unlimited=false;W.monthly={limit:e.perMonth,remaining:(e.remaining!=null?e.remaining:e.perMonth),period:ymd(new Date()).slice(0,7)};}
      }
    });save();}
  // Pending activation (from a Mindbody activation link) survives reloads until consumed by register/login.
  function getAct(){try{return JSON.parse(localStorage.getItem(KEY+'_activation')||'null');}catch(e){return null;}}
  function setAct(a){try{localStorage.setItem(KEY+'_activation',JSON.stringify(a));}catch(e){}}
  function clearAct(){try{localStorage.removeItem(KEY+'_activation');}catch(e){}}
  var activationMsg='',activationEmail='';
  function waitN(classId,date){if(SRV){var k=classId+'|'+date;return (S.counts&&S.counts[k]&&S.counts[k].waitlist)||0;}return S.bookings.filter(function(b){return b.classId===classId&&b.date===date&&b.status==='waitlist';}).length;}
  // Classes occurring on a specific day (recurring weekly or one-off), with bookability flag.
  function classesOn(d){
    var key=ymd(d),dow=d.getDay();var out=[];
    S.classes.forEach(function(c){if(c.recurring?(c.day===dow):(c.date===key))out.push({cls:c,date:key,dow:dow,past:isPast(key,c.time)});});
    out.sort(function(a,b){return a.cls.time<b.cls.time?-1:(a.cls.time>b.cls.time?1:0);});
    return out;
  }

  // ---------- panels ----------
  // One class occurrence rendered as an agenda appointment (time + card).
  function apptBlock(o){
    var b=booked(o.cls.id,o.date),free=o.cls.cap-b,full=free<=0,me=mine(o.cls.id,o.date);
    var mineBooked=me&&me.status==='booked';
    var status= mineBooked?'<span class="ba-badge ok">geboekt</span>': me&&me.status==='waitlist'?'<span class="ba-badge">wachtlijst</span>': full?'<span class="ba-badge full">vol'+(waitN(o.cls.id,o.date)?(' · '+waitN(o.cls.id,o.date)+' wachtlijst'):'')+'</span>':'<span class="ba-badge">'+free+' vrij</span>';
    var bookLabel=(S.pay.tegoed?'tegoed':'stripe')==='stripe'?'Kopen':'Boeken';
    var tooEarly=bookTooEarly(o.cls,o.date);
    var btn;
    if(mineBooked)btn=cancelClosed(o.cls,o.date)?'<button class="ba-btn sm" disabled>Annuleren gesloten</button>':'<button class="ba-btn warn sm" data-act="cancel" data-b="'+me.id+'">Annuleren</button>';
    else if(me&&me.status==='waitlist')btn='<button class="ba-btn ghost sm" data-act="cancel" data-b="'+me.id+'">Van wachtlijst af</button>';
    else if(o.past)btn='<button class="ba-btn sm" disabled>Verlopen</button>';
    else if(tooEarly)btn='<button class="ba-btn sm" disabled>Boekbaar vanaf '+fmtDate(bookOpensOn(o.cls,o.date))+'</button>';
    else if(full)btn='<button class="ba-btn ghost sm" data-act="wait" data-c="'+o.cls.id+'" data-d="'+o.date+'">Wachtlijst</button>';
    else btn='<button class="ba-btn sm" data-act="book" data-c="'+o.cls.id+'" data-d="'+o.date+'">'+bookLabel+'</button>';
    var payOpts='';
    if(S.pay.tegoed)payOpts+='<option value="tegoed">Strippenkaart / abonnement</option>';
    if(S.pay.stripe)payOpts+='<option value="stripe">Stripe</option>';
    var paySel=(!mineBooked&&!(me&&me.status==='waitlist')&&!o.past&&!tooEarly&&!full&&S.pay.tegoed&&S.pay.stripe)?('<select class="ba-pay" data-c="'+o.cls.id+'" data-d="'+o.date+'" style="width:auto">'+payOpts+'</select>'):'';
    var cls='ba-appt-card'+(mineBooked?' is-mine':(full?' is-full':''));
    var lvl=o.cls.level?(' <span class="ba-badge">'+esc(o.cls.level)+'</span>'):'';
    var dur=durationLabel(o.cls);
    // Titel + ⓘ openen het detail-popup (niveau, duur, locatie, omschrijving…).
    return '<div class="ba-appt"><div class="ba-appt-time">'+tRange(o.cls)+'</div>'+
      '<div class="'+cls+'"><div class="ba-appt-main"><b class="ba-clinfo" data-act="classinfo" data-c="'+o.cls.id+'" data-d="'+o.date+'" style="cursor:pointer">'+esc(o.cls.title)+'</b>'+lvl+' '+status+
      ' <a href="#" class="ba-clinfo" data-act="classinfo" data-c="'+o.cls.id+'" data-d="'+o.date+'" style="color:var(--ba);font-weight:600;font-size:12px;text-decoration:none;white-space:nowrap">ⓘ info</a>'+
      '<div class="ba-meta" style="margin:2px 0 0">'+esc(o.cls.teacher||'')+(dur?(' · '+dur):'')+(o.cls.price?(' · €'+o.cls.price):'')+locLabel(o.cls)+'</div>'+onlineLine(o.cls)+'</div>'+
      '<div class="ba-row" style="gap:6px;justify-content:flex-end">'+paySel+btn+'</div></div></div>';
  }
  // Booking view = a WEEK agenda: all 7 days (empty days too), navigate week by week.
  function pBoeken(){
    var pub=!S.session;                                   // publieke (uitgelogde) agenda → geen tegoed-balk
    var W=pub?null:walletFor(myEmail());
    var wallet=pub?'':walletBadge(W);
    var today=new Date();today.setHours(0,0,0,0);
    var monOff=(today.getDay()+6)%7;                       // dagen sinds maandag
    var start=new Date(today);start.setDate(today.getDate()-monOff+agendaWeek*7);
    var end=new Date(start);end.setDate(start.getDate()+6);
    var range=start.getDate()+' '+MON[start.getMonth()]+' – '+end.getDate()+' '+MON[end.getMonth()]+' '+end.getFullYear();
    var locs=S.locations||[];
    var locFilter=locs.length?('<select data-act="setbookloc" style="width:auto"><option value="all"'+(bookLoc==='all'?' selected':'')+'>Alle locaties</option>'+(S.locations||[]).map(function(l){return '<option value="'+l.id+'"'+(String(l.id)===String(bookLoc)?' selected':'')+'>'+esc(l.name)+'</option>';}).join('')+'</select>'):'';
    var h=pub?('<div class="ba-row" style="margin-bottom:12px">'+locFilter+'</div>'):('<div class="ba-row" style="margin-bottom:12px"><div class="ba-meta" style="margin:0">Jouw tegoed: '+wallet+'</div>'+locFilter+'</div>');
    h+='<div class="ba-weeknav"><button class="ba-btn ghost sm" data-act="weekprev"'+(agendaWeek<=0?' disabled':'')+'>← Vorige week</button><b>'+range+'</b><button class="ba-btn ghost sm" data-act="weeknext">Volgende week →</button></div>';
    h+='<div class="ba-agenda">';
    for(var i=0;i<7;i++){
      var d=new Date(start);d.setDate(start.getDate()+i);
      var occ=classesOn(d).filter(function(o){return bookLoc==='all'||String(o.cls.locationId||0)===String(bookLoc);});
      var isToday=ymd(d)===ymd(new Date());
      h+='<div class="ba-day"><div class="ba-day-h">'+DOWF[d.getDay()]+' '+d.getDate()+' '+MON[d.getMonth()]+' '+d.getFullYear()+(isToday?' <span class="ba-badge ok">vandaag</span>':'')+'</div>';
      if(!occ.length)h+='<div class="ba-empty"><div class="ba-empty-card">Geen lessen</div></div>';
      else occ.forEach(function(o){h+=apptBlock(o);});
      h+='</div>';
    }
    return h+'</div>';
  }
  // Teacher agenda block: read-only schedule view (no booking buttons), shows bookings/capacity.
  // Mode badge + an "open online les" link (for online/hybride classes). Used in teacher agenda + admin lists.
  function modeBadge(c){return c.mode==='online'?'<span class="ba-badge">💻 Online</span>':c.mode==='hybride'?'<span class="ba-badge">🔀 Hybride</span>':'';}
  function onlineLine(c){return ((c.mode==='online'||c.mode==='hybride')&&c.onlineLink)?'<div class="ba-meta" style="margin:4px 0 0">💻 <a href="'+esc(c.onlineLink)+'" target="_blank" rel="noopener" style="color:var(--ba);font-weight:600">Online les openen ↗</a>'+(c.onlineInfo?(' · '+esc(c.onlineInfo)):'')+'</div>':'';}
  function teacherApptBlock(o){
    var b=booked(o.cls.id,o.date),wl=waitN(o.cls.id,o.date);
    var status='<span class="ba-badge'+(b>=o.cls.cap?' full':' ok')+'">'+b+'/'+o.cls.cap+' geboekt'+(wl?(' · '+wl+' wachtlijst'):'')+'</span>';
    return '<div class="ba-appt"><div class="ba-appt-time">'+tRange(o.cls)+'</div>'+
      '<div class="ba-appt-card"><div class="ba-appt-main"><b>'+esc(o.cls.title)+'</b> '+modeBadge(o.cls)+' '+status+(o.past?' <span class="ba-meta">(geweest)</span>':'')+(locName(o.cls.locationId)?(' <span class="ba-meta">📍 '+esc(locName(o.cls.locationId))+'</span>'):'')+onlineLine(o.cls)+'</div></div></div>';
  }
  // Teacher's own week agenda — identical look to the booking agenda, but only THEIR lessons
  // (the ones the admin assigned to them via teacherEmail).
  function pMijnAgenda(){
    var email=(S.session&&S.session.email)||'';
    var today=new Date();today.setHours(0,0,0,0);
    var monOff=(today.getDay()+6)%7;
    var start=new Date(today);start.setDate(today.getDate()-monOff+agendaWeek*7);
    var end=new Date(start);end.setDate(start.getDate()+6);
    var range=start.getDate()+' '+MON[start.getMonth()]+' – '+end.getDate()+' '+MON[end.getMonth()]+' '+end.getFullYear();
    var h='<div class="ba-row" style="margin-bottom:12px"><div class="ba-meta" style="margin:0">Jouw lesrooster — alleen lessen die aan jou zijn toegewezen.</div></div>';
    h+='<div class="ba-weeknav"><button class="ba-btn ghost sm" data-act="weekprev"'+(agendaWeek<=0?' disabled':'')+'>← Vorige week</button><b>'+range+'</b><button class="ba-btn ghost sm" data-act="weeknext">Volgende week →</button></div>';
    h+='<div class="ba-agenda">';
    for(var i=0;i<7;i++){
      var d=new Date(start);d.setDate(start.getDate()+i);
      var occ=classesOn(d).filter(function(o){return o.cls.teacherEmail===email;});
      var isToday=ymd(d)===ymd(new Date());
      h+='<div class="ba-day"><div class="ba-day-h">'+DOWF[d.getDay()]+' '+d.getDate()+' '+MON[d.getMonth()]+' '+d.getFullYear()+(isToday?' <span class="ba-badge ok">vandaag</span>':'')+'</div>';
      if(!occ.length)h+='<div class="ba-empty"><div class="ba-empty-card">Geen lessen</div></div>';
      else occ.forEach(function(o){h+=teacherApptBlock(o);});
      h+='</div>';
    }
    return h+'</div>';
  }

  function occOptions(sel){return occurrences().map(function(o){var v=o.cls.id+'|'+o.date;return '<option value="'+v+'"'+(v===sel?' selected':'')+'>'+esc(o.cls.title)+' — '+fmtDate(o.date)+' '+esc(o.cls.time)+'</option>';}).join('');}

  // Multi-location helpers. With no locations defined, the app stays single-location (these return empty).
  function locName(id){var l=(S.locations||[]).filter(function(x){return String(x.id)===String(id);})[0];return l?l.name:'';}
  function locationOptions(sel){return (S.locations||[]).map(function(l){return '<option value="'+l.id+'"'+(String(l.id)===String(sel)?' selected':'')+'>'+esc(l.name)+'</option>';}).join('');}
  function locLabel(c){var n=locName(c.locationId);return n?(' · 📍 '+esc(n)):'';}

  // Reusable "create class" card. ownerEmail set => teacher mode (fixed owner); else admin (picks teacher).
  function createClassCard(ownerEmail){
    var teacherField = ownerEmail
      ? '<input type="hidden" id="ba-cte" value="'+esc(ownerEmail)+'"><label class="ba-f">Docent</label><input value="'+esc(accName(ownerEmail))+'" disabled>'
      : '<label class="ba-f">Docent</label><select id="ba-cte">'+teacherOptions('')+'</select>';
    return '<div class="ba-card"><h4>Nieuwe les inplannen</h4>'+
      '<label class="ba-f">Titel</label><input id="ba-ct" placeholder="bijv. Vinyasa Flow">'+
      teacherField+
      '<label class="ba-f">Datum</label><input id="ba-cdate" type="date" value="'+ymd(new Date())+'" min="'+ymd(new Date())+'">'+
      '<div class="ba-2"><div><label class="ba-f">Begintijd</label><input id="ba-ctm" type="time" value="09:00"></div>'+
      '<div><label class="ba-f">Eindtijd</label><input id="ba-cend" type="time" value="10:00"></div></div>'+
      '<div class="ba-2"><div><label class="ba-f">Max. plekken</label><input id="ba-cc" type="number" value="12"></div>'+
      '<div><label class="ba-f">Prijs per les (€, voor Stripe)</label><input id="ba-cp" type="number" step="0.01" value="15"></div></div>'+
      '<div class="ba-2"><div><label class="ba-f">Boeken kan tot … dagen vooraf</label><input id="ba-cbook" type="number" min="0" value="14"><span class="ba-note" style="margin:0">0 = geen limiet</span></div>'+
      '<div><label class="ba-f">Annuleren kan tot … uur voor de les</label><input id="ba-ccancel" type="number" min="0" value="12"><span class="ba-note" style="margin:0">0 = altijd mogelijk</span></div></div>'+
      '<label class="ba-f">Herhaal wekelijks — aantal weken (1 = eenmalig)</label><input id="ba-cweeks" type="number" min="1" value="1"><span class="ba-note" style="margin:0">Maakt dezelfde les elke week op deze dag/tijd.</span>'+
      ((S.locations&&S.locations.length)?('<label class="ba-f">Locatie</label><select id="ba-cloc"><option value="0">— Geen specifieke locatie —</option>'+locationOptions('')+'</select>'):'')+
      '<label class="ba-f">Niveau</label><select id="ba-clevel"><option value="">— Geen / alle niveaus —</option><option value="Beginner">Beginner</option><option value="Gevorderd">Gevorderd</option><option value="Alle niveaus">Alle niveaus</option></select>'+
      '<label class="ba-f">Omschrijving (zien klanten bij "meer info")</label><textarea id="ba-cdesc" rows="3" placeholder="Waar gaat de les over, wat moet je meenemen, voor wie is het geschikt…" style="width:100%;box-sizing:border-box;resize:vertical;font:inherit;padding:10px 12px;border:1px solid #d1d5db;border-radius:11px"></textarea>'+
      '<label class="ba-f">Type les</label>'+
      '<div class="ba-row" style="justify-content:flex-start;gap:16px;margin:2px 0 4px">'+
        '<label class="ba-f" style="margin:0;font-weight:500"><input type="radio" name="ba-cmode" value="fysiek" checked style="width:auto;margin-right:6px">Fysiek</label>'+
        '<label class="ba-f" style="margin:0;font-weight:500"><input type="radio" name="ba-cmode" value="online" style="width:auto;margin-right:6px">Online</label>'+
        '<label class="ba-f" style="margin:0;font-weight:500"><input type="radio" name="ba-cmode" value="hybride" style="width:auto;margin-right:6px">Hybride</label></div>'+
      '<label class="ba-f">Online link (Zoom / Google Meet)</label><input id="ba-clink" placeholder="https://zoom.us/j/...">'+
      '<label class="ba-f">Extra info (Meeting ID / wachtwoord / instructies)</label><textarea id="ba-cinfo" rows="2" placeholder="Meeting ID: 123 4567 · Wachtwoord: yoga" style="width:100%;box-sizing:border-box;resize:vertical;font:inherit;padding:10px 12px;border:1px solid #d1d5db;border-radius:11px"></textarea>'+
      '<div style="margin-top:12px"><button class="ba-btn" data-act="addclass">Les toevoegen</button></div></div>';
  }

  // "09:00–10:00" when an end time is set, otherwise just the start time.
  function tRange(c){return c.endTime?(esc(c.time)+'–'+esc(c.endTime)):esc(c.time);}
  function classRow(c){
    return '<div class="ba-item"><div class="ba-row"><div><b>'+esc(c.title)+'</b> '+modeBadge(c)+'<div class="ba-meta" style="margin:0">'+(c.recurring?('elke '+DOWF[c.day]):fmtDate(c.date))+' · '+tRange(c)+' · max '+c.cap+(c.teacher?(' · '+esc(c.teacher)):'')+locLabel(c)+'</div>'+onlineLine(c)+'</div>'+
      '<div class="ba-row" style="gap:6px">€ <input type="number" step="0.01" min="0" data-act="classprice" data-c="'+c.id+'" value="'+(c.price||0)+'" title="Prijs per les aanpassen" style="width:78px;padding:6px 8px">'+
      '<button class="ba-btn warn sm" data-act="delclass" data-c="'+c.id+'">Verwijderen</button></div></div></div>';
  }

  // Admin Studio-beheer: stats, create class (pick teacher), all classes, ALL bookings (move + attendance).
  function pStudio(){
    var totalBookings=S.bookings.filter(function(b){return b.status==='booked';}).length;
    var subs=S.subscribers||[];
    var subsActive=subs.filter(function(s){return s.status==='active';}).length;
    var h='<div class="ba-stats">'+
      '<div class="ba-stat"><b>'+S.classes.length+'</b><span>actieve klassen</span></div>'+
      '<div class="ba-stat"><b>'+totalBookings+'</b><span>totaal boekingen</span></div>'+
      '<div class="ba-stat"><b>'+subsActive+'/'+subs.length+'</b><span>betalende abonnees</span></div></div>';
    // Abonnementen — betaalstatus: wie betaalt z'n maandabonnement (door)?
    h+='<div class="ba-card" style="margin-top:16px"><h4>Abonnementen — betaalstatus</h4>'+
      '<p class="ba-meta">Wie betaalt z\\u2019n maandabonnement (door)? Verlopen of mislukt = die persoon kan niet meer boeken tot er weer betaald is.</p>'+
      '<div class="ba-list ba-scroll" style="margin-top:10px">';
    if(!subs.length)h+='<p class="ba-meta">Nog geen lopende abonnementen.</p>';
    subs.slice().sort(function(a,b){var o={failed:0,expired:1,active:2};return (o[a.status]||0)-(o[b.status]||0);}).forEach(function(s){
      var badge=s.status==='active'?('<span class="ba-badge ok">Actief'+(s.validUntil?(' &middot; betaald t/m '+esc(s.validUntil)):'')+'</span>'):
        (s.status==='failed'?'<span class="ba-badge full">Betaling mislukt</span>':'<span class="ba-badge warn">Verlopen'+(s.validUntil?(' '+esc(s.validUntil)):'')+'</span>');
      h+='<div class="ba-item"><div class="ba-row"><div><b>'+esc(s.name||s.email)+'</b> <span class="ba-meta" style="margin:0">'+esc(s.email)+' &middot; '+esc(s.membership||'')+'</span></div>'+badge+'</div></div>';
    });
    h+='</div></div>';
    h+='<div class="ba-2">'+createClassCard(null)+
      '<div class="ba-card"><h4>Alle klassen</h4><div class="ba-list" style="margin-top:10px">'+
      (S.classes.length?S.classes.map(classRow).join(''):'<p class="ba-meta">Nog geen klassen.</p>')+'</div></div></div>';
    // Payment-method settings: admin can allow only Stripe, or remove strippenkaart/abonnement.
    h+='<div class="ba-card" style="margin-top:16px"><h4>Betaalmethoden</h4><p class="ba-meta">Kies hoe klanten een les afrekenen.</p>'+
      '<label class="ba-f"><input type="checkbox" data-act="togglepay" data-k="tegoed" '+(S.pay.tegoed?'checked':'')+' style="width:auto;margin-right:6px">Strippenkaart & abonnement</label>'+
      '<label class="ba-f"><input type="checkbox" data-act="togglepay" data-k="stripe" '+(S.pay.stripe?'checked':'')+' style="width:auto;margin-right:6px">Stripe (per les afrekenen)</label>'+
      (S.pay.tegoed?'':'<p class="ba-note">Strippenkaart/abonnement staat uit — klanten kopen losse lessen via Stripe.</p>')+'</div>';
    // Multi-location: optional physical locations. When set, a class can be assigned to one and
    // clients can filter by location. Credits/strippenkaarten are shared across locations.
    var locs=S.locations||[];
    h+='<div class="ba-card" style="margin-top:16px"><h4>Locaties</h4>'+
      '<p class="ba-meta">Heb je meerdere studio-locaties? Voeg ze hier toe — je kunt een les dan aan een locatie koppelen en klanten kunnen erop filteren. Tegoed/strippenkaarten gelden op alle locaties.</p>'+
      '<div class="ba-2"><div><label class="ba-f">Naam</label><input id="ba-locn" placeholder="bijv. Studio Centrum"></div>'+
      '<div><label class="ba-f">Adres (optioneel)</label><input id="ba-loca" placeholder="Straat 1, Stad"></div></div>'+
      '<div style="margin-top:12px"><button class="ba-btn" data-act="addloc">Locatie toevoegen</button></div>'+
      '<div class="ba-list" style="margin-top:12px">';
    if(!locs.length)h+='<p class="ba-meta">Nog geen locaties — de app werkt dan als één locatie.</p>';
    locs.forEach(function(l){h+='<div class="ba-item"><div class="ba-row"><div><b>📍 '+esc(l.name)+'</b>'+(l.address?(' <span class="ba-meta" style="margin:0">'+esc(l.address)+'</span>'):'')+'</div><button class="ba-btn warn sm" data-act="delloc" data-l="'+l.id+'">Verwijderen</button></div></div>';});
    h+='</div></div>';
    // All bookings: who booked (account + e-mail) + reschedule + attendance + cancel
    h+='<div class="ba-card" style="margin-top:16px"><h4>Presentielijst per les</h4><p class="ba-meta">Klik op een les om de namen te zien en af te vinken. Lessen van vandaag staan open.</p><div style="margin-top:10px">';
    var bs=S.bookings.filter(function(b){return b.status==='booked';});
    if(!bs.length)h+='<p class="ba-meta">Nog geen boekingen.</p>';
    var grp={};bs.forEach(function(b){var k=b.classId+'|'+b.date;(grp[k]=grp[k]||[]).push(b);});
    var today0=ymd(new Date());
    Object.keys(grp).sort(function(a,b){var da=a.split('|')[1],dbb=b.split('|')[1];return da<dbb?-1:da>dbb?1:0;}).forEach(function(k){
      var arr=grp[k];var c=S.classes.filter(function(x){return x.id===arr[0].classId;})[0]||{};
      var pres=arr.filter(function(b){return b.present;}).length;var dt=k.split('|')[1];
      h+='<details class="ba-att"'+(dt===today0?' open':'')+'><summary><b>'+esc(c.title||'?')+'</b> <span class="ba-meta" style="margin:0">'+fmtDate(dt)+' '+esc(c.time||'')+locLabel(c)+' &middot; '+arr.length+' geboekt'+(pres?(' &middot; '+pres+' aanwezig'):'')+'</span></summary>';
      arr.forEach(function(b){
        h+='<div class="ba-item"><div class="ba-row"><div><b>'+esc(b.name)+'</b>'+(b.noShow?' <span class="ba-badge warn">no-show</span>':'')+' <span class="ba-meta" style="margin:0">'+esc(b.bookerEmail||'')+' &middot; '+(b.payment==='stripe'?'Stripe':'tegoed')+'</span></div>'+
          '<div class="ba-row" style="gap:6px"><select data-act="moveto" data-b="'+b.id+'" style="width:auto">'+occOptions(b.classId+'|'+b.date)+'</select>'+
          '<button class="ba-btn '+(b.present?'':'ghost')+' sm" data-act="present" data-b="'+b.id+'">'+(b.present?'✓ aanwezig':'aanwezig')+'</button>'+
          '<button class="ba-btn '+(b.noShow?'warn':'ghost')+' sm" data-act="noshow" data-b="'+b.id+'" title="No-show: klant kwam niet en is z\\u2019n tegoed kwijt">'+(b.noShow?'✓ no-show':'no-show')+'</button>'+
          (b.payment==='stripe'&&b.paymentIntent&&!b.refunded?'<button class="ba-btn ghost sm" data-act="refundbk" data-b="'+b.id+'">Annuleer + terugbetalen</button>':'<button class="ba-btn warn sm" data-act="cancel" data-b="'+b.id+'">Annuleer</button>')+'</div></div></div>';
      });
      h+='</details>';
    });
    h+='</div><p class="ba-note">Kies een andere les in het menu om een boeking te verplaatsen.</p></div>';
    // Cancellations log (the admin can remove individual entries or clear the whole log)
    var cx=S.bookings.filter(function(b){return b.status==='cancelled';});
    h+='<div class="ba-card" style="margin-top:16px"><div class="ba-row"><h4>Annuleringen — '+cx.length+'</h4>'+
       (cx.length?'<button class="ba-btn ghost sm" data-act="clearcancels">Alles wissen</button>':'')+'</div><div class="ba-list ba-scroll" style="margin-top:10px">';
    if(!cx.length)h+='<p class="ba-meta">Nog geen annuleringen.</p>';
    cx.forEach(function(b){var c=S.classes.filter(function(x){return x.id===b.classId;})[0]||{};
      h+='<div class="ba-item"><div class="ba-row"><span><b>'+esc(b.name)+'</b> <span class="ba-meta">'+esc(b.bookerEmail||'')+'</span> — '+esc(c.title||'?')+' · les '+fmtDate(b.date)+(b.cancelledAt?(' · geannuleerd op '+fmtDate(b.cancelledAt)):'')+'</span>'+
         '<div class="ba-row" style="gap:6px">'+(b.refunded?'<span class="ba-badge ok">terugbetaald</span>':(b.payment==='stripe'&&b.paymentIntent?'<button class="ba-btn ghost sm" data-act="refundbk" data-b="'+b.id+'">Terugbetalen</button>':''))+
         '<button class="ba-btn warn sm" data-act="delcancel" data-b="'+b.id+'">Verwijderen</button></div></div></div>';});
    h+='</div></div>';
    // Stripe purchases (strippenkaart/abonnement) the admin can refund — partial amount allowed.
    // Verkopen-overzicht: wie kocht een abonnement, strippenkaart of losse les (incl. telefoon).
    var sales=[];
    (S.purchases||[]).forEach(function(x){sales.push({email:x.email,kind:x.type==='abonnement'?'abonnement':'strippenkaart',label:x.name,amount:x.amount,date:x.date});});
    (S.bookings||[]).forEach(function(b){if(b.payment==='stripe'&&b.amount){sales.push({email:b.bookerEmail,kind:'losse les',label:classMeta(b.classId).title,amount:b.amount,date:b.date});}});
    sales.sort(function(a,b){return (b.date||'')<(a.date||'')?-1:1;});
    h+='<div class="ba-card" style="margin-top:16px"><h4>Verkopen — wie kocht wat ('+sales.length+')</h4><p class="ba-meta">Abonnementen, strippenkaarten en losse lessen (via Stripe).</p><div class="ba-list ba-scroll" style="margin-top:10px">';
    if(!sales.length)h+='<p class="ba-meta">Nog geen aankopen.</p>';
    sales.forEach(function(s){var nm=accName(s.email)||s.email,ph=accPhone(s.email);
      h+='<div class="ba-item"><div class="ba-row"><div><b>'+esc(nm)+'</b> <span class="ba-badge'+(s.kind==='abonnement'?' ok':'')+'">'+s.kind+'</span><div class="ba-meta" style="margin:0">'+esc(s.email)+(ph?(' · 📞 '+esc(ph)):'')+' · '+esc(s.label||'')+'</div></div><span class="ba-meta" style="margin:0">€'+s.amount+' · '+fmtDate(s.date)+'</span></div></div>';});
    h+='</div></div>';
    var pus=S.purchases||[];
    h+='<div class="ba-card" style="margin-top:16px"><h4>Strippenkaarten & abonnementen — terugbetalen</h4><div class="ba-list ba-scroll" style="margin-top:10px">';
    if(!pus.length)h+='<p class="ba-meta">Nog geen Stripe-aankopen.</p>';
    pus.forEach(function(x){
      if(x.refunded){h+='<div class="ba-item"><div class="ba-row"><span><b>'+esc(x.name)+'</b> <span class="ba-meta">'+esc(x.email||'')+' · '+(x.type==='abonnement'?'abonnement':'strippenkaart')+' · €'+x.amount+'</span></span><span class="ba-badge ok">terugbetaald'+(x.refundedAmount!=null?(' €'+x.refundedAmount):'')+'</span></div></div>';return;}
      var ctrl=(x.type==='abonnement'&&x.subscription)
        ? '<button class="ba-btn warn sm" data-act="refundpur" data-p="'+x.id+'">Opzeggen & terugbetalen</button>'
        : '€ <input type="number" step="0.01" min="0" max="'+x.amount+'" id="ba-rf-'+x.id+'" value="'+x.amount+'" style="width:84px;padding:6px 8px"> <button class="ba-btn warn sm" data-act="refundpur" data-p="'+x.id+'">Terugbetalen</button>';
      h+='<div class="ba-item"><div class="ba-row"><span><b>'+esc(x.name)+'</b> <span class="ba-meta">'+esc(x.email||'')+' · '+(x.type==='abonnement'?'abonnement':'strippenkaart')+' · €'+x.amount+'</span></span><div class="ba-row" style="gap:6px">'+ctrl+'</div></div></div>';
    });
    h+='</div><p class="ba-note">Bij een strippenkaart vul je zelf in hoeveel je terugstort (standaard het volledige bedrag).</p></div>';
    // Facturen & omzet — kies een periode, bekijk de omzet en download alles als Excel.
    var perOpts='';for(var pm=1;pm<=12;pm++){var lbl=pm+' maand'+(pm===1?'':'en')+(pm===3?' (kwartaal)':(pm===12?' (jaar)':''));perOpts+='<option value="'+pm+'"'+(pm===12?' selected':'')+'>'+lbl+'</option>';}
    h+='<div class="ba-card" style="margin-top:16px"><h4>Facturen &amp; omzet</h4><p class="ba-meta">Automatisch aangemaakt bij elke betaling. Kies een periode om de omzet te zien; download alle facturen als Excel-bestand.</p>'+
      '<div class="ba-row" style="gap:10px;align-items:flex-end;flex-wrap:wrap;justify-content:flex-start">'+
        '<div><label class="ba-f">Periode</label><select id="ba-inv-period" data-act="invperiod" style="width:auto">'+perOpts+'</select></div>'+
        '<a id="ba-inv-dl" class="ba-btn sm" href="'+api('invoices/export?months=12')+'" target="_blank" rel="noopener" style="text-decoration:none">⬇ Download Excel</a>'+
        '<a id="ba-inv-vat" class="ba-btn ghost sm" href="'+api('invoices/vat-report?months=12')+'" target="_blank" rel="noopener" style="text-decoration:none">⬇ BTW-overzicht</a></div>'+
      '<div id="ba-inv-rev" class="ba-card" style="margin-top:12px;text-align:center;background:var(--ba-soft);border:0"><div class="ba-meta" style="margin:0">Omzet in deze periode</div><div class="ba-inv-revval" style="font-size:26px;font-weight:800;margin-top:4px">—</div></div>'+
      '<div id="ba-inv-list" class="ba-list ba-scroll" style="margin-top:10px"><p class="ba-meta">Laden…</p></div></div>';
    // Docenten-uitbetaling — lessen + aanwezigheid per docent, optioneel tarief → Excel.
    h+='<div class="ba-card" style="margin-top:16px"><h4>Docenten-uitbetaling</h4>'+
      '<p class="ba-meta">Aantal gegeven lessen + boekingen + aanwezigheid per docent over de gekozen periode. Vul optioneel een tarief per les in voor een uitbetalingsbedrag.</p>'+
      '<div class="ba-row" style="gap:10px;align-items:flex-end;flex-wrap:wrap;justify-content:flex-start">'+
        '<div><label class="ba-f">Periode</label><select id="ba-pay-period" data-act="payparam" style="width:auto">'+perOpts+'</select></div>'+
        '<div><label class="ba-f">Tarief per les (€)</label><input id="ba-pay-rate" type="number" step="0.01" min="0" value="0" data-act="payparam" style="width:120px"></div>'+
        '<a id="ba-pay-dl" class="ba-btn sm" href="'+api('teacher-payout?months=12&rate=0')+'" target="_blank" rel="noopener" style="text-decoration:none">⬇ Download Excel</a></div></div>';
    // Automatisch overzicht naar de eigenaar (omzet/boekingen/no-shows) per week of maand.
    var orep=(S.settings&&S.settings.ownerReport)||'off';
    h+='<div class="ba-card" style="margin-top:16px"><h4>Automatisch rapport</h4>'+
      '<p class="ba-meta">Ontvang automatisch een overzicht (omzet, boekingen, lessen, no-shows) per e-mail. Werkt zodra e-mail is ingesteld bij Communicatie.</p>'+
      '<label class="ba-f">Frequentie</label><select data-act="setownerreport" style="width:auto">'+
        '<option value="off"'+(orep==='off'?' selected':'')+'>Uit</option>'+
        '<option value="weekly"'+(orep==='weekly'?' selected':'')+'>Wekelijks</option>'+
        '<option value="monthly"'+(orep==='monthly'?' selected':'')+'>Maandelijks</option></select>'+
      '<label class="ba-f" style="margin-top:16px">Google-review-link</label>'+
      '<p class="ba-meta" style="margin:0 0 6px">Plak hier je Google-review-link. Klanten krijgen na hun eerste les automatisch een vriendelijk verzoek om een review. Laat leeg om uit te zetten.</p>'+
      '<div class="ba-row" style="gap:8px;justify-content:flex-start"><input id="ba-review-url" placeholder="https://g.page/r/..." value="'+esc((S.settings&&S.settings.reviewUrl)||'')+'" style="flex:1;min-width:200px"><button class="ba-btn sm" data-act="savereview">Opslaan</button></div></div>';
    return h;
  }
  // Load the invoice list into the Facturen card (admin Studio-beheer), then show revenue for the period.
  function refreshInvoices(){var box=q('ba-inv-list');if(!box||!projId())return;
    fetch(api('invoices')).then(function(r){return r.json();}).then(function(rows){
      _invRows=Array.isArray(rows)?rows:[];updateInvPeriod();
    }).catch(function(){box.innerHTML='<p class="ba-meta">Kon facturen niet laden.</p>';});}
  // Recompute revenue + invoice list + Excel download link for the chosen period (no refetch).
  function updateInvPeriod(){
    var box=q('ba-inv-list');if(!box)return;
    var sel=q('ba-inv-period');var m=sel?(parseInt(sel.value,10)||12):12;
    var cutoff=new Date();cutoff.setMonth(cutoff.getMonth()-m);cutoff.setHours(0,0,0,0);
    var rows=(_invRows||[]).filter(function(i){return i.createdAt&&new Date(i.createdAt)>=cutoff;});
    var total=rows.reduce(function(s,i){return s+(i.total||0);},0);
    var cur=(rows[0]&&rows[0].currency)||'EUR';var sym=cur==='GBP'?'£':(cur==='USD'?'$':'€');
    var rev=root.querySelector('.ba-inv-revval');if(rev)rev.textContent=sym+(Math.round(total*100)/100).toFixed(2).replace('.',',')+' · '+rows.length+' facturen';
    var dl=q('ba-inv-dl');if(dl)dl.setAttribute('href',api('invoices/export?months='+m));
    var vat=q('ba-inv-vat');if(vat)vat.setAttribute('href',api('invoices/vat-report?months='+m));
    box.innerHTML=rows.length?rows.map(function(i){return '<div class="ba-item"><div class="ba-row"><div><b>'+esc(i.number)+'</b> <span class="ba-meta" style="margin:0">'+esc(i.customerName||i.customerEmail||'')+' · '+esc(i.description||'')+' · €'+i.total+' · '+esc(i.date)+'</span></div>'+
      '<a class="ba-btn ghost sm" href="'+api('invoice/'+i.id+'/pdf')+'" target="_blank" rel="noopener">⬇ PDF</a></div></div>';}).join(''):'<p class="ba-meta">Geen facturen in deze periode.</p>';
  }

  // Teacher "Mijn lessen": only own classes + their bookings/attendance.
  function pMijn(){
    var email=S.session.email;
    var own=S.classes.filter(function(c){return c.teacherEmail===email;});
    var ownIds={};own.forEach(function(c){ownIds[c.id]=1;});
    var h='<div class="ba-stats">'+
      '<div class="ba-stat"><b>'+own.length+'</b><span>jouw klassen</span></div>'+
      '<div class="ba-stat"><b>'+S.bookings.filter(function(b){return b.status==='booked'&&ownIds[b.classId];}).length+'</b><span>boekingen op jouw lessen</span></div></div>';
    h+='<div class="ba-2">'+createClassCard(email)+
      '<div class="ba-card"><h4>Mijn klassen</h4><div class="ba-list" style="margin-top:10px">'+
      (own.length?own.map(classRow).join(''):'<p class="ba-meta">Je hebt nog geen lessen.</p>')+'</div></div></div>';
    h+='<div class="ba-card" style="margin-top:16px"><h4>Presentielijst per les</h4><p class="ba-meta">Klik op een les om in een apart venster de aanwezigheid af te vinken.</p><div class="ba-list" style="margin-top:10px">';
    var bs=S.bookings.filter(function(b){return b.status==='booked'&&ownIds[b.classId];});
    if(!bs.length)h+='<p class="ba-meta">Nog geen boekingen op jouw lessen.</p>';
    var tgrp={};bs.forEach(function(b){var k=b.classId+'|'+b.date;(tgrp[k]=tgrp[k]||[]).push(b);});
    Object.keys(tgrp).sort(function(a,b){var da=a.split('|')[1],dbb=b.split('|')[1];return da<dbb?-1:da>dbb?1:0;}).forEach(function(k){
      var arr=tgrp[k];var c=S.classes.filter(function(x){return x.id===arr[0].classId;})[0]||{};
      var pres=arr.filter(function(b){return b.present;}).length;var dt=k.split('|')[1];
      h+='<button class="ba-item" data-act="att-open" data-k="'+esc(k)+'" style="display:block;width:100%;text-align:left;cursor:pointer;border:0;font:inherit;font-family:inherit;background:#fff">'+
         '<div class="ba-row"><div><b>'+esc(c.title||'?')+'</b><div class="ba-meta" style="margin:0">'+fmtDate(dt)+' '+esc(c.time||'')+locLabel(c)+'</div></div>'+
         '<span class="ba-badge'+(pres?' ok':'')+'">'+arr.length+' geboekt'+(pres?(' &middot; '+pres+' aanwezig'):'')+' &rsaquo;</span></div></button>';
    });
    h+='</div></div>';
    return h;
  }

  // Admin "Docenten": list + add + remove teacher accounts.
  function pDocenten(){
    var h='<div class="ba-2"><div class="ba-card"><h4>Docent toevoegen</h4><p class="ba-meta">Krijgt een eigen login en ziet alleen de eigen lessen.</p>'+
      '<label class="ba-f">Naam</label><input id="dz-n">'+
      '<label class="ba-f">E-mail</label><input id="dz-e" placeholder="docent@studio.nl">'+
      '<label class="ba-f">Wachtwoord</label><input id="dz-p" type="password">'+
      '<div style="margin-top:12px"><button class="ba-btn" data-act="addteacher">Docent toevoegen</button></div>'+
      '<div id="dz-err" class="ba-note" style="color:#b91c1c"></div></div>'+
      '<div class="ba-card"><h4>Team (beheerder & docenten) — '+S.accounts.filter(function(a){return a.role==='admin'||a.role==='teacher';}).length+'</h4><div class="ba-list ba-scroll" style="margin-top:10px">';
    var me=(S.session&&S.session.email)||'';
    // Staff only — clients are listed separately below. You can delete anyone (incl. other
    // admins) EXCEPT the account you are logged in as.
    var staff=S.accounts.filter(function(a){return a.role==='admin'||a.role==='teacher';});
    staff.forEach(function(a){
      var self=a.email===me;
      h+='<div class="ba-item"><div class="ba-row"><div><b>'+esc(a.name)+'</b> <span class="ba-badge'+(a.role==='admin'?' ok':'')+'">'+(a.role==='admin'?'beheerder':'docent')+'</span><div class="ba-meta" style="margin:0">'+esc(a.email)+'</div></div>'+
         (self?'<span class="ba-meta" style="margin:0">jij — actief</span>':'<button class="ba-btn warn sm" data-act="delacc" data-e="'+esc(a.email)+'">Verwijderen</button>')+'</div></div>';
    });
    h+='</div></div></div>';
    // Registered customers (self-registered at login) — shown as KLANTEN, never as docenten.
    var clients=S.accounts.filter(function(a){return a.role==='client';});
    h+='<div class="ba-card" style="margin-top:16px"><h4>Klanten — '+clients.length+' totaal</h4><p class="ba-meta">Alle gegevens van zelf-geregistreerde klanten.</p><div class="ba-list ba-scroll" style="margin-top:10px">';
    if(!clients.length)h+='<p class="ba-meta">Nog geen geregistreerde klanten.</p>';
    clients.forEach(function(a){
      var self=a.email===me;
      var w=(S.wallets&&S.wallets[a.email])||{};
      var tegoed=w.membership?('Abonnement: '+esc(w.membership)):((w.credits||0)+' credits');
      var nBook=(S.bookings||[]).filter(function(b){return b.bookerEmail===a.email&&b.status==='booked';}).length;
      var spent=0;
      (S.purchases||[]).forEach(function(x){if(x.email===a.email)spent+=(x.amount||0);});
      (S.bookings||[]).forEach(function(b){if(b.bookerEmail===a.email&&b.payment==='stripe'&&b.amount&&!b.refunded)spent+=(b.amount||0);});
      h+='<div class="ba-item"><div class="ba-row"><div><b>'+esc(a.name)+'</b> <span class="ba-badge">klant</span>'+
         '<div class="ba-meta" style="margin:2px 0 0">✉️ '+esc(a.email)+(a.phone?('  ·  📞 '+esc(a.phone)):'  ·  📞 —')+'</div>'+
         '<div class="ba-meta" style="margin:2px 0 0">🎟️ '+tegoed+(w.validUntil?(' (geldig t/m '+fmtDate(w.validUntil)+')'):'')+'  ·  📅 '+nBook+' boeking(en)  ·  💶 €'+spent+' besteed</div></div>'+
         (self?'<span class="ba-meta" style="margin:0">jij — actief</span>':'<button class="ba-btn warn sm" data-act="delacc" data-e="'+esc(a.email)+'">Verwijderen</button>')+'</div></div>';
    });
    h+='</div></div>';
    return h;
  }

  function pLeden(){
    var W=walletFor(myEmail());
    var cur=walletBadge(W);
    var h='<div class="ba-row" style="margin-bottom:14px"><div class="ba-meta" style="margin:0">Huidig: '+cur+(W.validUntil?(' · geldig t/m '+W.validUntil):'')+'</div></div>';
    // Aparte strippenkaart-potjes (elk met eigen vervaldatum) — alleen tonen als er meer dan één is.
    var lots=(W.creditLots||[]).filter(function(l){return l.credits>0;});
    if(lots.length>1){
      h+='<div class="ba-card" style="margin-bottom:14px"><b>Je strippenkaarten</b><div class="ba-list" style="margin-top:8px">'+
        lots.map(function(l){return '<div class="ba-item"><div class="ba-row"><span>'+l.credits+' lessen</span><span class="ba-meta">'+(l.expiresAt?('geldig t/m '+fmtDate(l.expiresAt)):'geen vervaldatum')+'</span></div></div>';}).join('')+
        '</div><p class="ba-note">De kaart die het eerst verloopt wordt als eerste gebruikt.</p></div>';
    }
    h+='<div class="ba-grid">';
    if(!S.members.length)h+='<p class="ba-meta">Er zijn op dit moment geen lidmaatschappen te koop.</p>';
    S.members.forEach(function(m){
      var inhoud=isUnlimited(m)?'onbeperkt lessen':((m.credits||0)+' lessen'+(m.type==='abonnement'?' per maand':''));
      var commitTxt=m.commitMonths?(' · '+(m.commitMonths===12?'1 jaar':m.commitMonths===24?'2 jaar':m.commitMonths+' maanden')+' vast'):'';
      var resetTxt=m.resetMonthly?' · tegoed vervalt maandelijks':'';
      h+='<div class="ba-card"><div class="ba-row"><h4>'+esc(m.name)+'</h4><span class="ba-badge">'+(m.type==='strippenkaart'?'strippenkaart':'abonnement')+'</span></div>'+
         '<p class="ba-meta">'+inhoud+' · geldig '+m.validDays+' dagen'+(m.recurring?' · automatisch verlengd':'')+commitTxt+resetTxt+'</p>'+
         '<div class="ba-row"><b style="font-size:20px">€'+m.price+(m.recurring?'<span class="ba-meta" style="font-size:12px"> /maand</span>':'')+'</b>'+
         '<button class="ba-btn sm" data-act="buy" data-m="'+m.id+'">Kopen</button></div></div>';
    });
    h+='</div>';
    // Only the studio admin can create new membership TYPES; clients just buy them.
    if(S.session&&S.session.role==='admin'){
      h+='<div class="ba-card" style="margin-top:16px"><h4>Nieuw lidmaatschap</h4>'+
        '<div class="ba-2"><div><label class="ba-f">Naam</label><input id="ba-mn" placeholder="bijv. Maandabonnement"></div>'+
        '<div><label class="ba-f">Type</label><select id="ba-mt"><option value="strippenkaart">Strippenkaart</option><option value="abonnement">Abonnement (maand)</option></select></div></div>'+
        '<div class="ba-2"><div><label class="ba-f">Bij abonnement</label><select id="ba-ml"><option value="onbeperkt">Onbeperkte lessen</option><option value="aantal">Aantal lessen per maand</option></select></div>'+
        '<div><label class="ba-f">Aantal lessen</label><input id="ba-mc" type="number" value="8"></div></div>'+
        '<div class="ba-2"><div><label class="ba-f">Prijs (€)</label><input id="ba-mp" type="number" value="55"></div>'+
        '<div><label class="ba-f">Geldig (dagen)</label><input id="ba-mv" type="number" value="30"></div></div>'+
        '<div class="ba-2"><div><label class="ba-f">Vaste looptijd (alleen abonnement)</label><select id="ba-mcommit"><option value="0">Vrij opzegbaar (maandelijks)</option><option value="6">6 maanden vast</option><option value="12">1 jaar vast</option><option value="24">2 jaar vast</option></select></div>'+
        '<div><label class="ba-f" style="display:block">&nbsp;</label><label class="ba-f" style="font-weight:400"><input id="ba-mreset" type="checkbox" style="width:auto;margin-right:6px">Tegoed vervalt elke maand (stapelt niet op)</label></div></div>'+
        '<div style="margin-top:12px"><button class="ba-btn" data-act="addmember">Toevoegen</button></div>'+
        '<p class="ba-note">Strippenkaart = vast aantal lessen (eenmalig). Abonnement = maandelijks, onbeperkt óf een aantal lessen per maand. <b>Geldig (dagen)</b>: bij een strippenkaart bepaalt dit hoelang de gekochte credits geldig blijven — daarna vervallen ze. <b>Vaste looptijd</b>: de klant betaalt maandelijks maar kan niet eerder opzeggen dan de gekozen termijn. <b>Tegoed vervalt elke maand</b>: ongebruikte lessen gaan niet mee naar de volgende maand. Echte betaling/recurring billing loopt via Stripe — zie Integraties.</p></div>';
      // Manage existing membership types: the admin can delete any of them.
      h+='<div class="ba-card" style="margin-top:16px"><h4>Bestaande lidmaatschappen — '+S.members.length+'</h4><div class="ba-list ba-scroll" style="margin-top:10px">';
      if(!S.members.length)h+='<p class="ba-meta">Nog geen lidmaatschappen.</p>';
      S.members.forEach(function(m){
        var inhoud=isUnlimited(m)?'onbeperkt':((m.credits||0)+' lessen');
        h+='<div class="ba-item"><div class="ba-row"><div><b>'+esc(m.name)+'</b> <span class="ba-badge">'+(m.type==='strippenkaart'?'strippenkaart':'abonnement')+'</span><div class="ba-meta" style="margin:0">'+inhoud+'</div></div>'+
           '<div class="ba-row" style="gap:6px">€ <input type="number" step="0.01" min="0" data-act="memberprice" data-m="'+m.id+'" value="'+(m.price||0)+'" title="Prijs aanpassen" style="width:78px;padding:6px 8px">'+
           '<button class="ba-btn warn sm" data-act="delmember" data-m="'+m.id+'">Verwijderen</button></div></div></div>';
      });
      h+='</div></div>';
      // Discount codes / promos / gift cards
      var codes=S.codes||[];
      h+='<div class="ba-card" style="margin-top:16px"><h4>Kortingscode of cadeaubon</h4>'+
        '<div class="ba-2"><div><label class="ba-f">Code</label><input id="ba-cc" placeholder="bijv. ZOMER10"></div>'+
        '<div><label class="ba-f">Type</label><select id="ba-ck"><option value="percent">Percentage korting (%)</option><option value="fixed">Vast bedrag (&euro;)</option><option value="gift">Cadeaubon (saldo &euro;)</option></select></div></div>'+
        '<div class="ba-2"><div><label class="ba-f">Waarde</label><input id="ba-cv" type="number" step="0.01" min="0" value="10"></div>'+
        '<div><label class="ba-f">Verloopt op (optioneel)</label><input id="ba-ce" type="date"></div></div>'+
        '<div class="ba-2"><div><label class="ba-f">Max. keer te gebruiken (0 = onbeperkt)</label><input id="ba-cu" type="number" min="0" value="0"></div><div></div></div>'+
        '<div style="margin-top:12px"><button class="ba-btn" data-act="addcode">Aanmaken</button></div>'+
        '<p class="ba-note">Percentage = % van het bedrag. Vast bedrag = vaste korting in euro. Cadeaubon = een saldo dat per gebruik wordt afgeschreven. Klanten vullen de code in bij het afrekenen.</p></div>';
      h+='<div class="ba-card" style="margin-top:16px"><h4>Bestaande codes &mdash; '+codes.length+'</h4><div class="ba-list ba-scroll" style="margin-top:10px">';
      if(!codes.length)h+='<p class="ba-meta">Nog geen codes.</p>';
      codes.forEach(function(c){
        var kindLbl=c.kind==='percent'?(c.value+'% korting'):(c.kind==='fixed'?('&euro;'+c.value+' korting'):('cadeaubon &euro;'+c.value));
        var saldo=c.kind==='gift'?(' &middot; saldo &euro;'+c.balance):'';
        var lim=(c.maxUses>0?(c.uses+'/'+c.maxUses+' gebruikt'):(c.uses+'x gebruikt'));
        var exp=c.expiresAt?(' &middot; t/m '+esc(c.expiresAt)):'';
        h+='<div class="ba-item"><div class="ba-row"><div><b>'+esc(c.code)+'</b> <span class="ba-badge">'+kindLbl+'</span><div class="ba-meta" style="margin:0">'+lim+saldo+exp+'</div></div>'+
           '<button class="ba-btn warn sm" data-act="delcode" data-c="'+c.id+'">Verwijderen</button></div></div>';
      });
      h+='</div></div>';
    }
    return h;
  }

  function pComm(){
    return '<div class="ba-2"><div class="ba-card"><h4>E-mail</h4>'+
      '<div id="ba-comm-status" class="ba-note" style="margin:6px 0">Status laden…</div>'+
      '<p class="ba-meta">Alle automatische e-mails (bevestiging, annulering, welkom, wachtwoord-reset, 24u-herinnering) worden centraal verstuurd.</p>'+
      '<div class="ba-row" style="justify-content:flex-start;gap:8px;margin-top:8px"><button class="ba-btn sm" data-act="email-sendtest">Testmail versturen</button></div>'+
      '<div id="ba-comm-out" class="ba-note" style="margin-top:8px"></div>'+
      '<label class="ba-f" style="margin-top:16px"><input type="checkbox" id="ba-rem" '+(S.reminders?'checked':'')+' data-act="togglerem" style="width:auto;margin-right:6px">24u-herinnering voor elke geboekte les</label>'+
      '<p class="ba-note" style="margin-top:8px">Facturen worden automatisch aangemaakt bij elke betaling — zie het overzicht in Studio-beheer.</p></div>'+
      '<div class="ba-card"><h4>Bericht naar leden</h4>'+
      '<p class="ba-meta">Schrijf zelf een bericht en stuur het als echte e-mail naar je leden.</p>'+
      '<label class="ba-f">Ontvangers</label><select id="ba-bc-scope"><option value="klanten">Alle klanten</option><option value="boekers">Iedereen met een (actieve) boeking</option></select>'+
      '<label class="ba-f">Onderwerp</label><input id="ba-bc-subj" placeholder="Onderwerp van je e-mail">'+
      '<label class="ba-f">Bericht</label><textarea id="ba-bc-body" rows="7" placeholder="Schrijf hier je bericht…" style="width:100%;box-sizing:border-box;resize:vertical;font:inherit;padding:10px 12px;border:1px solid #d1d5db;border-radius:10px"></textarea>'+
      '<div class="ba-row" style="justify-content:flex-start;margin-top:10px"><button class="ba-btn sm" data-act="broadcast">Versturen naar leden</button></div>'+
      '<div id="ba-bc-out" class="ba-note" style="margin-top:8px"></div></div></div>';
  }
  // Recipients for "bericht naar leden": all client accounts, or everyone with an active booking.
  function recipientEmails(scope){var m={};
    if(scope==='boekers'){(S.bookings||[]).forEach(function(b){if(b.bookerEmail&&b.status!=='cancelled')m[b.bookerEmail.toLowerCase()]=1;});}
    else{(S.accounts||[]).forEach(function(a){if(a.role==='client'&&a.email)m[a.email.toLowerCase()]=1;});}
    return Object.keys(m);}
  // Show from which central address mails are sent (configured by the platform, not per studio).
  function refreshEmailStatus(){var st=q('ba-comm-status');if(!st||!projId())return;
    fetch(api('email')).then(function(r){return r.json();}).then(function(d){
      if(d&&d.configured){st.style.color='#15803d';st.innerHTML='E-mails worden verstuurd vanaf <b>'+esc(d.from||'')+'</b>.';}
      else{st.style.color='#b45309';st.textContent='E-mail is nog niet ingesteld door de beheerder van het platform.';}
    }).catch(function(){st.textContent='';});}

  function pKoppel(){
    // Real Stripe Connect onboarding (no demo) — money goes straight to the studio.
    var h='<div class="ba-grid"><div class="ba-card"><div class="ba-row"><h4>Stripe</h4><span class="ba-badge" id="ba-stripe-badge">controleren…</span></div>'+
      '<p class="ba-meta">Echte betalingen (iDEAL/creditcard). Het geld gaat rechtstreeks naar de studio.</p>'+
      '<button class="ba-btn sm" data-act="stripe-onboard">Koppel met Stripe</button> <span id="ba-stripe-extra" class="ba-note" style="margin:0"></span></div></div>';
    // Agenda koppelen: Google direct (instant via OAuth) + een .ics-feed voor Outlook/Apple/overig.
    h+='<div class="ba-card" style="margin-top:16px"><h4>Agenda koppelen</h4>'+
      '<p class="ba-meta">Koppel je eigen agenda aan de app. Lessen verschijnen dan automatisch in je agenda.</p>'+
      '<div class="ba-card" style="background:rgba(255,255,255,.03)"><div class="ba-row"><b>Google Agenda — direct</b> <span class="ba-badge" id="ba-gcal-status">…</span></div>'+
        '<p class="ba-meta" style="margin:6px 0 10px">Aanbevolen voor Google: lessen verschijnen <b>meteen</b>, geen wachttijd. Je logt eenmalig in met Google.</p>'+
        '<div class="ba-row" style="justify-content:flex-start;gap:8px"><button class="ba-btn sm" data-act="gcal-connect">Koppel Google Agenda</button><button class="ba-btn ghost sm" data-act="gcal-disconnect">Ontkoppelen</button></div>'+
        '<div id="ba-gcal-extra" class="ba-note" style="margin:6px 0 0"></div></div>'+
      '<div style="margin-top:12px"><b style="font-size:14px">Andere agenda (Outlook / Apple) — abonnementslink</b>'+
        '<p class="ba-meta" style="margin:4px 0 6px">Hierbij bepaalt de agenda-dienst zelf hoe vaak hij ververst (kan enkele uren duren).</p>'+
        '<div class="ba-row" style="justify-content:flex-start"><button class="ba-btn sm" data-act="cal-connect">Toon abonnementslink</button></div>'+
        '<div id="ba-cal-box" style="margin-top:10px"></div></div>'+
      '</div>';
    // Facturatie: studio vult wettelijke gegevens in → factuur gaat automatisch mee bij elke betaling.
    h+='<div class="ba-card" style="margin-top:16px"><h4>Facturatie instellen</h4>'+
      '<div id="ba-inv-status" class="ba-note" style="margin:4px 0 10px">Laden…</div>'+
      '<p class="ba-meta">Deze gegevens komen op elke factuur (verplicht volgens de wet). Bij elke betaling krijgt de klant automatisch een betaalbevestiging met factuur.</p>'+
      '<div class="ba-2"><div><label class="ba-f">Land</label><select id="ba-inv-country" data-act="inv-country"><option value="NL">Nederland (BTW / KvK)</option><option value="UK">Verenigd Koninkrijk (VAT)</option><option value="US">Verenigde Staten (Sales tax)</option></select></div>'+
      '<div><label class="ba-f">&nbsp;</label><div id="ba-inv-cur" class="ba-note" style="margin:0;padding-top:10px">Valuta: EUR (€)</div></div></div>'+
      '<label class="ba-f">Bedrijfsnaam</label><input id="ba-inv-company" placeholder="Saha Studio">'+
      '<label class="ba-f">Adres</label><input id="ba-inv-address" placeholder="Yogaweg 10">'+
      '<div class="ba-2"><div><label class="ba-f">Postcode</label><input id="ba-inv-postcode" placeholder="3061 AA"></div>'+
      '<div><label class="ba-f">Plaats</label><input id="ba-inv-city" placeholder="Rotterdam"></div></div>'+
      '<div class="ba-2"><div><label class="ba-f"><span id="ba-inv-reg-l">KvK-nummer</span></label><input id="ba-inv-kvk" placeholder="12345678"></div>'+
      '<div><label class="ba-f"><span id="ba-inv-taxid-l">BTW-nummer</span></label><input id="ba-inv-vat" placeholder="NL123456789B01"></div></div>'+
      '<div class="ba-2"><div><label class="ba-f"><span id="ba-inv-tax-l">BTW %</span></label><input id="ba-inv-vatp" type="number" value="21"></div>'+
      '<div><label class="ba-f">Contact-e-mail (optioneel)</label><input id="ba-inv-email" placeholder="info@studio.nl"></div></div>'+
      '<div class="ba-row" style="justify-content:flex-start;margin-top:12px"><button class="ba-btn sm" data-act="invoice-save">Opslaan</button></div>'+
      '<div id="ba-inv-out" class="ba-note" style="margin-top:8px"></div></div>';
    // Migratie vanuit andere boekingssoftware: upload de CSV-exports, zie een samenvatting + fouten, en stuur activatie-mails.
    h+='<div class="ba-card" style="margin-top:16px"><h4>Importeren uit andere boekingssoftware</h4>'+
      '<div id="ba-mb-status" class="ba-note" style="margin:4px 0 10px">Laden…</div>'+
      '<p class="ba-meta">Stap je over van een ander systeem (zoals Mindbody, Momoyoga of Eversports)? Exporteer daar je klanten, strippenkaarten en abonnementen als CSV en upload ze hier. De kolomnamen worden automatisch herkend. Creditcardgegevens worden nooit geïmporteerd.</p>'+
      '<p class="ba-meta" style="margin-bottom:4px"><b>Optie A — aparte bestanden</b> (per type één CSV):</p>'+
      '<div class="ba-2"><div><label class="ba-f">1. Klanten (CSV)</label><input id="ba-mb-clients" type="file" accept=".csv,text/csv"></div>'+
      '<div><label class="ba-f">2. Strippenkaarten (CSV)</label><input id="ba-mb-packs" type="file" accept=".csv,text/csv"></div></div>'+
      '<div class="ba-2"><div><label class="ba-f">3. Abonnementen (CSV)</label><input id="ba-mb-members" type="file" accept=".csv,text/csv"></div><div></div></div>'+
      '<div class="ba-row" style="justify-content:flex-start;gap:8px;margin-top:12px"><button class="ba-btn sm" data-act="mb-import">Importeren</button>'+
      '<button class="ba-btn ghost sm" data-act="mb-send">Activatie-mails sturen</button></div>'+
      '<div style="border-top:1px solid var(--ba-line);margin:16px 0 12px;text-align:center"><span class="ba-meta" style="background:#141312;padding:0 10px;position:relative;top:-11px">— of —</span></div>'+
      '<p class="ba-meta" style="margin-bottom:4px"><b>Optie B — alles in één bestand</b> (klanten + strippenkaarten + abonnementen door elkaar):</p>'+
      '<div class="ba-2"><div><label class="ba-f">Eén CSV met alles erin</label><input id="ba-mb-all" type="file" accept=".csv,text/csv"></div>'+
      '<div><label class="ba-f">&nbsp;</label><button class="ba-btn sm" data-act="mb-import-all" style="margin-top:2px">Alles-in-één importeren</button></div></div>'+
      '<p class="ba-note" style="margin-top:2px">Elke rij wordt automatisch herkend als klant, strippenkaart of abonnement (op basis van een type-kolom of de productnaam).</p>'+
      '<div id="ba-mb-out" class="ba-note" style="margin-top:10px"></div>'+
      '<p class="ba-note" style="margin-top:6px">Klanten krijgen een mail met een eenmalige activatielink. Daarmee maken ze een wachtwoord aan en staan hun strippenkaart/abonnement meteen klaar.</p></div>';
    return h;
  }
  // One readable line per import summary (with the first few row errors, if any).
  function mbSummaryLine(s){
    var label=s.type==='clients'?'Klanten':s.type==='class_packs'?'Strippenkaarten':s.type==='memberships'?'Abonnementen':'Alles-in-één';
    var parts=[s.rows+' rijen',s.created+' nieuw',s.updated+' bijgewerkt'];
    if(s.type==='class_packs'||s.type==='combined')parts.push(s.packsActive+' strippenkaarten');
    if(s.type==='memberships'||s.type==='combined')parts.push(s.membershipsFound+' abonnementen');
    if(s.expiredOrDepleted)parts.push(s.expiredOrDepleted+' verlopen/leeg');
    var line='<b>'+label+':</b> '+esc(parts.join(' · '));
    if(s.errors&&s.errors.length)line+=' — <span style="color:#b45309">'+s.errors.length+' fout(en): '+esc(s.errors.slice(0,3).map(function(e){return 'rij '+e.row+' ('+e.message+')';}).join(', '))+(s.errors.length>3?'…':'')+'</span>';
    return line;
  }
  // Aggregate import status for the admin (customers / activated / active packs+memberships).
  function refreshImportStatus(){var st=q('ba-mb-status');if(!st||!projId())return;
    fetch(api('import/summary')).then(function(r){return r.json();}).then(function(d){
      if(!d||d.error){st.textContent='';return;}st.style.color='#374151';
      st.textContent=d.customers+' klant(en) geïmporteerd · '+d.activated+' geactiveerd · '+d.packsActive+' strippenkaarten · '+d.membershipsActive+' abonnementen actief'+(d.expiredOrDepleted?(' · '+d.expiredOrDepleted+' verlopen/leeg'):'');
    }).catch(function(){st.textContent='';});}
  // Per-land factuurconfig (labels/valuta/standaardtarief). KvK is NL-only; UK = VAT + company no.;
  // US = EIN + sales tax (vaak 0% op diensten). Houdt gelijke tred met COUNTRIES in lib/invoice.ts.
  var INVC={
    NL:{reg:'KvK-nummer',taxid:'BTW-nummer',tax:'BTW %',regph:'12345678',taxph:'NL123456789B01',dft:21,cur:'EUR (€)'},
    UK:{reg:'Company number',taxid:'VAT registration no.',tax:'VAT %',regph:'12345678',taxph:'GB123456789',dft:20,cur:'GBP (£)'},
    US:{reg:'EIN (Employer ID)',taxid:'Tax ID (optioneel)',tax:'Sales tax %',regph:'12-3456789',taxph:'optioneel',dft:0,cur:'USD ($)'}
  };
  // Relabel the invoice fields for the chosen country; setTax=true also resets the % to that country's default.
  function applyInvoiceCountry(country,setTax){var k=INVC[country]||INVC.NL;
    var lbl=function(id,t){var el=q(id);if(el)el.textContent=t;};
    lbl('ba-inv-reg-l',k.reg);lbl('ba-inv-taxid-l',k.taxid);lbl('ba-inv-tax-l',k.tax);
    var reg=q('ba-inv-kvk');if(reg)reg.placeholder=k.regph;
    var tid=q('ba-inv-vat');if(tid)tid.placeholder=k.taxph;
    var cur=q('ba-inv-cur');if(cur)cur.textContent='Valuta: '+k.cur;
    if(setTax){var vp=q('ba-inv-vatp');if(vp)vp.value=k.dft;}}
  // Load/save the studio's invoice (Facturatie) settings.
  function refreshInvoiceSettings(){var st=q('ba-inv-status');if(!st||!projId())return;
    fetch(api('invoice-settings')).then(function(r){return r.json();}).then(function(d){
      if(!d)return;var setv=function(id,v){var el=q(id);if(el&&v!=null)el.value=v;};
      var country=d.country||'NL';setv('ba-inv-country',country);
      setv('ba-inv-company',d.company);setv('ba-inv-address',d.address);setv('ba-inv-postcode',d.postcode);setv('ba-inv-city',d.city);setv('ba-inv-kvk',d.kvk);setv('ba-inv-vat',d.vat);setv('ba-inv-vatp',d.vatPercent);setv('ba-inv-email',d.email);
      applyInvoiceCountry(country,false);
      st.style.color=d.configured?'#15803d':'#b45309';st.textContent=d.configured?'Facturatie ingesteld — facturen gaan automatisch mee.':'Nog niet ingesteld — vul je bedrijfsgegevens in voor wettelijke facturen.';
    }).catch(function(){st.textContent='';});}

  // Client dashboard: a permanent overview of THIS customer's booked lessons, with the online
  // link + meeting info for online/hybride classes, and all other details.
  function pClientDash(){
    var email=myEmail();
    var mineB=(S.bookings||[]).filter(function(b){return b.bookerEmail===email&&(b.status==='booked'||b.status==='waitlist');});
    mineB.sort(function(a,b){var ca=classMeta(a.classId),cb=classMeta(b.classId);return ((a.date||'')+ (ca.time||''))<((b.date||'')+(cb.time||''))?-1:1;});
    var W=walletFor(email);
    var wallet=walletBadge(W);
    var h='<div class="ba-row" style="margin-bottom:14px"><div class="ba-meta" style="margin:0">Jouw tegoed: '+wallet+'</div></div>';
    h+='<div class="ba-card"><h4>Mijn geboekte lessen</h4><div class="ba-list" style="margin-top:10px">';
    if(!mineB.length)h+='<p class="ba-meta">Je hebt nog geen lessen geboekt. Ga naar "Lessen boeken".</p>';
    mineB.forEach(function(b){var c=classMeta(b.classId);
      var fc=(S.classes||[]).filter(function(x){return x.id===b.classId;})[0]||{};
      var modeBadge=c.mode==='online'?'<span class="ba-badge">💻 Online</span>':c.mode==='hybride'?'<span class="ba-badge">🔀 Hybride</span>':'<span class="ba-badge">📍 Fysiek</span>';
      var statusBadge=b.status==='waitlist'?'<span class="ba-badge">wachtlijst</span>':'<span class="ba-badge ok">geboekt</span>';
      var past=isPast(b.date,c.time);
      var locked=b.status==='booked'&&cancelClosed(fc,b.date);
      var online=((c.mode==='online'||c.mode==='hybride')&&c.link)?('<div class="ba-meta" style="margin:6px 0 0">💻 <a href="'+esc(c.link)+'" target="_blank" rel="noopener" style="color:var(--ba);font-weight:600">Online deelnemen ↗</a>'+(c.info?('<div style="margin-top:4px">'+esc(c.info)+'</div>'):'')+'</div>'):'';
      h+='<div class="ba-item"><div class="ba-row"><div><b>'+esc(c.title)+'</b> '+modeBadge+' '+statusBadge+(past?' <span class="ba-meta">(geweest)</span>':'')+
        '<div class="ba-meta" style="margin:2px 0 0">📅 '+fmtDate(b.date)+' · '+esc(c.time||'')+(c.teacher?(' · '+esc(c.teacher)):'')+'</div>'+online+'</div>'+
        (past?'':(locked?'<button class="ba-btn sm" disabled>Annuleren gesloten</button>':'<button class="ba-btn warn sm" data-act="cancel" data-b="'+b.id+'">Annuleren</button>'))+'</div></div>';
    });
    h+='</div></div>';
    return h;
  }

  // ── Video's-tab ──
  function catLabel(c){var m={yoga:'Yoga',mindfulness:'Mindfulness',pilates:'Pilates'};return m[c]||c;}
  var VIDCATS=[['yoga','Yoga'],['mindfulness','Mindfulness'],['pilates','Pilates']];
  function planFor(cat){return ((S.videoPlans||[]).filter(function(p){return p.category===cat;})[0])||null;}
  function vidAccess(cat){return ((S.videoAccess||[]).filter(function(a){return a&&a.category===cat;})[0])||null;}
  // Which program-week is unlocked for a subscriber, counting from their start date (week 1 = day 0).
  function weeksSince(startYmd){if(!startYmd)return 1;var t=new Date(startYmd+'T00:00:00').getTime();if(isNaN(t))return 1;var w=Math.floor((Date.now()-t)/(7*86400000))+1;return w<1?1:w;}
  // The date a given week unlocks for a subscriber who started on startYmd.
  function unlockYmd(startYmd,wk){var base=startYmd?new Date(startYmd+'T00:00:00').getTime():Date.now();return ymd(new Date(base+((wk-1)*7*86400000)));}
  // Embed a video link: YouTube/Vimeo → iframe; direct file → <video>; else a link.
  function videoEmbed(url){var u=String(url||'');
    var yt=u.match(/(?:youtube\\.com\\/(?:watch\\?v=|embed\\/)|youtu\\.be\\/)([\\w-]{6,})/);
    if(yt)return '<iframe src="https://www.youtube.com/embed/'+yt[1]+'" style="width:100%;aspect-ratio:16/9;border:0;border-radius:12px" allowfullscreen allow="accelerometer;encrypted-media;picture-in-picture"></iframe>';
    var vm=u.match(/vimeo\\.com\\/(\\d+)/);
    if(vm)return '<iframe src="https://player.vimeo.com/video/'+vm[1]+'" style="width:100%;aspect-ratio:16/9;border:0;border-radius:12px" allowfullscreen></iframe>';
    if(/\\.(mp4|webm|ogg|mov)(\\?|$)/i.test(u))return '<video controls src="'+esc(u)+'" style="width:100%;aspect-ratio:16/9;border-radius:12px;background:#000"></video>';
    return '<a href="'+esc(u)+'" target="_blank" rel="noopener" style="color:var(--ba);font-weight:600">Video openen ↗</a>';
  }
  function pVideos(){
    var isStaff=S.session&&(S.session.role==='admin'||S.session.role==='teacher');
    var vids=(S.videos||[]).filter(function(v){return v.category===videoCat;});
    var tabs=VIDCATS.map(function(c){return '<button class="ba-btn '+(c[0]===videoCat?'':'ghost ')+'sm" data-act="vidcat" data-c="'+c[0]+'">'+c[1]+'</button>';}).join(' ');
    var h='<div class="ba-row" style="gap:8px;margin-bottom:14px;justify-content:flex-start;flex-wrap:wrap">'+tabs+'</div>';
    var plan=planFor(videoCat);
    var acc=vidAccess(videoCat);
    var hasAccess=isStaff||!!acc;
    var curWeek=acc?weeksSince(acc.startedAt):0; // ontgrendelde week voor deze abonnee (staf ziet alles)
    var gated=plan&&plan.price>0&&!hasAccess; // betaalde categorie + geen toegang → afgeschermd
    if(plan&&plan.price>0){
      h+='<div class="ba-card" style="margin-bottom:14px"><div class="ba-row"><div><b>Abonnement '+esc(catLabel(videoCat))+'</b><div class="ba-meta" style="margin:0">Toegang tot alle '+esc(catLabel(videoCat))+'-videos</div></div><span class="ba-badge ok">&euro;'+plan.price+' /maand</span></div>'+
        (hasAccess?(isStaff?'':'<div style="margin-top:8px"><span class="ba-note" style="color:#15803d">&#10003; Je bent geabonneerd (loopt maandelijks door).</span> <button class="ba-btn ghost sm" data-act="cancelvideo" data-c="'+videoCat+'">Opzeggen</button></div>'):'<div style="margin-top:10px"><button class="ba-btn sm" data-act="subvideo" data-c="'+videoCat+'">Abonneer je &mdash; &euro;'+plan.price+'/maand</button></div>')+'</div>';
    }
    var sorted=vids.slice().sort(function(a,b){return ((a.weekNo||1)-(b.weekNo||1))||(a.id-b.id);});
    h+='<div class="ba-grid">';
    if(!vids.length)h+='<p class="ba-meta">Nog geen videos in deze categorie.</p>';
    else if(gated)h+='<div class="ba-card"><p class="ba-meta" style="margin:0">&#128274; '+vids.length+' video(s) in deze categorie. Abonneer je hierboven om ze te bekijken.</p></div>';
    else sorted.forEach(function(v){var wk=v.weekNo||1;var badge='<span class="ba-badge">Week '+wk+'</span>';
      if(isStaff){h+='<div class="ba-card"><div class="ba-row" style="margin-bottom:8px"><h4 style="margin:0">'+esc(v.title)+' '+badge+'</h4><button class="ba-btn ghost sm" data-act="delvideo" data-v="'+v.id+'">Verwijderen</button></div>'+videoEmbed(v.url)+'</div>';return;}
      if(wk<=curWeek){h+='<div class="ba-card"><div class="ba-row" style="margin-bottom:8px"><h4 style="margin:0">'+esc(v.title)+' '+badge+'</h4></div>'+videoEmbed(v.url)+'</div>';}
      else h+='<div class="ba-card"><div class="ba-row"><div><b>'+esc(v.title)+'</b> '+badge+'<div class="ba-meta" style="margin:2px 0 0">&#128274; Beschikbaar vanaf '+fmtDate(unlockYmd(acc.startedAt,wk))+'</div></div></div></div>';
    });
    h+='</div>';
    if(isStaff){
      h+='<div class="ba-card" style="margin-top:16px"><h4>Video toevoegen ('+esc(catLabel(videoCat))+')</h4>'+
        '<label class="ba-f">Titel</label><input id="ba-vt" placeholder="bijv. Ochtend-flow 20 min">'+
        '<label class="ba-f">Video-link (YouTube, Vimeo of MP4-URL)</label><input id="ba-vu" placeholder="https://youtu.be/...">'+
        '<label class="ba-f">Week (ontgrendelt deze week ná de startdatum van de abonnee)</label><input id="ba-vw" type="number" min="1" value="1">'+
        '<div style="margin-top:12px"><button class="ba-btn" data-act="addvideo">Toevoegen</button></div>'+
        '<div id="ba-vid-out" class="ba-note" style="margin-top:8px"></div></div>';
      h+='<div class="ba-card" style="margin-top:16px"><h4>Abonnementsprijs '+esc(catLabel(videoCat))+'</h4>'+
        '<p class="ba-meta">Wat kost toegang tot alle '+esc(catLabel(videoCat))+'-videos per maand?</p>'+
        '<label class="ba-f">Prijs (&euro; /maand)</label><input id="ba-vp" type="number" step="0.01" value="'+((plan&&plan.price)||0)+'">'+
        '<p class="ba-note" style="margin:6px 0 0">Het abonnement loopt automatisch maandelijks door tot de klant zelf opzegt.</p>'+
        '<div style="margin-top:12px"><button class="ba-btn sm" data-act="savevideoplan">Opslaan</button></div>'+
        '<div id="ba-vplan-out" class="ba-note" style="margin-top:8px"></div></div>';
    }
    return h;
  }
  // Client-only "Abonnementen" tab: lijst van lopende (maandelijkse) abonnementen met opzeg-knop.
  function pSubs(){
    var subs=S.mySubs||[];
    var h='<div class="ba-row" style="margin-bottom:14px"><div class="ba-meta" style="margin:0">Je lopende abonnementen \\u2014 hier zeg je ze op.</div></div>';
    if(!subs.length)return h+'<p class="ba-meta">Je hebt geen lopende abonnementen.</p>';
    h+='<div class="ba-list">';
    subs.forEach(function(s){
      if(s.kind==='video')h+='<div class="ba-item"><div class="ba-row"><div><b>Videos: '+esc(catLabel(s.category))+'</b><div class="ba-meta" style="margin:0">Maandelijks abonnement'+(s.validUntil?(' \\u00b7 geldig t/m '+esc(s.validUntil)):'')+'</div></div><button class="ba-btn warn sm" data-act="cancelvideo" data-c="'+esc(s.category)+'">Opzeggen</button></div></div>';
      else if(s.kind==='membership'){
        var mlocked=s.commitUntil&&s.commitUntil>ymd(new Date());
        var mbtn=mlocked?'<button class="ba-btn ghost sm" disabled title="Je zit nog vast aan je contract">Vast t/m '+esc(fmtDate(s.commitUntil))+'</button>':'<button class="ba-btn warn sm" data-act="endmembership">Opzeggen</button>';
        h+='<div class="ba-item"><div class="ba-row"><div><b>Lessen: '+esc(s.name||'Abonnement')+'</b><div class="ba-meta" style="margin:0">Lopend abonnement'+(s.validUntil?(' \\u00b7 geldig t/m '+esc(fmtDate(s.validUntil))):'')+(mlocked?(' \\u00b7 vast contract t/m '+esc(fmtDate(s.commitUntil))):'')+'</div></div>'+mbtn+'</div></div>';
      }
      else{
        var locked=s.commitUntil&&s.commitUntil>ymd(new Date());
        var lockTxt=locked?(' \\u00b7 vast contract t/m '+esc(fmtDate(s.commitUntil))):'';
        var btn=locked?'<button class="ba-btn ghost sm" disabled title="Je zit nog vast aan je contract">Vast t/m '+esc(fmtDate(s.commitUntil))+'</button>':'<button class="ba-btn warn sm" data-act="cancelmembership" data-s="'+esc(s.subscription)+'">Opzeggen</button>';
        h+='<div class="ba-item"><div class="ba-row"><div><b>Lessen: '+esc(s.name||'Abonnement')+'</b><div class="ba-meta" style="margin:0">Maandelijks abonnement'+lockTxt+'</div></div>'+btn+'</div></div>';
      }
    });
    return h+'</div>';
  }
  // Admin-only statistieken: omzet + bezetting, berekend uit de al-geladen data (S).
  function pStats(){
    var nowM=ymd(new Date()).slice(0,7),today=ymd(new Date());
    var purch=S.purchases||[],bookings=S.bookings||[],classes=S.classes||[],counts=S.counts||{};
    var clients=(S.accounts||[]).filter(function(a){return a.role==='client';});
    var revTotal=0,revMonth=0,byType={};
    purch.forEach(function(p){if(p.refunded)return;var amt=p.amount||0;revTotal+=amt;if((p.date||'').slice(0,7)===nowM)revMonth+=amt;var t=p.type||'overig';byType[t]=(byType[t]||0)+amt;});
    bookings.forEach(function(b){if(b.payment==='stripe'&&b.amount&&!b.refunded){revTotal+=b.amount;if((b.date||'').slice(0,7)===nowM)revMonth+=b.amount;byType['losse les']=(byType['losse les']||0)+b.amount;}});
    var booked=bookings.filter(function(b){return b.status==='booked';});
    var upcoming=booked.filter(function(b){return (b.date||'')>=today;});
    var bookedMonth=booked.filter(function(b){return (b.date||'').slice(0,7)===nowM;});
    var capSum=0,bookSum=0;
    classes.forEach(function(c){if((c.date||'')>=today){capSum+=(c.cap||0);var k=c.id+'|'+c.date;bookSum+=(counts[k]&&counts[k].booked)||0;}});
    var occ=capSum>0?Math.round(bookSum/capSum*100):0;
    var noShowMonth=bookings.filter(function(b){return b.noShow&&(b.date||'').slice(0,7)===nowM;}).length;
    var byClass={};booked.forEach(function(b){byClass[b.classId]=(byClass[b.classId]||0)+1;});
    var top=Object.keys(byClass).map(function(id){return {title:classMeta(parseInt(id,10)||id).title,n:byClass[id]};}).sort(function(a,b){return b.n-a.n;}).slice(0,5);
    function eur(n){return '\\u20ac'+(Math.round(n*100)/100).toFixed(2).replace('.',',');}
    function stat(label,val){return '<div class="ba-card" style="text-align:center"><div class="ba-meta" style="margin:0">'+label+'</div><div style="font-size:24px;font-weight:800;margin-top:4px">'+val+'</div></div>';}
    var h='<div class="ba-grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:16px">';
    h+=stat('Omzet totaal',eur(revTotal))+stat('Omzet deze maand',eur(revMonth))+stat('Boekingen deze maand',bookedMonth.length)+stat('Aankomende boekingen',upcoming.length)+stat('Actieve klanten',clients.length)+stat('Gem. bezetting (komend)',occ+'%')+stat('No-shows deze maand',noShowMonth);
    h+='</div>';
    h+='<div class="ba-card"><h4>Omzet per type</h4><div class="ba-list" style="margin-top:8px">';
    var types=Object.keys(byType);if(!types.length)h+='<p class="ba-meta">Nog geen omzet.</p>';
    types.forEach(function(t){h+='<div class="ba-item"><div class="ba-row"><span>'+esc(t)+'</span><b>'+eur(byType[t])+'</b></div></div>';});
    h+='</div></div>';
    h+='<div class="ba-card" style="margin-top:16px"><h4>Drukste lessen (op boekingen)</h4><div class="ba-list" style="margin-top:8px">';
    if(!top.length)h+='<p class="ba-meta">Nog geen boekingen.</p>';
    top.forEach(function(t){h+='<div class="ba-item"><div class="ba-row"><span>'+esc(t.title)+'</span><span class="ba-badge ok">'+t.n+' boekingen</span></div></div>';});
    return h+'</div></div>';
  }
  var PANELS={boeken:pBoeken,agenda:pMijnAgenda,dashboard:pClientDash,studio:pStudio,mijn:pMijn,docenten:pDocenten,leden:pLeden,comm:pComm,koppel:pKoppel,videos:pVideos,abos:pSubs,stats:pStats};
  function tabsFor(role){
    if(role==='admin'){var t=[['boeken','Lessen boeken'],['studio','Studio-beheer'],['docenten','Docenten']];if(S.pay.tegoed)t.push(['leden','Lidmaatschappen']);t.push(['stats','Statistieken'],['comm','Communicatie'],['koppel','Integraties']);return t;}
    if(role==='teacher')return [['agenda','Mijn agenda'],['mijn','Mijn lessen'],['boeken','Lessen boeken']];
    var c=[['dashboard','Mijn lessen'],['boeken','Lessen boeken']];if(S.pay.tegoed)c.push(['leden','Mijn strippenkaart']);return c; // client
  }
  function toast(msg){var o=root.querySelector('#ba-comm-out');if(o)o.textContent=msg;}
  function q(id){return root.querySelector('#'+id);}
  function projId(){try{if(window.__BA_PID__)return String(window.__BA_PID__);}catch(e){}var m=(location.pathname||'').match(/projects\\/(\\d+)/);return m?m[1]:'';}
  function api(p){return '/api/projects/'+projId()+'/'+p;}
  // ── Server API (step 3: booking data moves server-side). Only the SESSION TOKEN is kept in
  // localStorage — never accounts/passwords/bookings. These helpers are wired into the UI in 3b. ──
  var SKEY=KEY+'_token';
  function srvToken(){try{return localStorage.getItem(SKEY)||'';}catch(e){return '';}}
  function setSrvToken(t){try{if(t)localStorage.setItem(SKEY,t);else localStorage.removeItem(SKEY);}catch(e){}}
  function sapi(p){return '/api/projects/'+projId()+'/studio/'+p;}
  function sget(p){return fetch(sapi(p),{headers:{'Authorization':'Bearer '+srvToken()}}).then(function(r){return r.json().then(function(d){return{ok:r.ok,status:r.status,d:d};}).catch(function(){return{ok:r.ok,status:r.status,d:{}};});});}
  function spost(p,bodyObj){return fetch(sapi(p),{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+srvToken()},body:JSON.stringify(bodyObj||{})}).then(function(r){return r.json().then(function(d){return{ok:r.ok,status:r.status,d:d};}).catch(function(){return{ok:r.ok,status:r.status,d:{}};});});}
  function sdel(p){return fetch(sapi(p),{method:'DELETE',headers:{'Authorization':'Bearer '+srvToken()}}).then(function(r){return r.json().then(function(d){return{ok:r.ok,status:r.status,d:d};}).catch(function(){return{ok:r.ok,status:r.status,d:{}};});});}
  // Map a server booking/state into the in-memory S object (render functions keep reading S as before).
  function srvBk(b){return {id:b.id,classId:b.classId,date:b.date,bookerEmail:b.bookerEmail,name:b.name,status:b.status,payment:b.payment,usedCredit:!!b.usedCredit,usedMonthly:!!b.usedMonthly,present:!!b.present,noShow:!!b.noShow,amount:b.amount,paymentIntent:b.paymentIntent,refunded:!!b.refunded,refundedAmount:b.refundedAmount};}
  function applyServerState(d){
    if(!d)return;
    S.session=d.user?{email:d.user.email,role:d.user.role,name:d.user.name}:null;
    S.classes=(d.classes||[]).map(function(c){return {id:c.id,title:c.title,teacherEmail:c.teacherEmail,teacher:c.teacher,date:c.date,time:c.time,endTime:c.endTime||'',cap:c.cap,price:c.price,mode:c.mode,level:c.level||'',description:c.description||'',onlineLink:c.onlineLink,onlineInfo:c.onlineInfo,bookDays:c.bookDays,cancelHours:c.cancelHours,locationId:c.locationId||0,recurring:false};});
    S.members=(d.members||[]).map(function(m){return {id:m.id,name:m.name,type:m.type,unlimited:m.unlimited,credits:m.credits,price:m.price,validDays:m.validDays,recurring:m.recurring,commitMonths:m.commitMonths||0,resetMonthly:!!m.resetMonthly};});
    S.counts=d.counts||{};
    S.myBookings=(d.myBookings||[]).map(srvBk);
    S.bookings=(d.bookings||[]).map(srvBk);   // admin/teacher: alle; klant: leeg (privacy → counts gebruikt)
    S.purchases=d.purchases||[];
    S.videos=d.videos||[];
    S.videoPlans=d.videoPlans||[];
    S.videoAccess=d.videoAccess||[];
    S.mySubs=d.mySubs||[];
    S.codes=d.codes||[];
    S.locations=d.locations||[];
    S.settings=d.settings||{ownerReport:'off',reviewUrl:''};
    S.subscribers=d.subscribers||[];
    S.accounts=d.users?d.users.map(function(u){return {role:u.role,name:u.name,email:u.email,phone:u.phone};}):(d.user?[{role:d.user.role,name:d.user.name,email:d.user.email,phone:d.user.phone}]:[]);
    S.wallets={};
    if(d.user&&d.wallet){var nowM=ymd(new Date()).slice(0,7);S.wallets[d.user.email]={credits:d.wallet.credits||0,membership:d.wallet.membership||null,unlimited:!!d.wallet.unlimited,monthly:(d.wallet.monthlyLimit!=null?{limit:d.wallet.monthlyLimit,remaining:d.wallet.monthlyRemaining,period:nowM}:null),validUntil:d.wallet.validUntil||null,creditsUntil:d.wallet.creditsUntil||null,creditLots:d.wallet.creditLots||[],needsPayment:!!d.wallet.needsPayment};}
  }
  // After a server mutation: re-fetch the snapshot and re-render. 401 → session expired → back to login.
  function refreshAndRender(){return sget('state').then(function(r){if(r.status===401){S.session=null;setSrvToken('');}else if(r.ok)applyServerState(r.d);render();});}
  // Public (no-login) week agenda: load just the schedule + counts + locations, then render the browse view.
  function loadPublic(){if(!projId())return;
    fetch(api('studio/public')).then(function(r){return r.json();}).then(function(d){
      if(!d||d.error)return;
      S.classes=(d.classes||[]).map(function(c){return {id:c.id,title:c.title,teacherEmail:c.teacherEmail,teacher:c.teacher,date:c.date,time:c.time,endTime:c.endTime||'',cap:c.cap,price:c.price,mode:c.mode,level:c.level||'',description:c.description||'',onlineLink:'',onlineInfo:'',bookDays:c.bookDays,cancelHours:c.cancelHours,locationId:c.locationId||0,recurring:false};});
      S.counts=d.counts||{};S.locations=d.locations||[];
      if(!S.session&&authView==='browse')render();
    }).catch(function(){});
  }
  // Re-render the right surface: the app host when logged in, the whole screen in public browse mode.
  function rerender(){if(S.session)renderHost();else render();}
  // Fire-and-forget transactional e-mail (booking/cancel/welcome). Server schedules the 24h
  // reminder for bookings and cancels it on cancel. No-op server-side if SMTP isn't configured.
  function notify(type,to,d){try{if(!to||!projId())return;d=d||{};
    fetch(api('notify'),{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({type:type,to:to,name:d.name||'',studio:(BAKED&&BAKED.title)||'',classTitle:d.classTitle||'',date:d.date||'',time:d.time||'',bookingId:d.bookingId||'',password:d.password||'',mode:d.mode||'',onlineLink:d.onlineLink||'',onlineInfo:d.onlineInfo||''})}).catch(function(){});}catch(e){}}
  // Fire-and-forget: generate an invoice + payment-confirmation e-mail for a Stripe payment.
  function genInvoice(p){try{if(!projId())return;fetch(api('invoice'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(p)}).catch(function(){});}catch(e){}}
  // Push the current lessons to the server so the subscribed calendar feed (.ics) stays up to date.
  function syncCalendar(){try{if(!projId())return;
    var ls=(S.classes||[]).filter(function(c){return c.date;}).map(function(c){return {id:c.id,title:c.title,date:c.date,time:c.time,endTime:c.endTime||'',mode:c.mode||'fysiek',onlineLink:c.onlineLink||'',onlineInfo:c.onlineInfo||'',teacher:c.teacher||''};});
    fetch(api('calendar/sync'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({lessons:ls})}).catch(function(){});}catch(e){}}
  // Look up a class by id → {title,time} for e-mail content.
  function classMeta(cid){var c=(S.classes||[]).filter(function(x){return x.id===cid;})[0];return c?{title:c.title||'les',time:c.time||'',mode:c.mode||'fysiek',link:c.onlineLink||'',info:c.onlineInfo||''}:{title:'les',time:'',mode:'fysiek',link:'',info:''};}
  // Real Stripe refund (to the customer's bank/card). done(ok, data).
  function refund(payload,done){fetch(api('stripe/refund'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})
    .then(function(r){return r.json().then(function(d){return{ok:r.ok,d:d};});})
    .then(function(x){done(x.ok&&x.d&&x.d.ok,x.d||{});}).catch(function(){done(false,{});});}
  function refreshStripeStatus(){var b=root.querySelector('#ba-stripe-badge');if(!b||!projId())return;
    var ex=root.querySelector('#ba-stripe-extra');
    fetch(api('stripe/status')).then(function(r){return r.json();}).then(function(d){
      if(d.connected&&d.chargesEnabled){b.textContent='gekoppeld';b.className='ba-badge ok';}
      else if(d.connected){b.textContent='onboarding afronden';b.className='ba-badge';}
      else{b.textContent='niet gekoppeld';b.className='ba-badge';}
      // Gekoppeld → toon een 1-klik-link naar het eigen Stripe-dashboard (saldo, uitbetalingen, betalingen).
      if(ex&&d.connected){
        var h='<button class="ba-btn sm" data-act="stripe-dashboard">Open Stripe-dashboard ↗</button> <span class="ba-note" style="margin:0">— bekijk je saldo &amp; uitbetalingen</span>';
        if(d.requirementsDue&&d.requirementsDue.length){
          h+='<div class="ba-note" style="margin-top:8px;color:#b45309">⚠ Uitbetalingen zijn geblokkeerd: Stripe mist nog gegevens (bijv. verificatie of bankrekening). Open je Stripe-dashboard en vul dit aan — daarna wordt je saldo uitbetaald.</div>';
        } else if(!d.payoutsEnabled){
          h+='<div class="ba-note" style="margin-top:8px;color:#b45309">⚠ Uitbetalingen staan nog niet aan. Rond de verificatie af in je Stripe-dashboard.</div>';
        } else {
          h+='<div class="ba-note" style="margin-top:8px;color:#15803d">✓ Uitbetalingen staan aan. Let op: Stripe houdt de <b>allereerste</b> uitbetaling van een nieuw account standaard ~7 werkdagen vast; daarna gaat het automatisch (dagelijks/rolling).</div>';
        }
        ex.innerHTML=h;
      }
    }).catch(function(){b.textContent='—';});}
  function refreshGcalStatus(){var b=root.querySelector('#ba-gcal-status');if(!b||!projId())return;
    var ex=root.querySelector('#ba-gcal-extra');
    fetch(api('gcal/status')).then(function(r){return r.json();}).then(function(d){
      if(!d.configured){b.textContent='niet beschikbaar';b.className='ba-badge';if(ex)ex.textContent='Google Agenda is nog niet ingesteld door het platform.';return;}
      if(d.connected){b.textContent='gekoppeld';b.className='ba-badge ok';if(ex)ex.textContent=d.email?('Gekoppeld als '+d.email+'. Lessen synchroniseren direct.'):'Lessen synchroniseren direct.';}
      else{b.textContent='niet gekoppeld';b.className='ba-badge';if(ex)ex.textContent='';}
    }).catch(function(){b.textContent='—';});}

  // ---------- screens ----------
  // Landing page shown first: site logo + welcome + a "Begin hier" button → login.
  function vHome(){
    var bg=!!(BAKED&&BAKED.bg);
    // Always a nice background: the site's image when available, else an accent-colour gradient.
    var heroClass=bg?'ba-hero':'ba-hero-grad';
    var logo=(BAKED&&BAKED.logo)?'<img src="'+BAKED.logo+'" alt="logo" style="max-height:150px;max-width:360px;object-fit:contain;display:block;margin:0 auto 28px;filter:drop-shadow(0 2px 12px rgba(0,0,0,.35))">':'';
    var studio=(BAKED&&BAKED.studio)?esc(BAKED.studio):'onze studio';
    var sh='text-shadow:0 2px 14px rgba(0,0,0,.45)';
    return '<div class="'+heroClass+'" style="position:fixed;inset:0;z-index:5;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:24px;color:#fff">'+logo+
      '<h1 style="font-size:52px;font-weight:800;margin:0 0 12px;line-height:1.08;max-width:900px;'+sh+'">Welcome to our booking system</h1>'+
      '<p style="font-size:22px;margin:0 0 34px;opacity:.95;'+sh+'">Easily book your classes at '+studio+'.</p>'+
      '<button class="ba-btn" data-act="begin" style="padding:17px 46px;font-size:19px;border-radius:14px">Get started</button></div>';
  }
  // Public, read-only week agenda — a visitor sees the schedule before logging in. Booking any class
  // (or other actions) prompts login/registration. Data comes from the public (no-auth) endpoint.
  function vBrowse(){
    var studio=(BAKED&&BAKED.studio)?esc(BAKED.studio):'onze studio';
    var logo=(BAKED&&BAKED.logo)?'<img src="'+BAKED.logo+'" alt="logo" style="max-height:64px;max-width:220px;object-fit:contain;display:block;margin:0 auto 22px;filter:drop-shadow(0 2px 12px rgba(0,0,0,.4))">':'';
    var _open=(!S.classes||!S.classes.length)||S.classes.some(function(c){return ((S.counts&&S.counts[c.id])||0)<(c.cap||0);});
    var statusHtml=_open?'<span class="ba-status"><span class="sd"></span><span><span class="sl">Status</span>Open voor boekingen</span></span>':'<span class="ba-status full"><span class="sd"></span><span><span class="sl">Status</span>Alles vol</span></span>';
    return ''+
      '<section class="ba-hero2">'+logo+
        '<div class="eyebrow2">Boekingen \u00b7 '+studio+'</div>'+
        '<h1>Boek je plek.</h1>'+
        '<p class="sub2">Bekijk het rooster en reserveer eenvoudig je les bij '+studio+'.</p>'+
        '<div class="cta2">'+statusHtml+'</div>'+'<div class="ba-clock" id="ba-clock"></div>'+
        '<a class="ba-scrolldown" href="#ba-agenda"><span>Rooster</span><span class="dot">\u2193</span></a>'+
      '</section>'+
      '<section id="ba-agenda" class="ba-section ba-rv">'+
        '<div class="ba-secnum">01 / Rooster</div><div class="ba-section-h">Bekijk het rooster.</div>'+
        '<div class="ba-note" style="background:rgba(200,184,154,.10);border:1px solid rgba(200,184,154,.3);color:#e6d9bf;padding:11px 13px;border-radius:10px;margin-bottom:16px">Bekijk hieronder het rooster. Om een les te boeken log je in of maak je een account aan.</div>'+
        pBoeken()+
      '</section>'+
      '<section id="ba-login" class="ba-section ba-rv">'+
        '<div class="ba-secnum">02 / Toegang</div><div class="ba-section-h">Log in of maak een account.</div>'+
        '<div class="ba-card ba-island" style="max-width:440px;margin:0 auto">'+
          '<div class="ba-segt"><button class="ba-seg is-on" id="ba-seg-l" data-act="segl">Inloggen</button><button class="ba-seg" id="ba-seg-r" data-act="segr">Registreren</button></div>'+
          '<div id="ba-login-form"><label class="ba-f">E-mailadres</label><input id="lg-e" type="email" placeholder="naam@voorbeeld.nl">'+
          '<label class="ba-f">Wachtwoord</label><input id="lg-p" type="password">'+
          '<div style="margin-top:14px"><button class="ba-btn" data-act="login">Inloggen</button></div>'+
          '<div id="lg-err" class="ba-note" style="color:#f87171"></div>'+
          '<p class="ba-note" style="margin-top:10px"><a href="#" data-act="goreset" style="color:var(--ba);font-weight:600">Wachtwoord vergeten?</a></p></div>'+
          '<div id="ba-reg-form" style="display:none"><label class="ba-f">Naam</label><input id="rg-n" placeholder="Voor- en achternaam">'+
          '<label class="ba-f">E-mailadres</label><input id="rg-e" type="email" placeholder="naam@voorbeeld.nl">'+
          '<label class="ba-f">Telefoonnummer</label><input id="rg-tel" type="tel" placeholder="06 12345678">'+
          '<label class="ba-f">Wachtwoord</label><input id="rg-p" type="password">'+
          '<div style="margin-top:14px"><button class="ba-btn" data-act="register">Account aanmaken</button></div>'+
          '<div id="rg-err" class="ba-note" style="color:#f87171"></div></div>'+
        '</div>'+
      '</section>';
  }
  // Plain login — what everyone (incl. customers) sees. No role labels are shown here.
  // Customers can self-register a (client) account right here.
  function vAuth(){
    if(authView==='home')return vHome();
    if(authView==='browse')return vBrowse();
    if(authView==='register'){
      var act=getAct();
      var banner=act?'<div class="ba-note" style="background:#ecfdf5;border:1px solid #a7f3d0;color:#065f46;padding:10px 12px;border-radius:8px;margin-bottom:12px">Je gegevens zijn gevonden. Maak een wachtwoord aan om je strippenkaart/abonnement te activeren.</div>':'';
      return '<div class="ba-auth"><div class="ba-row" style="justify-content:flex-end;margin-bottom:4px">'+langSelect()+'</div><h2>Account aanmaken</h2><p class="ba-meta">Maak een account om lessen te boeken.</p>'+
        '<div class="ba-card" style="max-width:400px">'+banner+'<label class="ba-f">Naam</label><input id="rg-n" placeholder="Voor- en achternaam" value="'+esc((act&&act.name)||'')+'">'+
        '<label class="ba-f">E-mailadres</label><input id="rg-e" type="email" placeholder="naam@voorbeeld.nl" value="'+esc((act&&act.email)||'')+'"'+(act&&act.email?' readonly style="background:#f3f4f6"':'')+'>'+
        '<label class="ba-f">Telefoonnummer</label><input id="rg-tel" type="tel" placeholder="06 12345678" value="'+esc((act&&act.phone)||'')+'">'+
        '<label class="ba-f">Wachtwoord</label><input id="rg-p" type="password">'+
        '<div style="margin-top:14px"><button class="ba-btn" data-act="register">Account aanmaken</button></div>'+
        '<div id="rg-err" class="ba-note" style="color:#b91c1c"></div>'+
        '<p class="ba-note" style="margin-top:12px">Al een account? <a href="#" data-act="gologin" style="color:var(--ba);font-weight:600">Inloggen</a></p></div></div>';
    }
    if(authView==='reset'){
      return '<div class="ba-auth"><h2>Wachtwoord vergeten</h2><p class="ba-meta">Vul je e-mailadres in; we sturen je een nieuw wachtwoord.</p>'+
        '<div class="ba-card" style="max-width:400px"><label class="ba-f">E-mailadres</label><input id="rs-e" type="email" placeholder="naam@voorbeeld.nl">'+
        '<div style="margin-top:14px"><button class="ba-btn" data-act="dorestpw">Nieuw wachtwoord sturen</button></div>'+
        '<div id="rs-out" class="ba-note" style="margin-top:10px"></div>'+
        '<p class="ba-note" style="margin-top:12px"><a href="#" data-act="gologin" style="color:var(--ba);font-weight:600">← Terug naar inloggen</a></p></div></div>';
    }
    var noStaff=!S.accounts.some(function(a){return a.role==='admin'||a.role==='teacher';});
    var actBanner=activationMsg?'<div class="ba-note" style="background:#ecfdf5;border:1px solid #a7f3d0;color:#065f46;padding:10px 12px;border-radius:8px;margin-bottom:12px">'+esc(activationMsg)+'</div>':'';
    return '<div class="ba-auth"><div class="ba-row" style="justify-content:flex-end;margin-bottom:4px">'+langSelect()+'</div><h2>Inloggen</h2><p class="ba-meta">Log in om verder te gaan.</p>'+
      '<div class="ba-card" style="max-width:400px">'+actBanner+'<label class="ba-f">E-mailadres</label><input id="lg-e" type="email" placeholder="naam@voorbeeld.nl" value="'+esc(activationEmail||'')+'">'+
      '<label class="ba-f">Wachtwoord</label><input id="lg-p" type="password">'+
      '<div style="margin-top:14px"><button class="ba-btn" data-act="login">Inloggen</button></div>'+
      '<div id="lg-err" class="ba-note" style="color:#b91c1c"></div>'+
      '<p class="ba-note" style="margin-top:10px"><a href="#" data-act="goreset" style="color:var(--ba);font-weight:600">Wachtwoord vergeten?</a></p>'+
      (noStaff?'<p class="ba-note" style="margin-top:12px">De studio stelt de beheerder- en docent-logins in. Klant? Maak hieronder een account aan.</p>':'')+
      '<p class="ba-note" style="margin-top:12px">Nog geen account? <a href="#" data-act="goregister" style="color:var(--ba);font-weight:600">Registreren</a> · <a href="#" data-act="gohome" style="color:#9ca3af">← Terug</a></p></div></div>';
  }
  function vApp(){
    var u=S.session,tabs=tabsFor(u.role);
    if(!tabs.some(function(t){return t[0]===activeTab;}))activeTab=tabs[0][0];
    var tb=tabs.map(function(t){return '<button class="ba-tab'+(t[0]===activeTab?' is-on':'')+'" data-tab="'+t[0]+'">'+t[1]+'</button>';}).join('');
    var studio=(BAKED&&BAKED.studio)?esc(BAKED.studio):'onze studio';
    var first=esc((u.name||'').split(' ')[0]||u.name||'');
    return '<section class="ba-hero2 sm"><div class="eyebrow2">'+studio+' \u00b7 Overzicht</div><h1>Welkom terug, '+first+'.</h1></section>'+
      '<div class="ba-row" style="margin:6px 0 14px"><div class="ba-meta" style="margin:0">Ingelogd als '+esc(u.name)+'</div><div class="ba-row" style="gap:8px">'+langSelect()+'<button class="ba-btn ghost sm" data-act="logout">Uitloggen</button></div></div>'+
      '<div class="ba-tabs">'+tb+'</div><div class="ba-host"></div>';
  }
  function renderHost(){var host=root.querySelector('.ba-host');if(host){var u=S.session;if(u){var tabs=tabsFor(u.role);host.innerHTML=tabs.map(function(t,i){var num=('0'+(i+1)).slice(-2);return '<section id="ba-sec-'+t[0]+'" class="ba-appsec"><div class="ba-secnum">'+num+' / '+t[1]+'</div>'+((PANELS[t[0]]||pBoeken)())+'</section>';}).join('');refreshStripeStatus();refreshGcalStatus();refreshInvoiceSettings();refreshImportStatus();refreshEmailStatus();refreshInvoices();translateDOM(host);}}renderAttModal();renderInfoModal();}
  function render(){
    initI18n();
    var sc=!S.session?'login':'app';
    ['login','app'].forEach(function(name){
      var el=root.querySelector('[data-screen="'+name+'"]');if(!el)return;
      el.style.display=name===sc?'':'none';
      if(name===sc)el.innerHTML=name==='login'?vAuth():vApp();
    });
    if(sc==='app')renderHost();
    translateDOM(root);
  }

  // ---------- events ----------
  root.addEventListener('change',function(e){
    var tg=e.target;
    // Payment choice changes the action button: Stripe => "Kopen" (pay per class), else "Boeken".
    if(tg.classList&&tg.classList.contains('ba-pay')){
      var row=tg.closest('.ba-row');var bb=row&&row.querySelector('[data-act="book"]');
      if(bb)bb.textContent=tr((tg.value==='stripe')?'Kopen':'Boeken');
      return;
    }
    var a=tg.closest&&tg.closest('[data-act]');if(!a)return;
    var act=a.getAttribute('data-act');
    if(act==='setlang'){lang=a.value;setLangPref(lang);applyDateLang();render();return;}
    if(act==='setbookloc'){bookLoc=a.value;rerender();return;}
    if(act==='invperiod'){updateInvPeriod();return;}
    if(act==='payparam'){var pm=q('ba-pay-period'),rt=q('ba-pay-rate');var pmM=pm?(parseInt(pm.value,10)||12):12;var pmR=rt?Math.max(0,parseFloat(rt.value)||0):0;var pdl=q('ba-pay-dl');if(pdl)pdl.setAttribute('href',api('teacher-payout?months='+pmM+'&rate='+pmR));return;}
    if(act==='setownerreport'){if(!S.settings)S.settings={};S.settings.ownerReport=a.value;spost('settings',{ownerReport:a.value}).then(function(r){if(!r.ok)alert((r.d&&r.d.error)||'Opslaan mislukt.');});return;}
    if(act==='moveto'){
      var bid=a.getAttribute('data-b'),parts=a.value.split('|');
      var bk=S.bookings.filter(function(b){return b.id===bid;})[0];
      if(bk){bk.classId=parts[0];bk.date=parts[1];save();renderHost();}
    } else if(act==='classprice'){
      var c=S.classes.filter(function(x){return x.id===a.getAttribute('data-c');})[0];
      if(c){c.price=Math.max(0,parseFloat(a.value)||0);save();renderHost();}
    } else if(act==='memberprice'){
      var m=S.members.filter(function(x){return x.id===a.getAttribute('data-m');})[0];
      if(m){m.price=Math.max(0,parseFloat(a.value)||0);save();renderHost();}
    } else if(act==='inv-country'){
      applyInvoiceCountry(a.value,true); // wissel land → labels + standaard belastingtarief
    }
  });
  root.addEventListener('click',function(e){
    var t=e.target.closest('[data-tab]');
    if(t){activeTab=t.getAttribute('data-tab');var _a=root.querySelectorAll('.ba-tab');for(var _i=0;_i<_a.length;_i++)_a[_i].classList.toggle('is-on',_a[_i]===t);var _s=document.getElementById('ba-sec-'+activeTab);if(_s)_s.scrollIntoView({behavior:'smooth',block:'start'});return;}
    var a=e.target.closest('[data-act]'); if(!a)return; var act=a.getAttribute('data-act');

    // Les-detail ("meer info") — mag altijd, ook uitgelogd in de publieke agenda.
    if(act==='classinfo'){if(e.preventDefault)e.preventDefault();openInfoModal(a.getAttribute('data-c')+'|'+a.getAttribute('data-d'));return;}

    // Publieke agenda: rooster bekijken mag zonder account, maar boeken/kopen/acties vereisen inloggen.
    if(!S.session&&(act==='book'||act==='wait'||act==='cancel'||act==='buy'||act==='subvideo')){authView='login';render();return;}

    // auth
    if(act==='begin'){authView='browse';loadPublic();render();return;}
    if(act==='gohome'){if(e.preventDefault)e.preventDefault();authView='browse';render();return;}
    if(act==='goregister'){if(e.preventDefault)e.preventDefault();authView='register';render();return;}
    if(act==='gologin'){if(e.preventDefault)e.preventDefault();authView='login';render();return;}
    if(act==='segl'||act==='segr'){var _lf=document.getElementById('ba-login-form'),_rf=document.getElementById('ba-reg-form'),_sl=document.getElementById('ba-seg-l'),_sr=document.getElementById('ba-seg-r');var lg=act==='segl';if(_lf)_lf.style.display=lg?'':'none';if(_rf)_rf.style.display=lg?'none':'';if(_sl)_sl.classList.toggle('is-on',lg);if(_sr)_sr.classList.toggle('is-on',!lg);return;}
    if(act==='goreset'){if(e.preventDefault)e.preventDefault();authView='reset';render();return;}
    if(act==='dorestpw'){if(e.preventDefault)e.preventDefault();
      var rse=(q('rs-e')||{value:''}).value.trim().toLowerCase(),rso=q('rs-out');
      if(!isValidEmail(rse)){if(rso){rso.style.color='#b91c1c';rso.textContent='Vul een geldig e-mailadres in.';}return;}
      if(SRV){spost('reset',{email:rse}).then(function(){if(rso){rso.style.color='#15803d';rso.textContent='Als er een account bij dit e-mailadres hoort, is er een nieuw wachtwoord verstuurd. Check je inbox.';}});return;}
      var acc=S.accounts.filter(function(x){return x.email===rse;})[0];
      if(acc){
        // Genereer een nieuw tijdelijk wachtwoord, sla het op en mail het (echte e-mail via /notify).
        var np=Math.random().toString(36).slice(2,6)+Math.random().toString(36).slice(2,6);
        acc.password=np;save();
        notify('reset',rse,{name:acc.name,password:np});
      }
      // Altijd dezelfde melding (lekt niet of een account bestaat).
      if(rso){rso.style.color='#15803d';rso.textContent='Als er een account bij dit e-mailadres hoort, is er een nieuw wachtwoord verstuurd. Check je inbox.';}
      return;}
    if(act==='register'){var rn=q('rg-n').value.trim(),re=q('rg-e').value.trim().toLowerCase(),rtel=(q('rg-tel')?q('rg-tel').value:'').trim(),rp=q('rg-p').value,rerr=q('rg-err');
      if(!rn||!isValidEmail(re)||!rp){if(rerr)rerr.textContent='Vul je naam, een geldig e-mailadres en een wachtwoord in.';return;}
      if(!rtel||rtel.replace(/[^0-9]/g,'').length<8){if(rerr)rerr.textContent='Vul een geldig telefoonnummer in.';return;}
      if(SRV){spost('register',{name:rn,email:re,phone:rtel,password:rp}).then(function(r){
        if(!r.ok){if(rerr)rerr.textContent=(r.d&&r.d.error)||'Registreren mislukt.';return;}
        setSrvToken(r.d.token);activationMsg='';activationEmail='';authView='login';activeTab='dashboard';refreshAndRender();});return;}
      if(S.accounts.some(function(x){return x.email===re;})){if(rerr)rerr.textContent='Er bestaat al een account met dit e-mailadres.';return;}
      S.accounts.push({role:'client',name:rn,email:re,phone:rtel,password:rp});
      notify('welcome',re,{name:rn});
      var pa=getAct();if(pa&&pa.email===re){applyEntitlements(re,pa.entitlements);clearAct();} // Mindbody tegoed
      activationMsg='';activationEmail='';
      S.session={email:re,role:'client',name:rn};activeTab='dashboard';authView='login';save();render();return;}
    if(act==='login'){var le=q('lg-e').value.trim().toLowerCase(),lp=q('lg-p').value;
      if(SRV){spost('login',{email:le,password:lp}).then(function(r){
        if(!r.ok){var lee=q('lg-err');if(lee)lee.textContent=(r.d&&r.d.error)||'Inloggen mislukt.';return;}
        setSrvToken(r.d.token);activationMsg='';activationEmail='';
        activeTab=r.d.user.role==='admin'?'boeken':r.d.user.role==='teacher'?'agenda':'dashboard';refreshAndRender();});return;}
      var acc=S.accounts.filter(function(x){return x.email===le&&x.password===lp;})[0];
      if(!acc){var le2=q('lg-err');if(le2)le2.textContent='Onjuist e-mailadres of wachtwoord.';return;}
      var pl=getAct();if(pl&&pl.email===acc.email){applyEntitlements(acc.email,pl.entitlements);clearAct();} // Mindbody tegoed
      activationMsg='';activationEmail='';
      S.session={email:acc.email,role:acc.role,name:acc.name};activeTab=acc.role==='admin'?'boeken':acc.role==='teacher'?'agenda':'dashboard';save();render();return;}
    if(act==='logout'){if(SRV){spost('logout',{}).catch(function(){});setSrvToken('');S.session=null;authView='browse';render();return;}S.session=null;authView='browse';save();render();return;}

    // teacher management (admin)
    if(act==='addteacher'){var n=q('dz-n').value.trim(),em=q('dz-e').value.trim().toLowerCase(),pw=q('dz-p').value,de=q('dz-err');
      if(!n||!isValidEmail(em)||!pw){if(de)de.textContent='Vul naam, geldig e-mail en wachtwoord in.';return;}
      if(SRV){spost('seed-staff',{accounts:[{role:'teacher',name:n,email:em,password:pw}]}).then(function(r){
        if(!r.ok){if(de)de.textContent=(r.d&&r.d.error)||'Toevoegen mislukt.';return;}
        if((r.d&&r.d.created)===0){if(de)de.textContent='Dit e-mailadres bestaat al.';return;}refreshAndRender();});return;}
      if(S.accounts.some(function(x){return x.email===em;})){if(de)de.textContent='Dit e-mailadres bestaat al.';return;}
      S.accounts.push({role:'teacher',name:n,email:em,password:pw});save();renderHost();return;}
    if(act==='delacc'){var dem=a.getAttribute('data-e');
      if(dem===((S.session&&S.session.email)||'')){alert('Je kunt het account waarop je nu bent ingelogd niet verwijderen.');return;}
      if(SRV){alert('Accounts verwijderen koppelen we binnenkort aan de server.');return;}
      S.accounts=S.accounts.filter(function(x){return x.email!==dem;});save();renderHost();return;}

    // agenda week navigation
    if(act==='weekprev'){if(agendaWeek>0)agendaWeek--;rerender();return;}
    if(act==='weeknext'){agendaWeek++;rerender();return;}

    // booking
    if(act==='book'||act==='wait'){
      var cid=a.getAttribute('data-c'),date=a.getAttribute('data-d');
      var clsW=S.classes.filter(function(c){return c.id==cid;})[0]||{};
      if(bookTooEarly(clsW,date)){alert('Boeken kan pas vanaf '+fmtDate(bookOpensOn(clsW,date))+' ('+clsW.bookDays+' dagen voor de les).');return;}
      var sel=root.querySelector('.ba-pay[data-c="'+cid+'"][data-d="'+date+'"]');var pay=sel?sel.value:(S.pay.tegoed?'tegoed':'stripe');
      if(SRV){
        if(act==='book'&&pay==='stripe'){
          if(!clsW.price||clsW.price<0.5){alert('Deze les heeft nog geen prijs. De studio stelt die in bij Studio-beheer.');return;}
          payViaStripe('les',clsW.title,clsW.price,{kind:'book',classId:cid,date:date}); // afronden via /studio/stripe/finalize bij terugkeer
          return;
        }
        spost('book',{classId:cid,date:date,waitlist:(act==='wait'),payment:'tegoed'}).then(function(r){
          if(!r.ok){alert((r.d&&r.d.error)||'Boeken mislukt.');return;}refreshAndRender();});
        return;
      }
      if(act==='book'&&pay==='stripe'){
        // Real payment via Stripe Checkout; the booking is created on return (?betaald=1).
        var cls=S.classes.filter(function(c){return c.id===cid;})[0]||{};
        if(!cls.price||cls.price<0.5){alert('Deze les heeft nog geen prijs. De studio stelt die in bij Studio-beheer.');return;}
        payViaStripe('les',cls.title,cls.price,{kind:'book',classId:cid,date:date,name:(S.session&&S.session.name)||'Gast',bookerEmail:myEmail()});
        return;
      }
      var MW=walletFor(myEmail());
      var usedCredit=false,usedMonthly=false;
      if(act==='book'&&pay==='tegoed'){
        var bc=bookingCredit(MW);
        if(!bc.ok){alert(bc.reason);return;}
        if(bc.type==='credit'){MW.credits--;usedCredit=true;}            // strippenkaart: 1 credit eraf
        else if(bc.type==='monthly'){MW.monthly.remaining--;usedMonthly=true;} // X/maand: maandtegoed eraf
        // unlimited abonnement = geen aftrek
      }
      var nb={id:uid(),classId:cid,date:date,name:(S.session&&S.session.name)||'Gast',bookerEmail:myEmail(),status:act==='book'?'booked':'waitlist',payment:pay,usedCredit:usedCredit,usedMonthly:usedMonthly,present:false,noShow:false};
      S.bookings.push(nb);
      if(act==='book'){var cm=classMeta(cid);notify('booking',myEmail(),{name:nb.name,classTitle:cm.title,date:date,time:cm.time,bookingId:nb.id,mode:cm.mode,onlineLink:cm.link,onlineInfo:cm.info});}
      save();renderHost();return;
    }
    if(act==='cancel'){var bid=a.getAttribute('data-b');
      if(SRV){spost('cancel',{bookingId:bid}).then(function(r){if(!r.ok){alert((r.d&&r.d.error)||'Annuleren mislukt.');return;}refreshAndRender();});return;}
      var bk=S.bookings.filter(function(b){return b.id===bid;})[0];
      if(bk){
        // Annuleringsdeadline (alleen voor geboekte lessen; de admin mag altijd annuleren).
        var bcls=S.classes.filter(function(c){return c.id===bk.classId;})[0]||{};
        if(bk.status==='booked'&&cancelClosed(bcls,bk.date)&&!(S.session&&S.session.role==='admin')){alert('Annuleren kan tot '+bcls.cancelHours+' uur voor de les — die termijn is verstreken. Neem contact op met de studio.');return;}
        var wasBooked=bk.status==='booked';
        if(wasBooked&&bk.usedCredit)walletFor(bk.bookerEmail||myEmail()).credits++;
        if(wasBooked&&bk.usedMonthly){var RW=walletFor(bk.bookerEmail||myEmail());if(RW.monthly){ensureMonthlyReset(RW);RW.monthly.remaining=Math.min(RW.monthly.limit,(RW.monthly.remaining||0)+1);}}
        // Keep the record (status 'cancelled') so the admin can see cancellations; it no longer counts.
        bk.status='cancelled';bk.cancelledAt=ymd(new Date());
        notify('cancel',bk.bookerEmail||myEmail(),{name:bk.name,classTitle:classMeta(bk.classId).title,date:bk.date,bookingId:bk.id});
        // A spot opened up → promote the FIRST waitlister and e-mail them automatically.
        if(wasBooked){var w=S.bookings.filter(function(b){return b.classId===bk.classId&&b.date===bk.date&&b.status==='waitlist';})[0];
          if(w){w.status='booked';w.promotedAt=ymd(new Date());var pm=classMeta(w.classId);
            notify('promoted',w.bookerEmail,{name:w.name,classTitle:pm.title,date:w.date,time:pm.time,bookingId:w.id,mode:pm.mode,onlineLink:pm.link,onlineInfo:pm.info});}}
      }
      save();renderHost();return;}
    if(act==='addclass'){
      var title=q('ba-ct').value.trim();if(!title){alert('Geef de les een titel.');return;}
      var cdate=q('ba-cdate')?q('ba-cdate').value:'';if(!cdate){alert('Kies een datum.');return;}
      var temail=q('ba-cte')?q('ba-cte').value:'';
      var cmodeEl=root.querySelector('input[name="ba-cmode"]:checked');var cmode=cmodeEl?cmodeEl.value:'fysiek';
      var clink=(q('ba-clink')?q('ba-clink').value:'').trim(),cinfo=(q('ba-cinfo')?q('ba-cinfo').value:'').trim();
      var cbook=Math.max(0,parseInt(q('ba-cbook')?q('ba-cbook').value:'0',10)||0);
      var ccancel=Math.max(0,parseInt(q('ba-ccancel')?q('ba-ccancel').value:'0',10)||0);
      var ccap=Math.max(1,parseInt(q('ba-cc').value,10)||12),cprice=Math.max(0,parseFloat(q('ba-cp')?q('ba-cp').value:'0')||0),ctime=q('ba-ctm').value||'09:00';
      var cend=q('ba-cend')?(q('ba-cend').value||''):'';
      if(cend&&cend<=ctime){alert('De eindtijd moet ná de begintijd liggen.');return;}
      var cweeks=Math.min(52,Math.max(1,parseInt(q('ba-cweeks')?q('ba-cweeks').value:'1',10)||1));
      var cloc=Math.max(0,parseInt(q('ba-cloc')?q('ba-cloc').value:'0',10)||0);
      var clevel=(q('ba-clevel')?q('ba-clevel').value:'')||'',cdesc=(q('ba-cdesc')?q('ba-cdesc').value:'').trim();
      if(SRV){spost('classes',{title:title,teacherEmail:temail,date:cdate,time:ctime,endTime:cend,cap:ccap,price:cprice,mode:cmode,level:clevel,description:cdesc,onlineLink:clink,onlineInfo:cinfo,bookDays:cbook,cancelHours:ccancel,repeatWeeks:cweeks,locationId:cloc}).then(function(r){
        if(!r.ok){alert((r.d&&r.d.error)||'Les toevoegen mislukt.');return;}refreshAndRender().then(syncCalendar);});return;}
      for(var wi=0;wi<cweeks;wi++){var wd=new Date(cdate+'T00:00:00');wd.setDate(wd.getDate()+wi*7);S.classes.push({id:uid(),title:title,teacherEmail:temail,teacher:accName(temail),date:ymd(wd),time:ctime,endTime:cend,cap:ccap,price:cprice,mode:cmode,level:clevel,description:cdesc,onlineLink:clink,onlineInfo:cinfo,bookDays:cbook,cancelHours:ccancel,locationId:cloc,recurring:false});}
      save();renderHost();syncCalendar();return;}
    if(act==='delclass'){var id=a.getAttribute('data-c');
      if(SRV){sdel('classes/'+id).then(function(r){if(!r.ok){alert((r.d&&r.d.error)||'Verwijderen mislukt.');return;}refreshAndRender().then(syncCalendar);});return;}
      S.classes=S.classes.filter(function(c){return c.id!==id;});save();renderHost();syncCalendar();return;}
    if(act==='att-open'){if(e.preventDefault)e.preventDefault();openAttModal(a.getAttribute('data-k'));return;}
    if(act==='present'){var bid2=a.getAttribute('data-b');
      if(SRV){spost('present',{bookingId:bid2}).then(function(r){if(r.ok)refreshAndRender();});return;}
      var b2=S.bookings.filter(function(b){return b.id===bid2;})[0];if(b2)b2.present=!b2.present;save();renderHost();return;}
    if(act==='noshow'){var bid3=a.getAttribute('data-b');
      if(SRV){spost('noshow',{bookingId:bid3}).then(function(r){if(r.ok)refreshAndRender();});return;}
      var b3=S.bookings.filter(function(b){return b.id===bid3;})[0];if(b3){b3.noShow=!b3.noShow;if(b3.noShow)b3.present=false;}save();renderHost();return;}
    if(act==='buy'){var m=S.members.filter(function(x){return x.id==a.getAttribute('data-m');})[0];if(!m)return;
      // Pay via Stripe; the strippenkaart/abonnement is granted on return (server-mode: /studio/stripe/finalize).
      payWithCode(m.type,m.name,m.price,{kind:'buy',memberId:m.id,bookerEmail:myEmail()});
      return;}
    if(act==='addmember'){var nm=q('ba-mn').value.trim();if(!nm){alert('Geef een naam op.');return;}
      var type=q('ba-mt').value;var lim=q('ba-ml')?q('ba-ml').value:'aantal';var lessons=parseInt(q('ba-mc').value,10)||0;
      var unlimited=(type==='abonnement'&&lim==='onbeperkt');
      var commitMonths=type==='abonnement'&&q('ba-mcommit')?(parseInt(q('ba-mcommit').value,10)||0):0;
      var resetMonthly=q('ba-mreset')?!!q('ba-mreset').checked:false;
      if(SRV){spost('members',{name:nm,type:type,unlimited:unlimited,lim:lim,credits:lessons,price:parseInt(q('ba-mp').value,10)||0,validDays:parseInt(q('ba-mv').value,10)||0,commitMonths:commitMonths,resetMonthly:resetMonthly}).then(function(r){
        if(!r.ok){alert((r.d&&r.d.error)||'Toevoegen mislukt.');return;}refreshAndRender();});return;}
      S.members.push({id:uid(),name:nm,type:type,unlimited:unlimited,credits:unlimited?null:(lessons||(type==='strippenkaart'?10:8)),price:parseInt(q('ba-mp').value,10)||0,validDays:parseInt(q('ba-mv').value,10)||(type==='abonnement'?30:180),recurring:type==='abonnement'});
      save();renderHost();return;}
    if(act==='togglerem'){S.reminders=!S.reminders;save();return;}
    // Stripe terugbetalen — losse les (annuleer + terugstort)
    if(act==='refundbk'){if(SRV){if(!confirm('Deze boeking terugbetalen aan de klant?'))return;a.disabled=true;a.textContent='Bezig…';
        spost('refund-booking',{bookingId:a.getAttribute('data-b')}).then(function(r){if(!r.ok){a.disabled=false;a.textContent='Terugbetalen';alert((r.d&&r.d.error)||'Terugbetalen mislukt.');return;}alert('Terugbetaald: €'+(r.d.amount||0)+'.');refreshAndRender();});return;}
      var rid=a.getAttribute('data-b');var rbk=S.bookings.filter(function(b){return b.id===rid;})[0];
      if(!rbk||!rbk.paymentIntent){alert('Geen Stripe-betaling om terug te storten.');return;}
      if(!confirm('€'+(rbk.amount||0)+' terugbetalen aan '+(rbk.bookerEmail||'de klant')+'?'))return;
      a.disabled=true;a.textContent='Bezig…';
      refund({paymentIntent:rbk.paymentIntent,amount:rbk.amount},function(ok,d){
        if(ok){rbk.refunded=true;rbk.refundedAmount=(d&&d.amount!=null)?d.amount:rbk.amount;
          if(rbk.status==='booked'){rbk.status='cancelled';rbk.cancelledAt=ymd(new Date());notify('cancel',rbk.bookerEmail||myEmail(),{name:rbk.name,classTitle:classMeta(rbk.classId).title,date:rbk.date,bookingId:rbk.id});}
          save();renderHost();alert('Terugbetaald: €'+rbk.refundedAmount+'.');}
        else{a.disabled=false;a.textContent='Terugbetalen';alert((d&&d.error)||'Terugbetalen mislukt.');}});return;}
    // Stripe terugbetalen — strippenkaart (eigen bedrag) of abonnement (opzeggen + terugstort)
    if(act==='refundpur'){if(SRV){var spid=a.getAttribute('data-p');var spu=(S.purchases||[]).filter(function(x){return x.id==spid;})[0];var sbody={purchaseId:spid};
        if(spu&&!(spu.type==='abonnement'&&spu.subscription)){var sinp=q('ba-rf-'+spid);var samt=sinp?parseFloat(sinp.value):(spu?spu.amount:0);if(!(samt>0)){alert('Vul een geldig bedrag in.');return;}sbody.amount=samt;}
        if(!confirm('Terugbetalen aan de klant?'))return;a.disabled=true;a.textContent='Bezig…';
        spost('refund-purchase',sbody).then(function(r){if(!r.ok){a.disabled=false;a.textContent='Terugbetalen';alert((r.d&&r.d.error)||'Terugbetalen mislukt.');return;}alert('Terugbetaald: €'+(r.d.amount||0)+'.');refreshAndRender();});return;}
      var puid=a.getAttribute('data-p');var pu=(S.purchases||[]).filter(function(x){return x.id===puid;})[0];if(!pu)return;
      var payload,amt;
      if(pu.type==='abonnement'&&pu.subscription){if(!confirm('Abonnement opzeggen en de laatste betaling terugstorten?'))return;payload={subscription:pu.subscription};}
      else{if(!pu.paymentIntent){alert('Geen betaling gevonden.');return;}var rinp=q('ba-rf-'+puid);amt=rinp?parseFloat(rinp.value):pu.amount;
        if(!(amt>0)){alert('Vul een geldig bedrag in.');return;}if(amt>pu.amount+0.001){alert('Bedrag is hoger dan betaald (€'+pu.amount+').');return;}
        if(!confirm('€'+amt+' terugbetalen aan '+(pu.email||'de klant')+'?'))return;payload={paymentIntent:pu.paymentIntent,amount:amt};}
      a.disabled=true;a.textContent='Bezig…';
      refund(payload,function(ok,d){if(ok){pu.refunded=true;pu.refundedAmount=(d&&d.amount!=null)?d.amount:amt;save();renderHost();alert('Terugbetaald'+((d&&d.amount!=null)?(': €'+d.amount):'')+'.');}
        else{a.disabled=false;a.textContent='Terugbetalen';alert((d&&d.error)||'Terugbetalen mislukt.');}});return;}
    // Testmail vanuit Communicatie (gebruikt de centrale e-mailconfig)
    if(act==='email-sendtest'){var so=q('ba-comm-out');if(so){so.style.color='';so.textContent='Testmail versturen…';}
      fetch(api('email/test'),{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})
        .then(function(r){return r.json().then(function(d){return{ok:r.ok,d:d};});})
        .then(function(x){if(so){if(x.ok&&x.d&&x.d.ok){so.style.color='#15803d';so.textContent='Testmail verstuurd ✓ Check de inbox.';}else{so.style.color='#b91c1c';so.textContent=(x.d&&x.d.error)||'Versturen mislukt.';}}})
        .catch(function(){if(so){so.style.color='#b91c1c';so.textContent='Versturen mislukt.';}});return;}
    // Bericht naar leden (echte e-mail)
    if(act==='broadcast'){var scope=(q('ba-bc-scope')||{value:'klanten'}).value,subj=(q('ba-bc-subj')||{value:''}).value.trim(),bd=(q('ba-bc-body')||{value:''}).value.trim(),bo=q('ba-bc-out');
      if(!subj||!bd){if(bo){bo.style.color='#b91c1c';bo.textContent='Vul een onderwerp en een bericht in.';}return;}
      var rcpts=recipientEmails(scope);
      if(!rcpts.length){if(bo){bo.style.color='#b91c1c';bo.textContent='Geen ontvangers gevonden voor deze selectie.';}return;}
      if(bo){bo.style.color='';bo.textContent='Versturen naar '+rcpts.length+' ontvanger(s)…';}
      fetch(api('email/broadcast'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({subject:subj,body:bd,recipients:rcpts})})
        .then(function(r){return r.json().then(function(d){return{ok:r.ok,d:d};});})
        .then(function(x){if(x.ok&&x.d&&x.d.ok){if(bo){bo.style.color='#15803d';bo.textContent='Verstuurd naar '+x.d.sent+' van '+x.d.total+' ontvanger(s).';}var sj=q('ba-bc-subj'),bb=q('ba-bc-body');if(sj)sj.value='';if(bb)bb.value='';}
          else if(bo){bo.style.color='#b91c1c';bo.textContent=(x.d&&x.d.error)||'Versturen mislukt.';}})
        .catch(function(){if(bo){bo.style.color='#b91c1c';bo.textContent='Versturen mislukt.';}});return;}
    if(act==='togglepay'){var pk=a.getAttribute('data-k'),other=pk==='tegoed'?'stripe':'tegoed';
      if(!a.checked&&!S.pay[other]){a.checked=true;alert('Minstens één betaalmethode moet aan staan.');return;}
      S.pay[pk]=a.checked;save();render();return;}
    if(act==='delmember'){var mid=a.getAttribute('data-m');
      if(SRV){sdel('members/'+mid).then(function(r){if(r.ok)refreshAndRender();});return;}
      S.members=S.members.filter(function(x){return x.id!==mid;});save();renderHost();return;}

    // Kortingscodes / cadeaubonnen (alleen admin, server-mode)
    if(act==='addcode'){var ccode=(q('ba-cc')||{value:''}).value.trim();if(!ccode){alert('Geef een code op.');return;}
      var ckind=(q('ba-ck')||{value:'percent'}).value,cval=parseFloat((q('ba-cv')||{value:'0'}).value)||0,cexp=(q('ba-ce')||{value:''}).value,cmax=parseInt((q('ba-cu')||{value:'0'}).value,10)||0;
      spost('codes',{code:ccode,kind:ckind,value:cval,expiresAt:cexp,maxUses:cmax}).then(function(r){if(!r.ok){alert((r.d&&r.d.error)||'Aanmaken mislukt.');return;}refreshAndRender();});return;}
    if(act==='delcode'){var cid=a.getAttribute('data-c');if(!confirm('Deze code verwijderen?'))return;
      sdel('codes/'+cid).then(function(r){if(r.ok)refreshAndRender();});return;}

    // Locaties (alleen admin, server-mode)
    if(act==='addloc'){var ln=(q('ba-locn')||{value:''}).value.trim();if(!ln){alert('Geef een naam op.');return;}
      var la=(q('ba-loca')||{value:''}).value.trim();
      spost('locations',{name:ln,address:la}).then(function(r){if(!r.ok){alert((r.d&&r.d.error)||'Opslaan mislukt.');return;}refreshAndRender();});return;}
    if(act==='savereview'){var ru=(q('ba-review-url')||{value:''}).value.trim();if(!S.settings)S.settings={};S.settings.reviewUrl=ru;
      spost('settings',{reviewUrl:ru}).then(function(r){if(r.ok)alert('Opgeslagen.');else alert((r.d&&r.d.error)||'Opslaan mislukt.');});return;}
    if(act==='delloc'){var lid=a.getAttribute('data-l');if(!confirm('Deze locatie verwijderen? Lessen op deze locatie houden geen specifieke locatie meer.'))return;
      sdel('locations/'+lid).then(function(r){if(r.ok)refreshAndRender();});return;}

    // Video's-tab
    if(act==='vidcat'){videoCat=a.getAttribute('data-c')||'yoga';renderHost();return;}
    if(act==='addvideo'){var vt=(q('ba-vt')||{value:''}).value.trim(),vu=(q('ba-vu')||{value:''}).value.trim(),vw=parseInt((q('ba-vw')||{value:'1'}).value,10)||1,vo=q('ba-vid-out');
      if(!vt||!vu){if(vo){vo.style.color='#b91c1c';vo.textContent='Vul een titel en een video-link in.';}return;}
      if(SRV){spost('videos',{category:videoCat,title:vt,url:vu,weekNo:vw}).then(function(r){if(!r.ok){if(vo){vo.style.color='#b91c1c';vo.textContent=(r.d&&r.d.error)||'Toevoegen mislukt.';}return;}refreshAndRender();});return;}
      if(!S.videos)S.videos=[];S.videos.push({id:uid(),category:videoCat,title:vt,url:vu,weekNo:vw});save();renderHost();return;}
    if(act==='delvideo'){var dvid=a.getAttribute('data-v');
      if(SRV){sdel('videos/'+dvid).then(function(r){if(r.ok)refreshAndRender();});return;}
      S.videos=(S.videos||[]).filter(function(x){return String(x.id)!==String(dvid);});save();renderHost();return;}
    if(act==='savevideoplan'){var vpr=parseFloat((q('ba-vp')||{value:'0'}).value)||0,vdy=parseInt((q('ba-vd')||{value:'30'}).value,10)||30,vpo=q('ba-vplan-out');
      if(SRV){spost('video-plan',{category:videoCat,price:vpr,validDays:vdy}).then(function(r){if(!r.ok){if(vpo){vpo.style.color='#b91c1c';vpo.textContent=(r.d&&r.d.error)||'Opslaan mislukt.';}return;}if(vpo){vpo.style.color='#15803d';vpo.textContent='Opgeslagen \\u2713';}refreshAndRender();});return;}
      if(!S.videoPlans)S.videoPlans=[];var vix=S.videoPlans.map(function(p){return p.category;}).indexOf(videoCat);if(vix>=0)S.videoPlans[vix]={category:videoCat,price:vpr,validDays:vdy};else S.videoPlans.push({category:videoCat,price:vpr,validDays:vdy});save();renderHost();return;}
    if(act==='subvideo'){var scat=a.getAttribute('data-c')||videoCat;var sp=planFor(scat);
      if(!sp||!(sp.price>0)){alert('Voor deze categorie is nog geen abonnementsprijs ingesteld.');return;}
      payWithCode('abonnement','Video-abonnement '+catLabel(scat),sp.price,{kind:'video',category:scat,bookerEmail:myEmail()});return;}
    if(act==='cancelvideo'){if(!confirm('Je video-abonnement opzeggen? Je houdt toegang tot het einde van de betaalde periode.'))return;
      spost('video-cancel',{category:a.getAttribute('data-c')||videoCat}).then(function(r){if(!r.ok){alert((r.d&&r.d.error)||'Opzeggen mislukt.');return;}alert('Opgezegd. Je houdt toegang tot het einde van de periode.');refreshAndRender();});return;}
    if(act==='cancelmembership'){if(!confirm('Je lessen-abonnement opzeggen? Je houdt toegang tot het einde van de betaalde periode.'))return;
      spost('cancel-membership',{subscription:a.getAttribute('data-s')}).then(function(r){if(!r.ok){alert((r.d&&r.d.error)||'Opzeggen mislukt.');return;}alert('Opgezegd. Je houdt toegang tot het einde van de periode.');refreshAndRender();});return;}
    if(act==='endmembership'){if(!confirm('Je abonnement nu beëindigen? Je stopt hiermee per direct met dit abonnement.'))return;
      spost('end-membership',{}).then(function(r){if(!r.ok){alert((r.d&&r.d.error)||'Beëindigen mislukt.');return;}alert('Je abonnement is beëindigd.');refreshAndRender();});return;}
    if(act==='delcancel'){var cbid=a.getAttribute('data-b');S.bookings=S.bookings.filter(function(b){return !(b.id===cbid&&b.status==='cancelled');});save();renderHost();return;}
    if(act==='clearcancels'){S.bookings=S.bookings.filter(function(b){return b.status!=='cancelled';});save();renderHost();return;}
    if(act==='stripe-onboard'){var ex=root.querySelector('#ba-stripe-extra');if(ex)ex.textContent='Bezig…';
      var w=null;try{w=window.open('about:blank','_blank');}catch(e){} // open SYNC binnen de klik (Safari)
      var here=location.href.replace(/[?&](betaald|geannuleerd|stripe)=[^&]*/g,'');
      fetch(api('stripe/onboard'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({returnUrl:here,refreshUrl:here})}).then(function(r){return r.json();}).then(function(d){
        if(d.url){
          try{if(w)w.location.href=d.url;}catch(e){}
          // Altijd ook een klikbare link tonen (één klik werkt altijd, ook als de pop-up wordt geblokkeerd).
          if(ex)ex.innerHTML='<a href="'+d.url+'" target="_blank" rel="noopener" style="color:var(--ba);font-weight:700">Open Stripe-onboarding ↗</a> — daarna Integraties opnieuw openen om de status te verversen.';
        } else { if(w){try{w.close();}catch(e){}} if(ex)ex.textContent=d.error||'Koppelen mislukt.'; }
      }).catch(function(){if(w){try{w.close();}catch(e){}}if(ex)ex.textContent='Koppelen mislukt.';});return;}
    if(act==='stripe-dashboard'){var sw=null;try{sw=window.open('about:blank','_blank');}catch(e){} // sync in de klik (Safari)
      fetch(api('stripe/dashboard'),{method:'POST'}).then(function(r){return r.json();}).then(function(d){
        if(d.url){try{if(sw)sw.location.href=d.url;}catch(e){}}
        else{if(sw){try{sw.close();}catch(e){}}alert(d.error||'Kon het Stripe-dashboard niet openen.');}
      }).catch(function(){if(sw){try{sw.close();}catch(e){}}alert('Kon het Stripe-dashboard niet openen.');});return;}
    if(act==='gcal-connect'){var gx=root.querySelector('#ba-gcal-extra');if(gx)gx.textContent='Bezig…';
      var gw=null;try{gw=window.open('about:blank','_blank');}catch(e){} // open SYNC binnen de klik (Safari)
      fetch(api('gcal/connect'),{method:'POST'}).then(function(r){return r.json();}).then(function(d){
        if(d.url){try{if(gw)gw.location.href=d.url;}catch(e){}
          if(gx)gx.innerHTML='<a href="'+d.url+'" target="_blank" rel="noopener" style="color:var(--ba);font-weight:700">Open Google-inlog ↗</a> — na koppelen ververst de status vanzelf.';}
        else{if(gw){try{gw.close();}catch(e){}}if(gx)gx.textContent=d.error||'Koppelen mislukt.';}
      }).catch(function(){if(gw){try{gw.close();}catch(e){}}if(gx)gx.textContent='Koppelen mislukt.';});return;}
    if(act==='gcal-disconnect'){if(!confirm('Google Agenda ontkoppelen? Bestaande lesafspraken in je agenda blijven staan.'))return;
      fetch(api('gcal/disconnect'),{method:'POST'}).then(function(){refreshGcalStatus();var gx=root.querySelector('#ba-gcal-extra');if(gx)gx.textContent='Ontkoppeld.';}).catch(function(){});return;}
    if(act==='cal-connect'){var cbox=q('ba-cal-box');if(cbox)cbox.textContent='Koppelen…';syncCalendar();
      fetch(api('calendar')).then(function(r){return r.json();}).then(function(d){if(!cbox)return;var url=d.url||'';
        cbox.innerHTML='<label class="ba-f">Jouw agenda-feed (abonneer hierop):</label>'+
          '<div class="ba-row" style="gap:6px;justify-content:flex-start"><input id="ba-cal-url" readonly value="'+esc(url)+'" style="flex:1;min-width:0"><button class="ba-btn ghost sm" data-act="cal-copy">Kopieer</button></div>'+
          '<div class="ba-card" style="background:rgba(255,255,255,.03);margin-top:10px;font-size:13px;line-height:1.55">'+
            '<b>Google Agenda</b><ol style="margin:6px 0 10px;padding-left:18px"><li>Open <a href="https://calendar.google.com" target="_blank" rel="noopener" style="color:var(--ba)">calendar.google.com</a></li><li>Links naast “Andere agenda’s” → <b>+</b> → <b>Via URL</b></li><li>Plak de link → <b>Agenda toevoegen</b></li></ol>'+
            '<b>Apple Agenda</b><ol style="margin:6px 0 10px;padding-left:18px"><li>iPhone: Instellingen → Agenda → Accounts → Account toevoegen → <b>Anders</b> → <b>Agenda-abonnement toevoegen</b> → plak de link</li><li>Mac: Agenda → Archief → <b>Nieuw agenda-abonnement</b> → plak de link</li></ol>'+
            '<b>Outlook / Microsoft 365</b><ol style="margin:6px 0 0;padding-left:18px"><li>Open je Outlook-agenda → <b>Agenda toevoegen</b> → <b>Abonneren via internet</b></li><li>Plak de link → <b>Importeren</b></li></ol>'+
          '</div>'+
          '<p class="ba-note" style="margin-top:8px">Werkt zodra de app op een openbaar webadres draait (een agendadienst kan localhost niet bereiken). Nieuwe lessen verschijnen na de eerstvolgende verversing van je agenda (meestal enkele uren).</p>';
      }).catch(function(){if(cbox)cbox.textContent='Koppelen mislukt.';});return;}
    if(act==='cal-copy'){var cu=q('ba-cal-url');if(cu){try{cu.select();}catch(e){}try{navigator.clipboard.writeText(cu.value);}catch(e){}a.textContent='Gekopieerd ✓';setTimeout(function(){a.textContent='Kopieer';},1500);}return;}
    if(act==='invoice-save'){var io=q('ba-inv-out');if(io){io.style.color='';io.textContent='Opslaan…';}
      var gv=function(id){var el=q(id);return el?el.value.trim():'';};
      var vpRaw=parseInt(gv('ba-inv-vatp'),10);var vp=isNaN(vpRaw)?null:vpRaw; // 0% mag (US) — server vult standaard in bij leeg
      fetch(api('invoice-settings'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({country:gv('ba-inv-country')||'NL',company:gv('ba-inv-company'),address:gv('ba-inv-address'),postcode:gv('ba-inv-postcode'),city:gv('ba-inv-city'),kvk:gv('ba-inv-kvk'),vat:gv('ba-inv-vat'),vatPercent:vp,email:gv('ba-inv-email')})})
        .then(function(r){return r.json().then(function(d){return{ok:r.ok,d:d};});})
        .then(function(x){if(io){if(x.ok){io.style.color='#15803d';io.textContent='Facturatie-gegevens opgeslagen ✓';refreshInvoiceSettings();}else{io.style.color='#b91c1c';io.textContent=(x.d&&x.d.error)||'Opslaan mislukt.';}}})
        .catch(function(){if(io){io.style.color='#b91c1c';io.textContent='Opslaan mislukt.';}});return;}

    // Mindbody import: read each selected CSV and POST it (sequentially), then show a per-type summary.
    if(act==='mb-import'){var out=q('ba-mb-out');if(out){out.style.color='#6b7280';out.textContent='Bezig met importeren…';}
      var jobs=[['clients','ba-mb-clients'],['class_packs','ba-mb-packs'],['memberships','ba-mb-members']];var results=[];
      var run=function(i){
        if(i>=jobs.length){if(out){if(!results.length){out.style.color='#b45309';out.textContent='Selecteer minstens één CSV-bestand.';}
          else{out.style.color='#15803d';out.innerHTML=results.map(mbSummaryLine).join('<br>');}}refreshImportStatus();return;}
        var inp=q(jobs[i][1]);var f=inp&&inp.files&&inp.files[0];if(!f){run(i+1);return;}
        var rd=new FileReader();rd.onload=function(){
          fetch(api('import/mindbody'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:jobs[i][0],csv:String(rd.result||'')})})
            .then(function(x){return x.json();}).then(function(d){if(d&&!d.error)results.push(d);else if(out){out.style.color='#b91c1c';out.textContent=(d&&d.error)||'Import mislukt.';}run(i+1);})
            .catch(function(){run(i+1);});};
        rd.onerror=function(){run(i+1);};rd.readAsText(f);
      };run(0);return;}
    // Alles-in-één: één CSV waarin elke rij automatisch geclassificeerd wordt (klant/strippenkaart/abonnement).
    if(act==='mb-import-all'){var oa=q('ba-mb-out');var inp=q('ba-mb-all');var f=inp&&inp.files&&inp.files[0];
      if(!f){if(oa){oa.style.color='#b45309';oa.textContent='Selecteer eerst een CSV-bestand.';}return;}
      if(oa){oa.style.color='#6b7280';oa.textContent='Bezig met importeren…';}
      var rd=new FileReader();rd.onload=function(){
        fetch(api('import/mindbody'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'combined',csv:String(rd.result||'')})})
          .then(function(x){return x.json();}).then(function(d){
            if(oa){if(d&&!d.error){oa.style.color='#15803d';oa.innerHTML=mbSummaryLine(d);}else{oa.style.color='#b91c1c';oa.textContent=(d&&d.error)||'Import mislukt.';}}refreshImportStatus();})
          .catch(function(){if(oa){oa.style.color='#b91c1c';oa.textContent='Import mislukt.';}});};
      rd.onerror=function(){if(oa){oa.style.color='#b91c1c';oa.textContent='Kon bestand niet lezen.';}};rd.readAsText(f);return;}
    if(act==='mb-send'){var mo=q('ba-mb-out');if(mo){mo.style.color='#6b7280';mo.textContent='Activatie-mails versturen…';}
      fetch(api('import/send-activations'),{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).then(function(r){return r.json();}).then(function(d){
        if(mo){if(d&&d.ok){mo.style.color='#15803d';mo.textContent=d.sent+' van '+d.total+' activatie-mail(s) verstuurd'+(d.errors&&d.errors.length?(' · '+d.errors.length+' mislukt'):'')+'.';}else{mo.style.color='#b91c1c';mo.textContent=(d&&d.error)||'Versturen mislukt.';}}
        refreshImportStatus();
      }).catch(function(){if(mo){mo.style.color='#b91c1c';mo.textContent='Versturen mislukt.';}});return;}
  });

  // Finalize a Stripe payment after returning from Checkout (?betaald=1): grant the booking
  // or the strippenkaart/abonnement from the stashed pending action. Cleared so a refresh
  // can't double-apply.
  // Stripe return (?betaald=1): we stash the pending action; boot() finalizes it once SRV is known
  // (server-side via /studio/stripe/finalize, or the local fallback below).
  var stripeReturn=null;
  (function(){
    if(!/[?&]betaald=1(&|$)/.test(location.search||''))return;
    var p=getPending();var sid=(location.search.match(/[?&]session_id=([^&]+)/)||[])[1];
    if(!p)return; if(!sid){clearPending();return;}
    stripeReturn={p:p,sid:decodeURIComponent(sid)};clearPending();
  })();
  // Local-mode grant (server-mode uses /studio/stripe/finalize — see finalizeStripeReturn).
  function localStripeGrant(p,sid){
    fetch(api('stripe/verify?session_id='+encodeURIComponent(sid))).then(function(r){return r.json();}).then(function(d){
      if(d&&d.paid){
        if(p.kind==='book'){var sb={id:uid(),classId:p.classId,date:p.date,name:p.name||'Gast',bookerEmail:p.bookerEmail||'',status:'booked',payment:'stripe',usedCredit:false,present:false,noShow:false,paymentIntent:d.paymentIntent||'',amount:(d.amountTotal||0)/100};S.bookings.push(sb);var scm=classMeta(p.classId);notify('booking',p.bookerEmail||myEmail(),{name:p.name,classTitle:scm.title,date:p.date,time:scm.time,bookingId:sb.id,mode:scm.mode,onlineLink:scm.link,onlineInfo:scm.info});
          genInvoice({email:p.bookerEmail||myEmail(),name:p.name||accName(p.bookerEmail||myEmail()),description:'Losse les — '+scm.title+(p.date?(' '+p.date):''),amount:(d.amountTotal||0)/100,method:'Stripe'});}
        else if(p.kind==='buy'){var m=S.members.filter(function(x){return x.id===p.memberId;})[0];if(m){var BW=walletFor(p.bookerEmail||myEmail());if(isUnlimited(m)){BW.membership=m.name;}else{BW.credits+=(m.credits||0);BW.membership=null;}var dt=new Date();dt.setDate(dt.getDate()+(m.validDays||30));BW.validUntil=ymd(dt);
          if(!S.purchases)S.purchases=[];S.purchases.push({id:uid(),email:p.bookerEmail||myEmail(),type:m.type,name:m.name,amount:(d.amountTotal||0)/100,paymentIntent:d.paymentIntent||'',subscription:d.subscription||'',date:ymd(new Date()),refunded:false});
          genInvoice({email:p.bookerEmail||myEmail(),name:accName(p.bookerEmail||myEmail()),description:(m.type==='abonnement'?'Abonnement':'Strippenkaart')+' — '+m.name,amount:(d.amountTotal||0)/100,method:'Stripe'});}}
        save();render();setTimeout(function(){alert('Betaling gelukt! Je boeking/aankoop is bevestigd.');},60);
      } else { setTimeout(function(){alert('Betaling kon niet bevestigd worden — er is niets toegekend.');},60); }
    }).catch(function(){});
  }
  // Called by boot once SRV is known: finalize a stashed Stripe return server-side or locally.
  function finalizeStripeReturn(){
    if(!stripeReturn)return;var p=stripeReturn.p,sid=stripeReturn.sid;stripeReturn=null;
    if(SRV){
      spost('stripe/finalize',{session_id:sid,kind:p.kind,classId:p.classId,date:p.date,memberId:p.memberId,category:p.category,code:p.code,discount:p.discount}).then(function(r){
        if(r.ok){refreshAndRender();setTimeout(function(){alert('Betaling gelukt! Je boeking/aankoop is bevestigd.');},60);}
        else setTimeout(function(){alert((r.d&&r.d.error)||'Betaling kon niet bevestigd worden — er is niets toegekend.');},60);
      });
    } else { localStripeGrant(p,sid); }
  }

  // Mindbody activation bridge: an e-mailed link carries ?activate=<token>. We consume it once at the
  // server (marks the customer activated + returns their entitlements), then either pre-fill the
  // register screen (new account) or apply the tegoed to an existing account and ask them to log in.
  (function(){
    var m=(location.search||'').match(/[?&]activate=([^&]+)/);if(!m||!projId())return;
    var token=decodeURIComponent(m[1]);
    fetch(api('import/activate'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:token})})
      .then(function(r){return r.json();}).then(function(d){
        if(!d||!d.ok){activationMsg=(d&&d.error)||'De activatielink is ongeldig of al gebruikt.';authView='login';render();return;}
        var existing=S.accounts.some(function(x){return x.email===d.email;});
        if(existing){applyEntitlements(d.email,d.entitlements||[]);clearAct();activationEmail=d.email;
          activationMsg='Je gegevens zijn geactiveerd. Log in met je bestaande account om verder te gaan.';authView='login';}
        else{setAct({email:d.email,name:((d.firstName||'')+' '+(d.lastName||'')).trim(),phone:d.phone||'',entitlements:d.entitlements||[]});authView='register';}
        render();
      }).catch(function(){});
  })();

  // ── Boot ──────────────────────────────────────────────────────────────────
  // With a project we use the server (seed staff once, then hydrate from /studio/state). If the
  // server can't be reached we fall back to the existing localStorage behaviour so nothing breaks.
  (function boot(){
    if(!projId()){render();if(!S.session)loadPublic();finalizeStripeReturn();return;}  // editor preview zonder project → localStorage
    spost('seed-staff',{accounts:(BAKED&&BAKED.accounts)||[]}).catch(function(){})
      .then(function(){return sget('state');})
      .then(function(r){
        if(r&&(r.ok||r.status===401)){SRV=true;if(r.ok)applyServerState(r.d);else{S.session=null;setSrvToken('');}}
        else{SRV=false;}                                   // server bereikbaar maar fout → fallback
        render();if(!S.session)loadPublic();finalizeStripeReturn();
      })
      .catch(function(){SRV=false;render();if(!S.session)loadPublic();finalizeStripeReturn();});  // server onbereikbaar → fallback
  })();
})();
</script>
</section>`;

const escH = (s: string) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
const escA = (s: string) => String(s ?? "").replace(/["&<>]/g, (c) => ({ '"': "&quot;", "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));

export type BookingAccount = { role: "admin" | "teacher"; name: string; email: string; password: string };
export type BookingAppOpts = { title?: string; accent?: string; navLinks?: { label: string; href: string }[]; accounts?: BookingAccount[]; logo?: string; homeBg?: string };

/**
 * Build the booking-app page as a CLEAN, self-contained document. We deliberately do NOT
 * inject it into the imported site's shell: that shell loads the site's own CSS/JS (Bootstrap,
 * preloaders, fixed-nav overlap) which hid the app and broke its buttons. A standalone page
 * guarantees the app renders and its JavaScript works, while a slim header reuses the site's
 * menu links + primary colour so it still feels part of the site (and navigation keeps working
 * in the preview). localStorage works because the page has a real origin.
 */
export function buildBookingAppPage(opts: BookingAppOpts = {}): string {
  const accent = (opts.accent && /^#[0-9a-fA-F]{3,8}$/.test(opts.accent)) ? opts.accent : "#1f6f78";
  const title = (opts.title || "Studio").trim() || "Studio";
  // Header shows ONLY the studio name + a single Home link — we deliberately do NOT copy the
  // site's menu items (they'd clutter every booking app with that site's headings).
  // Accounts are configured IN THE CHAT (the AI asks). A fresh app starts with NO accounts —
  // the studio sets the admin/teacher logins via the chat; customers self-register at login.
  const accounts: BookingAccount[] = (opts.accounts && opts.accounts.length) ? opts.accounts : [];
  // Accept absolute URLs, data: images, AND root-relative "/assets/…" (a LOCALISED import asset served
  // by the Nebula host itself — an absolute original-domain URL would 404 after the domain moves).
  const logo = (opts.logo && /^(https?:\/\/|\/assets\/)/i.test(opts.logo)) ? opts.logo : "";
  const bg = (opts.homeBg && /^(data:image\/|https?:\/\/|\/assets\/)/i.test(opts.homeBg)) ? opts.homeBg : "";
  // Bake only a FLAG (not the data URI) so the image is inlined ONCE — in the CSS var below.
  // SECURITY: never bake staff passwords into the served page (they'd be readable in page source).
  // Auth runs against the studio_users table (seeded server-side); the page only needs role/name/email.
  const safeAccounts = accounts.map((a) => ({ role: a.role, name: a.name, email: a.email }));
  const baked = JSON.stringify({ studio: title, accounts: safeAccounts, logo, bg: bg ? "1" : "" });
  // When a background is set: put it on the whole app (fixed, softened with a light overlay so
  // text/cards stay readable), make the top bar transparent (no white bar), float the cards,
  // and define .ba-hero for the full-screen home. The image is inlined exactly once here.
  const bgCss = bg ? `
:root{--ba-img:url("${bg}")}
.ba-hero{background:linear-gradient(rgba(10,10,10,.55),rgba(10,10,10,.8)),var(--ba-img) center/cover !important}
` : "";
  const appMain = BOOKING_APP_MAIN.replace("var BAKED=__BAKED__;", () => "var BAKED=" + baked + ";");
  return `<!DOCTYPE html>
<html lang="nl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Boekingen — ${escH(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>
:root{--buildly-primary:${accent}}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;font-family:'Inter',system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#f2f0ea;background:#0a0a0a;-webkit-font-smoothing:antialiased}
/* full-screen loader — fades out once the page is ready (the "laad-animatie") */
#ba-loader{position:fixed;inset:0;z-index:9999;background:#0a0a0a;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:22px;transition:opacity .7s ease,visibility .7s ease}
#ba-loader.is-done{opacity:0;visibility:hidden;pointer-events:none}
#ba-loader .ring{width:54px;height:54px;border-radius:50%;border:2px solid rgba(255,255,255,.10);border-top-color:#c8b89a;animation:baspin .9s linear infinite}
#ba-loader .lw{font-family:'Instrument Serif',serif;font-size:27px;letter-spacing:.02em;color:#f2f0ea;opacity:.9}
@keyframes baspin{to{transform:rotate(360deg)}}
/* subtle background video (the tonymak-style hero) */
.ba-herovid{position:fixed;inset:0;z-index:0;overflow:hidden;background:#0a0a0a;pointer-events:none}
.ba-herovid video{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);min-width:100%;min-height:100%;object-fit:cover;opacity:.30;filter:grayscale(.25) contrast(1.03)}
.ba-herovid::after{content:"";position:absolute;inset:0;background:radial-gradient(130% 130% at 50% 0%,rgba(10,10,10,.35),rgba(10,10,10,.92))}
/* top bar */
.ba-top{position:sticky;top:0;z-index:30;background:transparent;display:flex;align-items:center;justify-content:center;padding:14px;pointer-events:none}
.ba-home{pointer-events:auto;display:inline-flex;align-items:center;gap:8px;background:rgba(255,255,255,.06);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);color:#f2f0ea;font-weight:500;font-size:14px;letter-spacing:.02em;text-decoration:none;padding:10px 22px;border-radius:999px;border:1px solid rgba(255,255,255,.13);transition:background .2s ease,border-color .2s ease,transform .1s ease}
.ba-home:hover{background:rgba(200,184,154,.16);border-color:rgba(200,184,154,.55)}
.ba-home:active{transform:scale(.97)}
.ba-hero-grad{background:linear-gradient(135deg,#c8b89a,#0a0a0a) !important}
.ba-fixedvideo{position:fixed;inset:0;z-index:0;overflow:hidden;pointer-events:none;background:#0a0a0a}
.ba-fixedvideo video{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);min-width:100%;min-height:100%;width:auto;height:auto;object-fit:cover;pointer-events:none}
.ba-fixedvideo::after{content:"";position:absolute;inset:0;background:linear-gradient(rgba(10,10,10,.32),rgba(10,10,10,.72))}
/* scroll-reveal */
.ba-rv{opacity:0;transform:translateY(18px);transition:opacity .7s cubic-bezier(.2,.7,.2,1),transform .7s cubic-bezier(.2,.7,.2,1)}
.ba-rv.is-in{opacity:1;transform:none}
${bgCss}</style>
</head>
<body>
<div id="ba-loader"><div class="ring"></div><div class="lw">${escH(title)}</div></div>
<div class="ba-fixedvideo"><video autoplay muted loop playsinline preload="auto"><source src="https://videos.pexels.com/video-files/8347847/8347847-uhd_4096_2160_30fps.mp4" type="video/mp4"></video></div>
<header class="ba-top"><a class="ba-home" href="index.html">Home</a></header>
${appMain}
<footer style="text-align:center;padding:22px 16px 28px"><a href="https://nebulabookings.com" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:8px;color:#8a8b83;font:600 12px/1 system-ui,sans-serif;text-decoration:none">Powered by <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAJYAAABvCAYAAAAOnDkzAAAsdElEQVR42u19eXwUVbb/OfdWdWcPCQkEwg4qq4iAIKAOKCCMjMoIyigMrj8eLiOIOsx7PmDGGRXkKSo4OLj7QGEUF/Z9F9k3kU0CCFlIQro7nd6q6p73R3eHSvetTgf0vfCbPtCf7lRXdS33W+d8z/eeewsgYQlLWMISlrCEJSxhP7dh4hLUb2OMwZPjxl33U3HxjYZhBNq3b7/6lVdeOZO4Mgm7LLv//vvu6dixo7tdu3Z01VVXUefOnQtGjhzZub4fN080XT1uHM4hLS39FYfD0ZmCBrquZ7ndLqWk5PySeu1pE81Xf42IwOl0ZUYu8/kCvT/77DNbwmPVI1u9+ouGKtp79urePWnvgQPlRFSv+VV2dvYjhmE0N/NixhikpbEPt23b6U54rHpgD40Zc/PkyX/7bsv27Rs3bN26q++NN7516NDCenvn67rOiIhLPFlmQUFJw0QorB9hxX7g8OEZ5eXlbXVdh4CmpRUWFz/+xBNzetbnrB0Ro9rIMAyltLTUlgCW/Ir9r+7v2WefvaaqqqpraL8UxBpBSUlJa6jXyLKKkiylPh+38r+9w7/+dXLupk27Rrtd7m7A8EJGRubs5cuXH/ul93v06NF2uq7bQ6AyA1ypx+1DSECSm5KpqpqdAFbI5s6dm/L2229/6na7BwghABHB6XS1IaI7EVH8wnyllRBCFiLrMx0gQjQilwEA+ny+jEQoDNnixYuvD4MqHIp0Tbtu8vjxmb/0vn0+T2OLkFxv00JF4QRAkhuOwO/3JyWAFTKv19vedNcFPYlhZB4pKsr9pfft8XgsyK5B9dddASAyIVuu6zq/IkPhk0+O6/bjj6fu4ZyXtm/fceGMGTMKL3dnmqapksVpDocjFwB+WZ4lrM6VUz3vKxR1uJb1G1gPPHDfgHXrNn/m8/lyEBEKCk4/NH78Q8PmzHnvNFxeF4Xk7iMsLy9P/qUzUMaY9FxRCKpvomiYCyKiOVSj2dMzxmw/kwxje/zxR686e/Z8WyFEMiI6s7Kyjn/44YenEVH/2YD11ltvpf3jH++85vV6c8I8yOv1dtm2bc8MIrrvcki2oigBGRFNS0vLqQ0YM2bMyKmsvNAmENDSFVACGnnPdWyYX/L7556rilM9lybuqCgixvHClClTmns8njZE5OnYsePhMWPGVP0SgHrxxRfzt2zZMraioqKDorB9o0bd//ennnrKzVjU9cbQTXpZHOvMmTPJDz300MNdu3Yd4/f7OwkhUogoDGZn586df+jbt+/STm3bLnjno49+vGxgrVixok9VlefaCFST2+2+59Zb+z8IAO9e6skkJydLG8UwjCZW20yePOnatWs3TXjvvfduBaAmiKgQAQkhXF8CFHfq1OlYenr6ttatWy/99NNPD1pkfmBI0IeIYLfbI7Mu+OGHH9InT37ugdOnzw5fsGDBdQCQQ0Ta119/daJXr15fdunSZc68efPOWh3z22+/nb9584ZuublZx2fN+vvR2q7LM8880/Lzz/+5tLLS3UkIAYyx+99///2OhmE80r1794CFZ7tkjzV58jMd77777redTufNputl9oyZuq739vl8vcvKyp7q3bv33HvuuWfWpEmTyi6ZvLtcrlahNqjREEIILCwsnj5mzJgbLj0kGU6Z9/B6vamy9ceNe+SOpUtXrSkvLx/r8/mae70+xePxgtfrxUAgkBkIBK7xer3Dzp8//9KuXbu29ezZ8+/jx49vaQFeQ3bn2+32gBlo999/760PPHD/+u+/PzLH6XTe5vP5crxeL/h8PtXn83coKyubvHXr1k2DBt3620iRFxHhwTFjRr3zzjvbd+3a883q1Zu2DBs27I7aQt/evXuec7kqO4lgWCYhBLhcrvumT59+laqqbguve0kea+LEiX2WLVuzvKKi4ubw/iLamkwCMmmalltaWvofH374wcbhw4cPjVfYlnUX+KzCcSAQyN6zZ8/7Vo1Xe8qvu0jiOQzDiOJYTz/9xICtW7/7pLKyMje0DSFi9ct88kREuq6nlZWV/b8NG9ZtHDBgwH2M1Tw1IYSUL6iq6g838O0DBz6xe/f+byoqHN0Nw6jeh3mfRER+v7/1yZOn5/fr12+c+UL/539Oarpj9+5ZDoejma4b4PP5cgoKTv552bJldqtrYhhGstPp6h/paQ3DSN69e3djAHBKb1KiOvPSP/3pTz3WrVu7yOVytYh0HLFpGFFVlafj999//88BAwY8Fg+4ooBlt9srY2xIHo+n45bNm+dPmjQp7xLIe4BJOJrNZmto3udLU6a02rhx67tutzszgrxGvqIugM8XaHnmzJlPevbsPtUsfhLV0IMwfHPabLYAIsKtt/Z/6kRBwaxAIJAcx0UnIYStuLj49QG33HJneOHpk8VdNE3LNXUbgc/nv+bNN9+0vBGnTp2a7PN5M2XX3Ot2ZwUCgQrZd5ph1MljLfzgg/zVq1d/4nS6mlpod7GuLQAAaZqWfObMmTcGDhw4sM7AysvLKQ8RdCt0UZXH02flypWLJkyYkF+Xk8vMzDSQMYrkPwDQKHzxiMj29aqVs51OZ6s4xEspwIQQvLy8YkqPHj1eJiKUnCiF9CDBOS8dMWJE/zNnfpphGAaTgMoSyIZh2M8WFb0xduzY5gAA5Y7y7AgaQQCUUlFR0cnqBGy2gCoMocj4n6OysoHP56uKPO6QR1PrkPmxt959d8aFCxeukVxTRERUFOVscnLyd3a77SBjzIty70KGYdgLCwsnhK9rHUIhngMAT22+scrj6bdmzaovH3zwwTbxnmBWVpYhyyr1QKCaY91xxx2PlZWVD5V5DUQUqakpP6Snp++22+1FnHOrjI+EEOB0Op/t06fP84gIKJc6qnJzc1sfOnRojqbpNgtQQWpq6gFVVStk+9F1vcWRI0f+AxGhylVlDwELzWKmEKKD1TW5UFKVSwDS7hm/358OALokkwYhRNwC6ciRI4cXl5TcJ6EhyBgrz8rKmnDDDTd0P3ToUJ+ZM/+rZ/v27fulpKQssXIugUCgz+jRo1vVCVg33NC+QlGUC/HcBlVV3h7ffffdV/fdd9+18ZxgkybZXs65z3x+iAgGkU0IAVOmTGlaUFDwfDTPBmSMefLz80d//vkX3fbt29frrrvu6tahQ4dRGRkZ3yBiQHIHkRACysrKpj3wwAP9bDabL9LLIaLt4MGDc3w+X3uLkhVPenr6uAMHPr/hV7/6Vf+0tJSDkRebiMDhqPjdc88910qx25mcW/paWtGLgtOn2xmSsBZU3THNZrORBTeLq9dk+/btGSd//PEFTdMiDwA556VNmza9e9euXa9/8skn5xFRDB061L9kyZI9/fr1+4OiKA4LT5156tSpvnUC1sSJUx0IUBLnKB7y+Xyd9+/fv/TuYcNqjbs2W3olEVWZLzIRgRDCbrOpsH37tol+v7+ZzFupqupq3779sY0bN6YCgHj55ZdLvv76608PHjz4m6FDB49MT0+rlIHLMAzbwYMHns3OzkqOuGGJiGxOp7OxJDNCRNQz09Ie379//1zEq/1z587d36VL14cVRamMuC6kaXrali1b7mzcOFcudRhGO8ZQWhJzwensG+47jXRMREYDu90uBZaIE1jTX3rpTldl5bWRIRARKbtBg+c2bdq0WbZdy5YtA4qiGFa/63a7b4pF4plEFBQpqakVkTE9Frj8fn+zw8eO/XPQoEEPmcJTdN9NWsALQLKsU1n91ddNCguLf2shdpLf789bv379plmzXj/QqVOnb7t06bK6W7eu8zt16vTmnj37H9G06JKYi3KGr29ycnI32W/LeBwiQlpKyoy9Bw58YF6+YMGCnZnp6UvltekVN2dmZgRk0oCmaU2mT58RlcUJQarL5brZSuDVdZGZnCwHlhFHKCQiPHPu3O9kEcBmUze8PH36J1bb7t27s6OmadlWtfiBQKDX0aNH7XEDSwgBnPOTMjSGCJ1VxpBRUFDwj969e79IRFJi2bp1d51zrkt+V5n78cfdvV5vi1jXyTCMZI/Hm+/z+Xq53e7bnM7KUVVVVU8UFhbe4fP5bFZ3kBAiizHWJt6STbvdvvLpiRP/HNngQgjIa9r4a9nNowX0Hp5KjxcAvJL9N1u9enXTyOXjxz/SrqqqSkbsKSQppJt1tgj9K6m2tP/FF19s5vV6b4g8D0SEtLT0ef3799etiguLi8sGCSHQ6mbVNK3tH//4xxZxA4uIICUl6bQM/U3y8lZmZ2cvtQAYGYbBSkpK/r1nzx7/PWXKlEaRvzFs2DCDc8UvufD2oqKiHnHURlHki4jMOpO0G0dRlAJVVTbFob8g5/xcixYtHn/wwQelel7z5q12MobuyPPXDaNpwDAyQiQ/MuSmezyVXSN/68SJU7frhpFq1Xi6EMk2m+qUtRHnPDvU8JZWUHDiak3TsiLOGxljjua5uVutthPiTLLT6bw9RlcZEVFaefn5rnUqm0HkRyIbgTEGDqfz5M6dO+/KysqayhjzWWVjFRWOEV8uXrx89OjR3SITCsZYueQo1YqKiuwYJ4Ix+B7GeAHn3N24ceNnzp8vW1cbsBCR0tLSnl+xYoVl39idd95ZpHDlnATwSkVZmWqzqcflnMTbN/KcnU7nCBLWXa+GYai6Tg6Lls1evnx5zG6doqKinBDvpIiS8J/uGzu2yGq7sWNf6OPxeNrXNjTN5aq6oU7AatSo0VlE1GqmzQSGprXjnOm7du2a1rx583vtdrXISqisdLuv37Vr18qhQwePCocOzjkFAoELkQ1MRApjLNOiJglrAZFlV4ndbj/YqFGjYRs2bPjK663S4wiBy3fv3v1prPV+/euhVYzzUtl358vL/ZmZGTtkjeD1em82U4Txjz56rcvlvj7WvgzDUL1er9uiYZPnz5+vxG58eckNIoqKigrpXcwZg5MnT44N1XvFclng9/u7WelZUmBlZ2efZYw5okuaoO0LLzyRAQCwfv36r7t16z44NTV1h1Vo9Pv9ucePnfy4T5/esxYvfr+BEAJMab95VU4W7iojI+2wqqonFc4rEdEfevnCL8aYR1EUt6qqpYqinFRV9VBmZsbS5s2bPzVy5Mibt27duiF0qrp5IIVMWsjNzZ2C0aXAUTKAonDdAgh6q1Yt1ks5mKZ1HjLk1g5hr3H4+NHfaZpmj9V4jLHk9PR0K5eWpKpqzAEVOTk550LnU8NBEFHzdevWSXtOnnzqqU5lZWW/gfjKva+eOPGRrLiBNXv2+AuMsXMSLtTk8OHiZuG/58+ff3Ds8OFDsrKyFoT65qJ5lzB4UVHJU1Onvr58/Pjx/VJSUlIiMWQYAm02pVTSqYvpqWnLn3322etu6NXr+hYtWnTPy8vr3qRJk+75+TnX5+fnX9+mTZvu3bt3v/6mm266fvDgwd3+8pe/dN+//8Ad69evf3PatGkOUyMFYpXl2O32zzZt2rQrngtqaDqThGNCxNKnnpq4zWaznZV48aTyUudoAIA33ni56YULF+6vrdyHc5bWrFmeLquLIqIG5eXlMQdUdOvW7YiqquckdCX75MmTI2VD+nfv3vlHv9+fEY8iYBhG3uH9Ba3iLvTj/NpA165di/x+/3WR7tfhcLQFgMPhZc9Mm3aBiEb369fvYGnp+f/UdSMpsrdcCAGVlZW916xZs0pWOYGISlpa6qGysgsaAKjmu6uktHT4iRN7X/rkk09OxNPos2fPhueffzx33bodDfr161c4c+bMKgAARmTE4Gh6RkbGvHjquhYsWJA2bdo0WZmPT1HETz169HD27NnzU5/PN8n8e0QEzsrK0U8+OW7+okVLH/J4fI1razzDEGkpKckViOgGgAYRN3lKWVlZUwA4GmPI24WePXus9/l8v488FpfL9fyIESOWLFq0qHr74cOHD9y/f9/IGLVskVUQNqfH0wUA9sTlsYIhSzka4UGIiMDlcLSW3PHGtm3bXmrbtvWIpKSks1aShK7rybJKBgBIbtYs/7SiKKcld3rrTRt2PxyHZqMOHz68/4039v7oq6/W7isrK9u3bNmybYMGDbodAMCWnGyg9SA90aZ5cy0e4H711VcdAoFAS8k1KGrXruM5AIA2bdq8xxiLElJ1XW+8Zs3GDYWFheMpDhQbhpGUnp5aqSiKW1YgWVVV9etY2wshoEWLlu8zxvRoUVfLPXz48D8mTJiQHZImmhw9evQNXTciu7aQM+ax2+2nLMYxdKvTYIqkpJTD0v4rTbvKiswtX75qyU033TQgIyNjrRXvsrhLU7lg7uTk5G9lF6fswoWJd999d1eZ654yZUqzwYMHP9WtW7fNBw8eXFNUVDza5/M1JaIUv99/7dmzZz+YMmVKToMGaWHFX6rO7z108MOBAweOICIlVsg8c+bMaCGELTLT4pzvnz9/vgsAYOHChT9kZGR8LAEy+f3+DCEEi7PzmHdq1vaCoijHZde7qqrq4UGDBtxFRLbIMqGwLVy4cHNmZrSoCwDk9fpuWrly5dLbb7/93xYtWrTA7Xa3l0QTaJyXN71Zs2ZTMdrTgKZpnWQE3vIEU1JSDkcSv1AHZLNYafvcuXOPz5kzZ1heo0Z/5ZwH4pncDRHV46dO2Vq2zH+PMWbI7vQjR458OXjwwLF/+MMfrhk9enSPoUOHPtyzZ88FixYt3PXjjz/OcrlcvUzVCdUADgQCjbdu3dquYcOG7mD+YdU15e9QUFCwsGvXLmtvueWWsZMmTcozk3BVVeHee+8ddf78+YdlziY5OXljeDkRQd++fV+x2+3n6nBzSfsDf3Id9qampq6RgVQI0eDkyTOLunTp8m337t0/7tOnz5+GDBlyx5QpzzYNr4+IokOHTtNswYJBjISnz+frffz48TmVlZW3SECFdru6+eGHH34lNzd3f4inYsQxXvXy5MkN4p7Rb/z48Xlr167dr2laI3PZqt1u33P48OHeITkiZmXkkIEDBxf89NNrfr+/g4xbmQX9nJwGg3bu3Lu6S5cuKyorKwfLMjfGGDDG3ERkJyJVUlYr67w2WrVq1aVr1w64ZMmqPbVkYsESG4agKGphSlLSbuR8DwB4FYX3qqhw3KHruhoZKhhjVVdffXXPZcuW/VBTmvj1iGPHji0wDMMqdceIARSRv1vYrl27Dm3btk1bs2bNNk3TWlpVYJgGX4DNZivKysp6Y8uWLTMQ0UBE6N+//zNnzpx5Vd4vaXntKvLz8wds3Lhx38yZM7PnzZu31+/3m4sEkXPua9++fY9vvvnm+7g81uzZs8/b7fYfokOTYXvjjTdqdeVCCFi6cuXKIUOG/Kphw6y3OedaDO3JsNnUciEEtGnT5gVJR291EqDrepphGKpFWW0UYJOSkv77scceO5aWlu1gjHniUfaFIAoEAk0dLtcwh8MxxeFwvFxaWna3BFThjHLZ0qVLj0T+2PLlyxe1atX8T4qixLqJRYdrrnk5KSmpIHIdRVH8vXr1gtmzZxc2atToeYk3jyolFkKAz+drUlJS8tItt/QdHPaga9eunZXbsOFci+xdBio9Ozv76Y0bN+4DAHj++ecv2O32E5KQnOT1elvFHQoRUTRp3LiGjBC8G+zbnn76aT/EaTNnzjy/e/fe8e3bt789IyN9M2OMTPwLGWNgs9nmDRgw+AAAwJdffrkzPz9/SigMYYwunVhaJyqKUp6RkfbCwIEDx40cOdKYOnVqSXJy8joTz6pNZK1R+mylfzHGHE2bNv2brEtJCAHr12+a3q5163F2u73MfN4hQbYwPz/v4RWrVk1u3Ljxm6ZrjUHexg5PnTq1EgBg69atn+Xl5f27Bbhkxw0VFZWdTBdF37Z9+1M5OTkzTWTefP7VfysKd+XkZI/btWvnRxdDng5paWl7ZQldpcORX6eR0H+YMOGDrKys9znnEGqsQ23aNH2prpOVGYYB33zzzbq9e/fd1rp169uysrLeapCRsSk9PX1Zdnb27+fMmfPEtGnT9PDdtW7dutdD4NJrU9irLwoGjXNekJ6e/teuXa/pvW/fgRdfe+01bzhz7dGjx5PZ2dmz09PTNqanp3+Wlpa2VlXVGg1eh9NCxpi3YcMGj69evXpfDBERlq1cObdv3x59cxs2fCUlJWW73W7/Nisr6y99+3bvt3nztg80TYM333xzdm5u7geqqvpC4yCrsrKy54UBK4SAbdu2vdKyZbP77XZ7QcQxo8xbp6amnohYGNixY8ek1s2b/zo9PX0N57ySBfeFiAiKolzIyMj4ok2btrdt377jXfOQSyKAnJyczRZJglLnWZOJSLntttt+5XA4clu0aLFh8eLFRfAzmKqqIIQASUlHNUcbcMstQwtLSv7D7/f3Do4tFVFTIIU++1VV3ZqUlPRRly5dlnz88cflsTI7zjmEhlnBo48+2vzAgQMDKioqfu/3+/sCgK22GyfU8AVZWVlP7tixYynUbYAoC0cE2XejRo3qUF5e0pgxW8nq1au/lw1ne/rpp5ts27btPrfbPULTtK5ElBK+KUM8y5OamvrxnXfe+fS0adN8ViU1I0eObFtRUdE2EAhk2my28iZNmhyfP3/+Gas2mTlzZva77767w+fztTVLNe3atbtlxYoVW66o6biXLVtmnzp1ap9AIHC3qvLeWkDPCWh+RoRCVdViznF1amr615s3b95zORN8EBEbMOCmbk6n+y4SMNTn9zcVQmSGpAVARMEY+IiwVFXVb5o2bTpz1apVP8H/7WRyyrBhw9ppPt/VrqqqPJ/PxzIyMpw5ORkHvvxy2fdWALkcG9i//4DisvMvBgJ6HmOsJCXFPm/Xrr3vRRUSwhVkqk2FY/5jSR98s4pBuk38ZeAjPqEbv0SD4RMvvZTtOHMi5/yZ4uQAAKSkphoNMzPdjnxWsmTaOx6Af+lJd5Xnnnsuefr06R6rvtV6A6yJj03JSbfbGqXaVYVzjhDQBDcMUphBEAgAExztBIJzA1M4JxsABC44DEy2K5nZGekciJGm65w0QX5BKgCoKoCqAQAzEDgnHhoCxpKSOFNVBiqACgoQE4RcaFxDXQ8EdKbpWpod9AyiQCqlCshNZmC3Kz5E1W2zqQZjNkhiiIrCgiXXdsRkhYHBg7+pKqBzhat2OwPGmMKE0AQaqo0ZRIawKQoFdEQADWyqCpoumKoqpGkakDAEKAqBpoGN2Q2AAADjLICINiFEgAQB4wyIyEaCgIEOP5w/hiNHGvCvPKOfRWcrVFZ6Zp86fnaYjQxQhECFBCnCAJUEqEKQIgxUhACVCBQhQCEBimEIlQSqSHaVCBRDkCKM4IsE2ELrqUIARwCmcmKKAkxVkNkUZAoHpigYXM4FU5hAhQumcKpSFSpVuOCKQuy8gtzGGbOpiErwnSsMmaoAU1UQwc+ICkdm40CqAqgoqCvB/RgKI0VVBaqMuKIQcAbmQio1XDtGAAyBBBEwRILwbH4IaAupuzYCAgQUYR7IuQ4t0n4LAKsSwJJ0T/gI0jXAZCEAVAIQgkCI8PApACEQBAGQIBCCQuUfACAIhBAgSIAhjOrPJAQQieDfIYAqmgakKECqAqQFAQAKB1AVAFUBVBVAVQAIAiQADDcehuZsJAAMHRQJBUhQ8HgMDiAEMMEBKLgcjPAxGMF1iTiREjxmUAAkgyvC+RYLJydo0jIptAlGrKNwMIhawr/6HKRWwDIYejTGQBAjEASEDIgBggAIFyyTIAAWVjHDywkIzZ01WN11RWQenQpAQoCi65FiGBJe/JsBQVAmJ2BAwAiAEV18RSzjQIBAoX9ABIg8SsfBKAGMKRyQM4tqd7JWqCL/MAwAYO4EsCyK53TkpTrjUGMkfCgUkIBqQEHwM8LFz0Rm8JkbQJhaWEDwlhcGKLoeuXswDTPFuNRYvLg7FqF/A4U9Kl3cnigIbtN3DDhYdR7HPfGXIODcqEgAy0pIZKxI5xyEMGqAITzLOYZAgsHlBBHLI0FU7c2iwAUycJn9QLWKxWodyRFnjzIFf5Uu3isXN1YBGL8McAkyQFUdCWBZWIMGGQWl5ZUgGAsCAEOgMnkjqPZcJPFGUL1d+HMkKOMFF9RhUGXcebWsIgTD4xyUuoErrBAzBsIQF1hmxpkEsCwsNzNl31Egn2D8YgUq1Qh/FuFNggILLxYbXBQn1yG5R4ov6EuWUHVT1NlzcQaM6Ci071uSAJaFPf5Y9xM7nvzxhMcQnXVkcmBgDMAICJJ4E9AoYrvosBhMOS+CCyXeCON0UxjvIwGiMkGs3raunosBMPiutgEg/9LAatGij/eOUc+t9Pq0zgYAkAxc5uy7ejleBFENwGDN7arJe1yEPnY8pEvxTTVmTYvh9eoALl03dJa0HBKPPIltjRtmLCwrdz1JBDaBDDRkFO2hLgIGI7hVTU4V1KOqCX/MbLEWzlUXB2UCTe0+DCXOMUSfrMAV5leKAqDre5RmyVsh8bzC2Lbnu7XFC/656uaAZrQBoJCrxxpcFyPaJLJBamiLpj/M22GNjU3tRQRYLXegBB5hPQIl4DC9I5qqeeS/Eet3KVwNyjAGsDgAspfw2iHfJjxW7cmOMXb8n//rh2M/9RcCGDAAA3hUWIwk9BfDYs1skSgymzRnixfXxXgJPV4eoac4g+bFQoGIsGgGVUA/DFmN5gMknrAal+3dse7HTxevvt4fMK4BIgQEBGQ13FXYC2DIFaG55jvCc9Wo34paFu3RggpA2HOh3COZPQyGN4pYL2IZooWnQ/k+0PR9teeqHiHBCBR1IvYYuAMST/+K22uJJyb+9fndB0/fqBmUC0IAMEADOVFYpa7BkSiKLxHI9a+4ZAsBQLUR+ksWveL/ATTzNVSAcR4Eld0G4Nc/h753fAqQeCZ0nWzHt+vKbrxpkMPl9g6r7uJBQACGxNA016OV5zIxFqwxN2QE4ZJzrvC6WINz1dhAUhkdH+O35FxowbmCXjj4364CaPoRSGYPYLMOjgSwLsGOHtq259ruN2d5vFpvE7iC+gCLzqaiQWQKXDVCYDRGIr9H0x9oFRYjQiCaD0K2XjyEXhIWWag0U+EcBFE5JieNwhvu/B7qufF6XKUIxw59u3bRl2vy/H69e7VCjQBk8lwyDyXjUYgSD1WD1qA044zOFq09Elp4s7p5LvPxMwQCUDkHAeAkRXmI97trNVwBptTv5yGjRkTjb79nQtUFh/tpChdnMQQBDHQp55J9poucy0JwNfct1p4tXo4aj3FRMwyONAW7ooCuGSW6ojyU1v+eZXCFmFLfDxARdc7ZhGGjJv1YVFwxTRBmkzAAGEmlCGtwoUVnNUqqIlCeCNSV0FtydIro0pHMqYgIdlUFf0DfgWkZ49KG/m4vXEHG4coo3ocjB7buGHjbsDVVXt9Vmi5aBwt0gyIq4UXyfFFZqJ3Qh5eTiXxjRLi05lyxCb1lWJSEwMiwaFM4EqJHU9W3Kb3Jw5l3jzwFV5jxK+lg9+3eWHTq2I6Pv9158ITH47s+ENCzwuCqqXNhNLG3AlcMNb/2bFFC1CFOQg/ROhcABudxUJQvjAYNH2j0+3EfvfLZZz64Ak250g74nXc+yXNXujpqupZOZACIYCg0sC5h0cSpavv+Z1ToKY71DEQAXyAf3c7ORMeOI17tvxKBxa+gsWx4+KTvd5t3Hp5fWl45LKBpKaEoZkrhovsWY+lcEOW5ojMzQKyxPC4pwkKhx1rWCz+dV0FsznXjHvfuY/2efeD+/a9+8VVxAli/gK1fv7fB+GdenH3mXMmL/oDWAMLDJSRtRMAgWoqIMyxKun/QCohSziWRMaLCooRzYc1lggiEILQhtiKPZ+SkEXc7X12yfHciFP6M9uHChS2mTX/j47IK981ABIwxCkW/6K6a0LsADlrcUoTFZ2m2aNERLg2LGCUqUB26hAiAvF4Am01kM6fz7+fnzmqZ++iTL9THor4rDljvvbeg+bvzliwuveC6HhEIkQW7BgVa9wOawFVD57KQF2KWOQuSVK3SL6dzRWSHCACB4FzlmITuyef/PstORM9ezgPf/+VD4fbt2zOmv/HxovNlFTdW16BEJFZkDlM/d1gMcSKK6jbC/9W+xfBiIQhVoBtdB/f4Zi6pObNLAljxulGFw6ki7fVzhaX3AAmq2ZkXmbWjVd1cuG/RgtDHDy65FGEuh6mNc8mJOtZBigjpqsh1o9+zo+7Z9epXS39MhMI62n33P/7bnft+eMwwBDAWHL4eFZJEUGlAAcCYxWCL0HvdFPqIEmarEIo1y5+jOZdhEerqUkhfU6HXAEhhmGSUV7xWuHDhLU1HjixNeKw4bfHi9Q0WLv5mvsfry8XwyPTq8XfykGfViRwpRcg7rjFuEbU2hT7+sIi1d0hbLDMEQbLCcw2f2z5zxeoVCWBBfGM6nT6acO7c+XsJzJJCxIWWlZlL6qxkYfHyOBfEVOgxLoUeLluhF4IQhej47INjlrz6xVfnE8CqxZYsWZL1+Zer5np9/qzIRqcadVNWngurqy7Rcp3L9Vx4mZ4Lay25IRPkZH2QBIR2hdtFIEAzV65ZlgBWLeb2qnf9dLbwEaq+yyXFeDHIOsYbFkFWQw91CouX5rmkB1u7Qi/xcASAhm40+/OEcZ+89OnnVQnyHmPytTPnCu/RdT34nGYTUQ6TdGRBvgwWZF2Y+v9qE1EN5BBvDX2s+SFirYuWhL7u5F22zI6sSeWp4kEA8HECWBb2+uuzGr721ie9hDCCU/uERylHZGnCDC7zEGghzxovTaGPX0SlWtaVK/SxO6MpvrlICBQFNZcrAaxYtmbD9o5+v68pkWnqoXCjRXgJqv4O5SAIe4xqhZ7iB1f1fuLwXNUjr2Mr9GDpuVDSDRS/aq+xAAiE68/t2pWS36OHJwEsiTmcrq6GYTAgoBolxJIGFtXaFYs5SUh1CEW8qHXVBq4aHhLjBheFMwyrqtV4+hapbmFRQwCG2Jy+/74ZABxLAEsiM1S53K2EYQSrC2o0HIaQRDVDjAVI5A3PQuKFsAyd1mGxjp5Lui7GABfV4qXI0nMZCECIaaK4uEkCWCB/CgUBNa/mV7IJPMKhz5LQo7zT2Ezs8aIjkXsuBlqdigWx1hr6mAAVBvA4CD3WmMO05qQjCuNo6HrDBMeymEAlEAgkC2FUT/uEIoSj6kZmMUMeC68Tg6xfbF8LzoUAgnHQghPrxknoSULo61KeYwDKCD3UPugiOIe3DiJgZCeAZXUgnBtEIjTFdhBc0olqJZkZmgk9CjmoTIReMAzOj2vxmwI56MhqLV2+tLBYB0KPtRN6g3PAgJ8SwJLdl4KAM+YCCk+5LUwE3Tp0XQxhZgmC1SpBoOAg0ABkVFMXM/8m8jqGRQmhj0e2qCOhjxyVqDMOLKA5E8CSmCEEaLp+FkOdzRSaOZksGy5M6M0hLEI8ZbHJenAHCATCGrDI6zAo1spzwSWAi+KWHTSmgV03yhLAsrAGGRmnzrFiCD8jj4QRIYbKwiLVyBblCj3F9Hi1KvQQVOgp3mxRMmsg1TEsRhN6kvIuBASDMTekZxYlgGVhGRnpBxlDQwiofn5yGFxhsFgTeoxB6DkAGLHDI0LssBgazo/xeitplw9eJqGPlh84IpDCz/qvbnU2ASwLGzLkV0f37j94TtOMFuaCUQprWPESehGp0MfOKIN9ekEFn9gv0P1Tq0IPl6TQB+ejYyAAd183ZkxVorrBwpYvX+5rlNeiu9frvVaadePFQj/rygWMUfEA0rmxomd4gRhlOVb1XD9HyQ3GqIqgqPlNEQAZMuCZ6TPeObz/QMJjgfVT73Oysj6tqHDcL4SIUAzpIk+JgxfVqtBbcK7gLJEh0h/Lc0l1rvg5V92kCBHyXDXDIUcEv6IXZjbJX52ox6rF/va3qYWbNn93p6ZpjaQpEF3UdtB68mGoffBF7DJntNgezGXOURORxBigIfFQcs8V4Qmx+nlmwTm6TAdlR4aQnPxhz4XvLUoAC2qrd1+sXdO+Mzgcrl9bPkeEKKrYTzoqOhZwpK0pq6G3ACD839bQM0AUjDntrZv/27zD+0oTwIrDXn7pzz9s2frdoEBAy7eUncmKQ8X2XCjjUBbgwtDTSRB+Rs4l8VB1BxeBDREpI/Wtm9Z+kZiOuy5eq1uPXsfKyiruJRKqpTJIMadKAIhRylx3Qo8x5v6v4/xcdQJXNKG3EaDB2ff5Pa57ZPb+nd4EsOpgpwuOn257TUdW6XL3N3F4lM6ziCB9+gTECnd1BFdMzhX6MUJ2aZO/SbyiFefiCEiMuZKbNnqg19L5RwASI6HrbMWFp7e9++5HLb0+33VQ2ySetUoRWMvgizg8l2yao8sBF8ocK1oO0OCIiIi6mp31+NCdK76Cem4M6vHco6/OmDI+K6vBZ7EnOiDTQ72DDxcn08PGzd8RGTW+q/lg8tA60u1F6LeNGg8yr34PvQQQaCyo0msYemcMdOTRy0MVFNXLpdsF3wXjqHOuU8MGz9y1b/X7AIn5sS7LFixYoH3+z/lL1q3f0sDn898gaqTcEaFRJkVcsuciy8GxWMvAWQAECnf/XKKIal5RRYbA8II9K3Pc6F3L/xH/QzcTwIppH374oe6oKFl+TfvOhR6Pt7cwjFRL7xUhRVgSegnvwjrIFT9LWMSIZ35FLEdAVBlHUPl3qU1yfvfQ5i9WACRm9IOfe9bk4qLTe24bMnRJlauysd8faEdEPILCB18UbimSC6l18VyWXilOQs9Y9AMMoAYdDAtfGHrYATJE5MgQFXY+KSP91UZDrhv/4PuzC+AKM7zSDlhRFOjb97Z+Z4uKH690VQ02hJFFUeEBCRmGmwkYY4DICIPvEHznUP139TIGjDE0rUOydS6uy0P7QMDg54j1OTAEUAWBIgxQSYAiBKhCgEICVWGASgSqEGADAi4MsCP8mJZk+zQvL3fev3026xRcoYZX6oFzzmDYsBFtC07/9Buny32bz+trr+l6HgCkmDUmZAwYcgkwqgFnWh69HjMDMAKQzAqojAEz/R5DrAZUEFwGqEIAFxqoRK4kjudSFL4jVWGft7+m2eYHZ01zwBVuCP8fGOccJk2alLlqw7dNdY//KmJKC7uNN/X7tWRCZAgsVKvHEVkQEBD0KgIQiSEiImdBnswRWBg0HIOjhkKPEAZGiEwAIHAeWg9Y6JFvDJAjIrKgEwNOjDEgRIHEBAMARQihgAioIC4IX6A4LUkpTFOTTg24r0/xb+78jQcIEpawhCUsYQlLWMISljBL+x8erMz7KU8JYAAAAABJRU5ErkJggg==" alt="Nebula" style="height:20px;width:auto;vertical-align:middle"></a></footer>
<script>(function(){function done(){var l=document.getElementById('ba-loader');if(l)l.classList.add('is-done');}if(document.readyState==='complete'){setTimeout(done,350);}else{window.addEventListener('load',function(){setTimeout(done,350);});}setTimeout(done,3500);})();</script>
<script>(function(){
  function revealAll(){var e=document.querySelectorAll('.ba-rv');for(var i=0;i<e.length;i++)e[i].classList.add('is-in');}
  if(!('IntersectionObserver' in window)){revealAll();return;}
  var io=new IntersectionObserver(function(es){es.forEach(function(en){if(en.isIntersecting){en.target.classList.add('is-in');io.unobserve(en.target);}});},{threshold:0.06,rootMargin:'0px 0px -6% 0px'});
  function scan(){var e=document.querySelectorAll('.ba-rv:not(.is-in)');for(var i=0;i<e.length;i++)io.observe(e[i]);}
  scan();
  try{var r=document.getElementById('booking-app');if(r){new MutationObserver(function(){scan();}).observe(r,{childList:true,subtree:true});}}catch(e){}
  setTimeout(revealAll,2200);
})();</script>
<script>(function(){function t(){var el=document.getElementById('ba-clock');if(!el)return;var d=new Date();function p(n){return(n<10?'0':'')+n;}el.textContent='YOU '+p(d.getHours())+':'+p(d.getMinutes())+':'+p(d.getSeconds());}setInterval(t,1000);t();})();</script>
</body>
</html>`;
}
