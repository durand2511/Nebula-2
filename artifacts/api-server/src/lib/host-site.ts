/**
 * Serve a project's website on a connected custom domain: map the request path to a file in
 * project_files (/ → index.html, /booking-app.html → that file, /blog/x.html → that file) and
 * return it. Simple MVP renderer — serves the stored files as-is.
 */
import { db, projectFiles, projects, platformUsers, importAssets, projectGsc, seoArticles } from "@workspace/db";
import { hasPlatformAccess } from "./billing.js";
import { eq, and } from "drizzle-orm";
import type { Request, Response } from "express";
import { getPublishedFiles } from "./site-publish.js";
import { INDEXNOW_KEY } from "./indexnow.js";
import { handleSiteFunction } from "./site-functions.js";

// A large, non-removable Nebula branding badge (injected at serve time) for FREE (unsubscribed)
// sites. Deliberately big and prominent in the corner so a free site can't be used commercially —
// subscribing (€69,99/mo) removes it entirely.
const NEBULA_BADGE = `<a href="https://nebulabookings.com" target="_blank" rel="noopener" style="position:fixed;right:24px;bottom:24px;z-index:2147483647;display:flex;flex-direction:column;align-items:flex-start;gap:2px;background:#fff;color:#111827;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:18px 26px;border-radius:20px;box-shadow:0 10px 40px rgba(0,0,0,.30);text-decoration:none;border:3px solid #7a00df"><span style="font:800 30px/1.05 system-ui,-apple-system,Segoe UI,Roboto,sans-serif">⚡ Gemaakt met <span style="color:#7a00df">Nebula</span></span><span style="font:600 14px/1.2 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#6b7280">Maak gratis je eigen site op nebulabookings.com</span></a>`;

// Is the project's owner a paying subscriber (or the platform owner)? (ownerless/legacy = NOT.)
async function ownerSubscribed(projectId: number): Promise<boolean> {
  const [p] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!p?.ownerId) return false;
  const [u] = await db.select().from(platformUsers).where(eq(platformUsers.id, p.ownerId));
  return hasPlatformAccess(u);
}

// Opt-in lead-capture widget (shown when the project has a leadEmail). A small fixed button opens a
// compact form (naam/telefoon/e-mail/bericht) that POSTs to /api/projects/:id/lead → mailed to the
// site owner. Self-contained (own CSS/JS), neutral styling that sits calmly on any site.
// Tiny first-party analytics beacon (no cookies, no PII). Records a pageview on load and updates its
// duration on page-leave via sendBeacon. The visitor id is a random token in the visitor's own storage.
function analyticsBeacon(projectId: number): string {
  return `<script>(function(){try{
var PID=${projectId};
function vid(){try{var k='nb_vid',v=localStorage.getItem(k);if(!v){v=(Date.now().toString(36)+Math.random().toString(36).slice(2,10));localStorage.setItem(k,v);}return v;}catch(e){return 'anon';}}
var W=screen.width||0,dev=W<=640?'mobile':(W<=1024?'tablet':'desktop');
var eid=Date.now().toString(36)+Math.random().toString(36).slice(2,10);
var t0=Date.now();
var base={pid:PID,vid:vid(),dev:dev,dw:W,dh:screen.height||0,lang:(navigator.language||'')};
function post(extra){try{var b=JSON.stringify(Object.assign({},base,extra||{}));if(navigator.sendBeacon){navigator.sendBeacon('/api/track',new Blob([b],{type:'application/json'}));}else{fetch('/api/track',{method:'POST',headers:{'Content-Type':'application/json'},body:b,keepalive:true});}}catch(e){}}
post({eid:eid,path:location.pathname||'/',ref:document.referrer||''});
var sent=false;
function leave(){if(sent)return;sent=true;post({eid:eid,dur:Date.now()-t0});}
addEventListener('pagehide',leave);addEventListener('beforeunload',leave);
document.addEventListener('visibilitychange',function(){if(document.visibilityState==='hidden')leave();else hb();});
// Heartbeat so a visitor reading one page still counts as "online now" (presence only, no pageview).
function hb(){post({ping:1});}
var hbTimer=setInterval(function(){if(document.visibilityState!=='hidden')hb();},45000);
addEventListener('pagehide',function(){clearInterval(hbTimer);});
// Conversion helper for the site's own buttons: window.nbGoal('boeking'). Includes the A/B variant.
window.nbGoal=function(name){var g=String(name||'doel').slice(0,40);if(window.__nbVar)g=g+' ['+window.__nbVar+']';post({eid:'g'+Date.now().toString(36)+Math.random().toString(36).slice(2,8),path:location.pathname||'/',goal:g});};
// Click heat-map: record where people click (normalised 0..1000 of the document), throttled.
var lastClick=0;
document.addEventListener('click',function(e){var now=Date.now();if(now-lastClick<120)return;lastClick=now;try{
var dw=Math.max(document.documentElement.scrollWidth,1),dh=Math.max(document.documentElement.scrollHeight,1);
var x=Math.round(((e.pageX||0)/dw)*1000),y=Math.round(((e.pageY||0)/dh)*1000);
if(x<0||x>1000||y<0||y>1000)return;
var b=JSON.stringify({pid:PID,path:location.pathname||'/',x:x,y:y});
if(navigator.sendBeacon){navigator.sendBeacon('/api/track-click',new Blob([b],{type:'application/json'}));}else{fetch('/api/track-click',{method:'POST',headers:{'Content-Type':'application/json'},body:b,keepalive:true});}
}catch(err){}},true);
}catch(e){}})();</script>`;
}

// Exit-intent conversion pop-up: shows once per visitor when they move to leave (desktop: mouse to
// the top; mobile: fast scroll up after a while). Fires nbGoal('exit-aanbod') so it shows up in
// conversions. Config comes from the project's exitPopup JSON. Self-contained, no cookies (localStorage).
type ExitCfg = { enabled?: boolean; title?: string; body?: string; button?: string; code?: string };
function exitPopupWidget(cfg: ExitCfg): string {
  const esc = (s: string) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
  const title = esc(cfg.title || "Wacht — mis dit niet!");
  const body = esc(cfg.body || "Boek nu je gratis proefles.");
  const button = esc(cfg.button || "Ja, ik wil dit");
  const code = esc(cfg.code || "");
  return `<div id="nb-exit" style="display:none;position:fixed;inset:0;z-index:2147483200;background:rgba(15,23,42,.55);align-items:center;justify-content:center;padding:20px;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif"><div style="background:#fff;color:#1f2937;max-width:420px;width:100%;border-radius:20px;box-shadow:0 30px 80px rgba(0,0,0,.35);padding:30px 28px;text-align:center;position:relative"><button id="nb-exit-x" aria-label="Sluiten" style="position:absolute;top:12px;right:16px;border:none;background:none;font-size:22px;color:#9aa1aa;cursor:pointer">&times;</button><h3 style="margin:0 0 10px;font-size:23px">${title}</h3><p style="margin:0 0 18px;font-size:15px;color:#4b5563;line-height:1.5">${body}</p>${code ? `<div style="margin:0 0 18px;font-size:14px">Gebruik code <b style="background:#f1f5f9;padding:4px 10px;border-radius:8px;letter-spacing:.05em">${code}</b></div>` : ""}<button id="nb-exit-cta" style="width:100%;background:#1f2937;color:#fff;border:none;border-radius:12px;padding:14px;font-size:15px;font-weight:600;cursor:pointer">${button}</button></div></div>
<script>(function(){try{var K='nb_exit_seen';if(localStorage.getItem(K))return;var el=document.getElementById('nb-exit');if(!el)return;var shown=false;function show(){if(shown)return;shown=true;try{localStorage.setItem(K,'1');}catch(e){}el.style.display='flex';try{if(window.nbGoal)window.nbGoal('exit-popup-getoond');}catch(e){}}
function hide(){el.style.display='none';}
document.getElementById('nb-exit-x').onclick=hide;el.onclick=function(e){if(e.target===el)hide();};
document.getElementById('nb-exit-cta').onclick=function(){try{if(window.nbGoal)window.nbGoal('exit-aanbod');}catch(e){}hide();var f=document.getElementById('nb-lead');if(f){f.classList.add('open');f.scrollIntoView&&f.scrollIntoView();}};
// desktop: cursor leaves via the top. mobile: quick upward scroll after 8s.
document.addEventListener('mouseout',function(e){if(!e.relatedTarget&&e.clientY<=0)show();});
var ready=false;setTimeout(function(){ready=true;},8000);var ly=window.scrollY;
addEventListener('scroll',function(){var y=window.scrollY;if(ready&&y<ly-40&&y<200)show();ly=y;},{passive:true});
}catch(e){}})();</script>`;
}

// Bundled site-feature config (stored as JSON on projects.siteConfig).
type SiteConfig = {
  welcomeBack?: { enabled?: boolean; message?: string };
  newsletter?: { enabled?: boolean; title?: string; text?: string };
  abTest?: { enabled?: boolean; label?: string; selector?: string; variant?: string };
};
const escHtml = (s: string) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
const escJs = (s: string) => JSON.stringify(String(s ?? ""));

// "Welcome back" banner for returning visitors (detected via the analytics visitor-id in localStorage).
function welcomeBackWidget(cfg: NonNullable<SiteConfig["welcomeBack"]>): string {
  const msg = escHtml(cfg.message || "Welkom terug! Leuk dat je er weer bent 👋");
  return `<div id="nb-wb" style="display:none;position:fixed;left:50%;transform:translateX(-50%);bottom:22px;z-index:2147483100;background:#1f2937;color:#fff;padding:12px 18px;border-radius:999px;font:500 14px/1 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;box-shadow:0 10px 40px rgba(0,0,0,.3)">${msg}<button aria-label="Sluiten" onclick="this.parentNode.style.display='none'" style="background:none;border:none;color:#cbd5e1;margin-left:12px;font-size:16px;cursor:pointer">&times;</button></div>
<script>(function(){try{var K='nb_vid',seen='nb_wb_shown';if(!localStorage.getItem(K)||sessionStorage.getItem(seen))return;setTimeout(function(){var el=document.getElementById('nb-wb');if(el){el.style.display='block';try{sessionStorage.setItem(seen,'1');}catch(e){}setTimeout(function(){el.style.display='none';},7000);}},1500);}catch(e){}})();</script>`;
}

// Inline newsletter sign-up bar, posts to the public subscribe endpoint.
function newsletterWidget(projectId: number, cfg: NonNullable<SiteConfig["newsletter"]>): string {
  const title = escHtml(cfg.title || "Blijf op de hoogte");
  const text = escHtml(cfg.text || "Meld je aan voor nieuws en aanbiedingen.");
  return `<div id="nb-nl" style="max-width:560px;margin:32px auto;padding:22px 24px;background:#f8fafc;border:1px solid #e6e8ec;border-radius:16px;text-align:center;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif"><h3 style="margin:0 0 4px;font-size:19px;color:#1f2937">${title}</h3><p style="margin:0 0 14px;font-size:14px;color:#6b7280">${text}</p><div style="display:flex;gap:8px;max-width:400px;margin:0 auto"><input id="nb-nl-email" type="email" placeholder="jouw@email.nl" style="flex:1;border:1px solid #d7dbe0;border-radius:10px;padding:11px 13px;font-size:14px"><button id="nb-nl-btn" style="background:#1f2937;color:#fff;border:none;border-radius:10px;padding:11px 18px;font-size:14px;font-weight:600;cursor:pointer">Aanmelden</button></div><div id="nb-nl-msg" style="font-size:13px;margin-top:10px;min-height:16px"></div></div>
<script>(function(){var b=document.getElementById('nb-nl-btn'),i=document.getElementById('nb-nl-email'),m=document.getElementById('nb-nl-msg');if(!b)return;b.onclick=function(){var e=(i.value||'').trim();if(!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(e)){m.style.color='#c0392b';m.textContent='Vul een geldig e-mailadres in.';return;}b.disabled=true;fetch('/api/subscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pid:${projectId},email:e})}).then(function(r){return r.json();}).then(function(){m.style.color='#0f7a4d';m.textContent='Bedankt! Je bent aangemeld.';try{if(window.nbGoal)window.nbGoal('nieuwsbrief');}catch(x){}document.getElementById('nb-nl-email').style.display='none';b.style.display='none';}).catch(function(){m.style.color='#c0392b';m.textContent='Aanmelden mislukt. Probeer later opnieuw.';b.disabled=false;});};})();</script>`;
}

// A/B test: randomly assign a variant, swap one element's text for variant B, expose window.__nbVar
// so conversions get tagged with the variant. MUST be injected before the analytics beacon.
function abTestScript(cfg: NonNullable<SiteConfig["abTest"]>): string {
  const selector = escJs(cfg.selector || "");
  const variant = escJs(cfg.variant || "");
  return `<script>(function(){try{if(!${selector})return;var K='nb_ab',v=localStorage.getItem(K);if(v!=='A'&&v!=='B'){v=Math.random()<0.5?'A':'B';try{localStorage.setItem(K,v);}catch(e){}}window.__nbVar=v;if(v==='B'){var run=function(){try{var el=document.querySelector(${selector});if(el&&${variant})el.textContent=${variant};}catch(e){}};if(document.readyState!=='loading')run();else document.addEventListener('DOMContentLoaded',run);}}catch(e){}})();</script>`;
}

function leadWidget(projectId: number): string {
  return `<div id="nb-lead" data-pid="${projectId}"><style>
#nb-lead{--nb:#1f2937;position:fixed;right:20px;bottom:20px;z-index:2147483000;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}
#nb-lead *{box-sizing:border-box}
#nb-lead-btn{display:inline-flex;align-items:center;gap:8px;background:var(--nb);color:#fff;border:none;border-radius:999px;padding:13px 20px;font-size:14px;font-weight:600;cursor:pointer;box-shadow:0 8px 30px rgba(0,0,0,.22)}
#nb-lead-btn:hover{transform:translateY(-1px)}
#nb-lead-panel{display:none;position:absolute;right:0;bottom:60px;width:min(340px,86vw);background:#fff;color:var(--nb);border-radius:18px;box-shadow:0 20px 60px rgba(0,0,0,.28);padding:20px}
#nb-lead.open #nb-lead-panel{display:block}
#nb-lead h4{margin:0 0 4px;font-size:17px}
#nb-lead p.nb-sub{margin:0 0 14px;font-size:13px;color:#6b7280;line-height:1.5}
#nb-lead input,#nb-lead textarea{width:100%;border:1px solid #d7dbe0;border-radius:10px;padding:10px 12px;font-size:14px;margin-bottom:9px;font-family:inherit;color:var(--nb)}
#nb-lead textarea{resize:vertical;min-height:64px}
#nb-lead button.nb-send{width:100%;background:var(--nb);color:#fff;border:none;border-radius:10px;padding:11px;font-size:14px;font-weight:600;cursor:pointer}
#nb-lead button.nb-send:disabled{opacity:.6}
#nb-lead .nb-done{font-size:14px;color:#0f7a4d;padding:6px 0}
#nb-lead .nb-err{font-size:12px;color:#c0392b;margin:-4px 0 8px}
#nb-lead-close{position:absolute;top:12px;right:14px;border:none;background:none;font-size:18px;line-height:1;color:#9aa1aa;cursor:pointer}
</style>
<button id="nb-lead-btn" type="button" onclick="document.getElementById('nb-lead').classList.toggle('open')">Neem contact op</button>
<div id="nb-lead-panel">
<button id="nb-lead-close" type="button" onclick="document.getElementById('nb-lead').classList.remove('open')" aria-label="Sluiten">&times;</button>
<h4>Interesse? Laat je gegevens achter</h4>
<p class="nb-sub">Wil je een vrijblijvend gesprek? Vul je gegevens in en we nemen snel contact met je op.</p>
<div id="nb-lead-form">
<input id="nb-lead-name" type="text" placeholder="Je naam (optioneel)" autocomplete="name">
<input id="nb-lead-phone" type="tel" placeholder="Je telefoonnummer" autocomplete="tel">
<input id="nb-lead-email" type="email" placeholder="Je e-mailadres" autocomplete="email">
<textarea id="nb-lead-msg" placeholder="Waar kunnen we je mee helpen? (optioneel)"></textarea>
<div id="nb-lead-err" class="nb-err" style="display:none"></div>
<button class="nb-send" type="button" id="nb-lead-send">Versturen</button>
</div>
</div>
<script>(function(){var root=document.getElementById('nb-lead');var pid=root.getAttribute('data-pid');var send=document.getElementById('nb-lead-send');var err=document.getElementById('nb-lead-err');
function show(m){err.textContent=m;err.style.display=m?'block':'none';}
send.addEventListener('click',function(){
var phone=document.getElementById('nb-lead-phone').value.trim();var email=document.getElementById('nb-lead-email').value.trim();
var digits=phone.replace(/[^0-9]/g,'');var okmail=/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(email);
if(digits.length<6&&!okmail){show('Vul je telefoonnummer of e-mailadres in.');return;}
show('');send.disabled=true;send.textContent='Versturen…';
fetch('/api/projects/'+pid+'/lead',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:document.getElementById('nb-lead-name').value.trim(),phone:phone,email:email,message:document.getElementById('nb-lead-msg').value.trim(),page:location.href})})
.then(function(r){return r.json().catch(function(){return{};}).then(function(d){return{ok:r.ok,d:d};});})
.then(function(x){if(x.ok){try{if(window.nbGoal)window.nbGoal('contactaanvraag');}catch(e){}document.getElementById('nb-lead-form').innerHTML='<div class=\\'nb-done\\'>Bedankt! We nemen snel contact met je op.</div>';}else{show((x.d&&x.d.error)||'Versturen mislukt. Probeer het later opnieuw.');send.disabled=false;send.textContent='Versturen';}})
.catch(function(){show('Versturen mislukt. Probeer het later opnieuw.');send.disabled=false;send.textContent='Versturen';});
});})();</script></div>`;
}

// Big, non-removable watermark on FREE (unsubscribed) sites: a large diagonal band across the page
// plus the clickable corner badge. Disappears once the owner subscribes (€50/mo).
const NEBULA_WATERMARK = `<div aria-hidden="true" style="position:fixed;inset:0;z-index:2147483646;pointer-events:none;overflow:hidden;display:flex;align-items:center;justify-content:center"><span style="transform:rotate(-24deg);font:800 min(11vw,120px)/1 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:rgba(122,0,223,.14);white-space:nowrap;letter-spacing:.02em">Gemaakt met Nebula</span></div>`;

const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "application/javascript; charset=utf-8",
  json: "application/json; charset=utf-8", xml: "application/xml; charset=utf-8", txt: "text/plain; charset=utf-8",
  svg: "image/svg+xml", ics: "text/calendar; charset=utf-8",
};

// Third-party hosts that are NOT the imported site's own domain — never treat these as "internal".
const THIRD_PARTY = /(google|gstatic|googletagmanager|googlesyndication|doubleclick|gmpg\.org|wpconsent|wa\.me|whatsapp|facebook|fbcdn|instagram|youtube|youtu\.be|vimeo|twitter|x\.com|linkedin|tiktok|fonts\.|cdn|jsdelivr|unpkg|cloudflare|jquery|gravatar|schema\.org|w3\.org|wordpress\.org|websitedesigner\.nu)/i;

/** The imported site's original domain = the most frequent first-party host among its <a href> links. */
function detectOriginDomain(html: string): string {
  const counts: Record<string, number> = {};
  const re = /\bhref=["']https?:\/\/([^/"'?#\s]+)/gi; let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const h = m[1].toLowerCase().replace(/^www\./, "");
    if (THIRD_PARTY.test(h) || !h.includes(".")) continue;
    counts[h] = (counts[h] || 0) + 1;
  }
  let best = "", n = 0;
  for (const h of Object.keys(counts)) if (counts[h] > n) { n = counts[h]; best = h; }
  return n >= 3 ? best : ""; // need a few links to be confident it's the site's own domain
}

/**
 * Rewrite absolute links that point to the imported site's ORIGINAL domain into local paths, so
 * navigation stays on the NEW (published) domain. Only links whose target page exists locally are
 * rewritten; unknown pages keep their original absolute URL (they only live on the old site).
 */
export function rewriteInternalLinks(html: string, paths: string[]): string {
  const orig = detectOriginDomain(html);
  if (!orig) return html;
  const slugs = new Set(paths.filter((p) => /\.html$/i.test(p)).map((p) => p.replace(/\.html$/i, "").toLowerCase()));
  const re = new RegExp('(\\b(?:href|action)=)(["\'])https?:\\/\\/(?:www\\.)?' + orig.replace(/[.]/g, "\\.") + '(\\/[^"\']*)?\\2', "gi");
  return html.replace(re, (full, attr, q, rawPath) => {
    const raw = String(rawPath || "/");
    const hash = raw.includes("#") ? raw.slice(raw.indexOf("#")) : "";
    const slug = raw.split("#")[0].split("?")[0].replace(/^\/+|\/+$/g, "").toLowerCase();
    if (slug === "") return `${attr}${q}/${hash}${q}`;          // homepage
    if (slugs.has(slug)) return `${attr}${q}/${slug}${hash}${q}`; // local page (serveProjectSite resolves .html)
    return full;                                                  // not imported locally → leave original
  });
}

// Imported sites lazy-load images (the REAL url sits in data-src/srcset, a 1×1 data: placeholder in
// src) and rely on the theme's JS for the mobile hamburger — but that JS lives on the ORIGINAL domain
// and 404s once the domain points at Nebula, so on a phone the images stay blank and the menu won't
// open. Fix without shipping the fragile WordPress JS: promote the real image to src (shows without
// JS) and inject a tiny self-contained menu toggle.
export function unlazyImages(html: string): string {
  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    const cur = (tag.match(/\bsrc=["']([^"']+)["']/i) ?? [])[1] ?? "";
    if (cur && !/^data:/i.test(cur)) return tag; // already has a real src
    let real = "";
    for (const n of ["data-src", "data-lazy-src", "data-original", "data-lazy"]) {
      const v = (tag.match(new RegExp('\\b' + n + '=["\']([^"\']+)["\']', "i")) ?? [])[1];
      if (v && !/^data:/i.test(v)) { real = v; break; }
    }
    if (!real) {
      const ss = (tag.match(/\bsrcset=["']([^"']+)["']/i) ?? [])[1] ?? (tag.match(/\bdata-srcset=["']([^"']+)["']/i) ?? [])[1] ?? "";
      const f = ss.split(",")[0].trim().split(/\s+/)[0];
      if (f && !/^data:/i.test(f)) real = f;
    }
    if (!real) return tag;
    return cur ? tag.replace(/\bsrc=["'][^"']*["']/i, `src="${real}"`) : tag.replace(/<img\b/i, `<img src="${real}"`);
  });
}

// Imported sites hide entrance-animated elements with `.elementor-invisible{visibility:hidden}` and rely
// on the theme JS (which 404s here) to reveal them on scroll — so without it those elements/images
// "flash then disappear". Force them visible (no animation, but shown).
export const RENDER_FIX_STYLE = `<style data-nebula-render-fix>.elementor-invisible{visibility:visible !important;opacity:1 !important}
/* Keep accessibility skip-links visually hidden (they became visible "Skip to main content" text on
   every page once the theme's own screen-reader CSS was out-competed). Still shown on keyboard focus. */
.screen-reader-text:not(:focus):not(:focus-within),.skip-link:not(:focus),.ea11y-skip-to-content-link:not(:focus),a[href="#content"]:not(:focus):not([class*="button"]):not([class*="btn"]),[class*="skip-to-content"]:not(:focus){position:absolute !important;width:1px !important;height:1px !important;padding:0 !important;margin:-1px !important;overflow:hidden !important;clip:rect(0,0,0,0) !important;white-space:nowrap !important;border:0 !important}
/* Imported Elementor video widgets ship WITHOUT an <iframe> (their frontend JS builds it on the
   original domain, which never loads here). We inject the iframe (see VIDEO_EMBED_SCRIPT) and make the
   embed fluid so it fills the column and renders correctly on mobile. */
.elementor-widget-video .elementor-wrapper{position:relative;width:100%;aspect-ratio:16/9;height:auto;overflow:hidden}
.elementor-widget-video .elementor-video{position:absolute;inset:0;width:100%;height:100%}
.elementor-widget-video iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
/* Stop the nav-menu widget (and its container) from clipping its own opened mobile dropdown — that was
   cutting the hamburger menu off so you couldn't see all items. */
.elementor-widget-nav-menu,.elementor-widget-nav-menu>.elementor-widget-container{overflow:visible !important}
/* Mobile menu submenus: render INLINE within the list (full width, indented) instead of floating off to
   the side as a clipped "island". Scoped to the mobile dropdown <nav>, so desktop flyout menus are
   untouched. The whole nav is hidden when the menu is closed, so this only shows while it's open. */
nav.elementor-nav-menu--dropdown .sub-menu{position:static !important;left:auto !important;right:auto !important;top:auto !important;width:100% !important;min-width:0 !important;max-width:100% !important;max-height:none !important;display:block !important;visibility:visible !important;opacity:1 !important;box-shadow:none !important;transform:none !important;padding-left:1.2em}
</style>`;

// Floating "Boek nu" pill shown on every page of a site that has a booking system — an always-present
// booking CTA in addition to the nav link. Links to the booking app; hidden on the booking page itself.
export const BOOK_FLOAT_BUTTON = `<a href="/booking-app.html" data-nebula-book aria-label="Boek nu" style="position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:99998;display:inline-flex;align-items:center;gap:8px;background:#111827;color:#fff;font:600 15px/1.1 system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;padding:14px 24px;border-radius:999px;text-decoration:none;box-shadow:0 10px 28px rgba(17,24,39,.28)">📅 Boek nu</a>`;

// Whether the floating booking button shows on this page, per the .nebula-book-scope setting.
// Default is OFF — the pill only appears when explicitly enabled (scope "all" or a page list),
// so adding a booking system no longer auto-injects an unwanted floating "Boek nu" button.
// "all" → every page; empty/"off"/"none" → nowhere; otherwise a comma/space list of page paths.
export function showBookButtonOn(pagePath: string, scopeRaw?: string): boolean {
  const scope = (scopeRaw || "off").trim().toLowerCase();
  if (scope === "all") return true;
  if (scope === "" || scope === "off" || scope === "none" || scope === "geen") return false;
  const page = pagePath.toLowerCase().replace(/\.html$/, "");
  return scope.split(/[\s,]+/).filter(Boolean).some((s) => s.replace(/\.html$/, "") === page);
}

// Site-wide restyle ("maak de site mooier"): one managed CSS file the AI writes, injected on EVERY
// imported page (after the imported CSS so its !important refinements win) — a whole-site transformation
// instead of only index.html/the hero.
export const NEBULA_RESTYLE_PATH = ".nebula-restyle.css";

// Self-contained mobile-menu toggle: makes the hamburger open the menu even though the theme's own JS
// (on the original domain) never loads. Captures clicks on a *-menu-toggle and shows the nearest menu.
const MOBILE_MENU_SCRIPT = `<script>(function(){
function findDd(t){var scope=t.closest(".elementor-widget-nav-menu,nav,header")||document;return scope.querySelector("nav.elementor-nav-menu--dropdown")||scope.querySelector(".elementor-nav-menu__container:not(.elementor-nav-menu--main)")||scope.querySelector("ul.elementor-nav-menu")||scope.querySelector(".sub-menu");}
function show(t,dd){var r=t.getBoundingClientRect();var topY=Math.max(0,Math.round(r.bottom));dd.style.setProperty("display","block","important");dd.style.setProperty("position","fixed","important");dd.style.setProperty("top",topY+"px","important");dd.style.setProperty("left","0","important");dd.style.setProperty("right","0","important");dd.style.setProperty("width","100%","important");dd.style.setProperty("max-width","100%","important");dd.style.setProperty("max-height",(window.innerHeight-topY-8)+"px","important");dd.style.setProperty("overflow-y","auto","important");dd.style.setProperty("z-index","99999","important");dd.style.setProperty("transition","none","important");dd.style.padding="8px 0";var bg="";try{bg=getComputedStyle(dd).backgroundColor;}catch(x){}if(!bg||bg==="rgba(0, 0, 0, 0)"||bg==="transparent")dd.style.background="#fff";}
function hide(dd){dd.style.setProperty("display","none","important");["position","top","left","right","width","max-width","max-height","overflow-y","z-index","background","padding","transition"].forEach(function(p){dd.style.removeProperty(p);});}
document.addEventListener("click",function(e){var t=e.target&&e.target.closest?e.target.closest('.elementor-menu-toggle,[class*="menu-toggle"]'):null;if(!t)return;t=t.closest(".elementor-menu-toggle")||t.closest('[class~="menu-toggle"]')||t;e.preventDefault();e.stopPropagation();var dd=findDd(t);if(!dd)return;var open=dd.getAttribute("data-nebmenu")!=="1";dd.setAttribute("data-nebmenu",open?"1":"0");t.classList.toggle("elementor-active",open);t.setAttribute("aria-expanded",open?"true":"false");dd.setAttribute("aria-hidden",open?"false":"true");if(open)show(t,dd);else hide(dd);},true);
})();</script>`;

// Imported Elementor video widgets carry the YouTube/Vimeo URL in data-settings but no <iframe> (the
// theme's frontend JS that builds it lives on the original domain and never loads). Build the iframe
// ourselves from data-settings so the videos actually play — on desktop AND mobile.
const VIDEO_EMBED_SCRIPT = `<script>(function(){function embed(u){if(!u)return"";u=String(u);var m;if(m=u.match(/(?:youtu\\.be\\/|youtube(?:-nocookie)?\\.com\\/(?:watch\\?v=|embed\\/|v\\/|shorts\\/))([\\w-]{6,})/i))return"https://www.youtube.com/embed/"+m[1];if(m=u.match(/vimeo\\.com\\/(?:video\\/)?(\\d+)/i))return"https://player.vimeo.com/video/"+m[1];return"";}var ws=document.querySelectorAll(".elementor-widget-video");for(var i=0;i<ws.length;i++){var w=ws[i];if(w.querySelector("iframe"))continue;var s={};try{s=JSON.parse(w.getAttribute("data-settings")||"{}");}catch(e){}var src=embed(s.youtube_url||s.vimeo_url||s.link||s.url||"");if(!src)continue;var slot=w.querySelector(".elementor-video")||w.querySelector(".elementor-wrapper")||w;var f=document.createElement("iframe");f.src=src;f.setAttribute("frameborder","0");f.setAttribute("allowfullscreen","");f.setAttribute("allow","accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope;picture-in-picture");f.setAttribute("loading","lazy");f.title="Video";slot.innerHTML="";slot.appendChild(f);}})();</script>`;

// Imported "ticker"/marquee bars scroll via the site's OWN JS (which doesn't load here), so they sat
// still. Drive the moving track ourselves: scroll it left every frame and, because the items are
// identical repeats, reset by exactly one item-width when it passes — a seamless loop (no jump/"bug").
export const TICKER_SCRIPT = `<script>(function(){function run(tr){if(!tr||tr.__nebTick)return;tr.__nebTick=1;var x=0;var cs=getComputedStyle(tr);var gap=parseFloat(cs.columnGap||cs.gap||"0")||0;function step(){x-=0.7;var f=tr.firstElementChild;if(f){var iw=f.getBoundingClientRect().width+gap;if(iw>0){while(x<=-iw)x+=iw;}}tr.style.transform="translateX("+x.toFixed(2)+"px)";requestAnimationFrame(step);}requestAnimationFrame(step);}function init(){var sel="[data-hero-ticker]>a,[data-hero-ticker]>div,[data-ticker]>*,.marquee__inner,.marquee-content,.ticker__track";document.querySelectorAll(sel).forEach(run);}if(document.readyState!=="loading")init();else document.addEventListener("DOMContentLoaded",init);})();</script>`;

// Short stable hash (djb2) for cache-busting externalized CSS — changes only when the content changes.
function shortHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

// Build the canonical sitemap URL list from the site's page paths. Content pages use the trailing-slash
// folder form (/X/) where an X/index.html exists, else the flat /X.html; blog articles are always
// collapsed to a single /blog/<slug>.html (matching each article's own canonical), so a flat file and a
// nested make-over copy of the same article can never both appear. Pure + exported for testing.
export function sitemapUrlsFromPaths(paths: string[]): string[] {
  const pages = paths.filter((x) => /\.html$/i.test(x) && !/^(_backup-|makeover-)/i.test(x) && x !== "booking-app.html");
  const blogSlugs = new Set<string>();
  for (const x of pages) {
    const nest = x.match(/^blog\/([^/]+)\/index\.html$/i);
    const flat = x.match(/^blog\/([^/]+)\.html$/i);
    if (nest) blogSlugs.add(nest[1]);
    else if (flat && flat[1].toLowerCase() !== "index") blogSlugs.add(flat[1]);
  }
  const nonBlog = pages.filter((x) => !/^blog\//i.test(x));
  const folderSlugs = new Set(nonBlog.filter((x) => /\/index\.html$/i.test(x)).map((x) => x.replace(/\/index\.html$/i, "")));
  const urls = new Set<string>(["/"]);
  for (const s of folderSlugs) urls.add("/" + s + "/");
  for (const x of nonBlog) {
    if (/\/index\.html$/i.test(x) || x === "index.html") continue;
    if (folderSlugs.has(x.replace(/\.html$/i, ""))) continue;
    urls.add("/" + x);
  }
  for (const s of blogSlugs) urls.add("/blog/" + s + ".html");
  return [...urls].sort();
}

/**
 * Does the project actually have a real page for this request path? Mirrors serveProjectSite's file
 * resolution but WITHOUT the homepage fallback — so a 301-redirect domain can send known paths to their
 * equivalent and unknown paths to the clean homepage URL (never a soft-404 homepage clone at a junk URL).
 */
export async function projectHasPage(projectId: number, reqPath: string): Promise<boolean> {
  const published = await getPublishedFiles(projectId);
  const paths: string[] = published
    ? Object.keys(published)
    : (await db.select({ path: projectFiles.path }).from(projectFiles).where(eq(projectFiles.projectId, projectId))).map((r) => r.path);
  if (!paths.length) return false;
  let p = decodeURIComponent((reqPath || "/").split("?")[0].replace(/^\/+/, ""));
  if (p === "" || p.endsWith("/")) p += "index.html";
  const set = new Set(paths);
  if (set.has(p)) return true;
  if (!/\.[a-z0-9]+$/i.test(p) && set.has(p + ".html")) return true;
  return false;
}

export async function serveProjectSite(projectId: number, req: Request, res: Response): Promise<void> {
  // Serve the PUBLISHED snapshot when present (draft → publish). Fall back to live files for
  // projects that haven't used publish yet (back-compat — they stay live as before).
  const published = await getPublishedFiles(projectId);
  const rows = published
    ? Object.entries(published).map(([path, f]) => ({ path, content: f.content, language: f.language }))
    : await db.select().from(projectFiles).where(eq(projectFiles.projectId, projectId));
  if (!rows.length) { res.status(404).send("Site niet gevonden."); return; }
  let p = decodeURIComponent((req.path || "/").replace(/^\/+/, ""));
  // Server-functies: /fn/<naam> executes the project's api/<naam>.js in an isolated short-lived
  // process — real backend behaviour for customer sites without an external server.
  if (p.startsWith("fn/")) { await handleSiteFunction(projectId, p.slice(3).replace(/\/.*$/, ""), rows, req, res); return; }
  // IndexNow verification file — the same key on every domain we serve, proving host control so we can
  // submit this site's URLs to Bing/Yandex. Answered before the normal file lookup.
  if (p === `${INDEXNOW_KEY}.txt`) { res.setHeader("Content-Type", "text/plain; charset=utf-8"); res.send(INDEXNOW_KEY); return; }
  // sitemap.xml is generated LIVE from the current pages — never a stored file that can go stale in the
  // published snapshot. This guarantees every content page stays in the sitemap for every customer,
  // automatically, so enabling blog/location SEO can never silently drop the studio's own pages again.
  if (p === "sitemap.xml") {
    const host = (req.hostname || "").replace(/^www\./i, "") || "";
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapUrlsFromPaths(rows.map((r) => r.path)).map((u) => `  <url><loc>${esc("https://" + host + u)}</loc></url>`).join("\n")}\n</urlset>\n`;
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.send(xml);
    return;
  }
  // Externalized imported CSS / fonts — served as ONE cacheable file instead of being inlined into every
  // page (that inlined blob was ~5 MB per page). The browser now downloads it once and reuses it across
  // pages → big page-speed / Core Web Vitals win. Cache-busted via the ?v=<hash> the <link> carries.
  if (p === "_nebula/imported.css" || p === "_nebula/fonts.css") {
    const src = p === "_nebula/fonts.css" ? ".nebula-fonts.css" : ".nebula-imported.css";
    const blob = rows.find((r) => r.path === src)?.content;
    if (blob) { res.setHeader("Content-Type", "text/css; charset=utf-8"); res.setHeader("Cache-Control", "public, max-age=31536000, immutable"); res.send(blob); return; }
    res.status(404).send("/* not found */"); return;
  }
  if (p === "" || p.endsWith("/")) p += "index.html";
  let file = rows.find((f) => f.path === p);
  if (!file && !/\.[a-z0-9]+$/i.test(p)) file = rows.find((f) => f.path === p + ".html"); // extensionless → .html
  // Imported binary asset (image/font/media)? Served ONE at a time from its own table (never bundled
  // into the site blob) so a faithful import can't reintroduce the load-everything OOM.
  if (!file) {
    const [asset] = await db.select().from(importAssets).where(and(eq(importAssets.projectId, projectId), eq(importAssets.path, p)));
    if (asset) {
      res.setHeader("Content-Type", asset.contentType || "application/octet-stream");
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      res.send(Buffer.from(asset.data, "base64"));
      return;
    }
  }
  if (!file) file = rows.find((f) => f.path === "index.html");                            // fallback: homepage
  if (!file) { res.status(404).send("Pagina niet gevonden."); return; }
  const ext = (file.path.split(".").pop() || "html").toLowerCase();
  res.setHeader("Content-Type", TYPES[ext] || "text/plain; charset=utf-8");
  let content = file.content;
  // On a published custom domain / subdomain the URL has no `/projects/<id>/` segment, so the
  // booking app can't read its project id from the path. Inject it as a global so the server-backed
  // features (booking, login, payments) work. The booking app's projId() prefers window.__BA_PID__.
  if (ext === "html") {
    // Keep navigation on the new domain: rewrite links to the imported site's original domain.
    content = rewriteInternalLinks(content, rows.map((r) => r.path));
    // Belt-and-suspenders: neutralise any <base href="https://ORIGINAL/…"> tag. Left in place it makes
    // every relative link/asset resolve to the OLD site, so visiting the published domain bounces the
    // visitor to the original site. Rewrite to root "/" (assets are absolute or /assets/… → unaffected).
    content = content.replace(/(<base\b[^>]*\bhref=)(["'])https?:\/\/[^"']*\2/gi, "$1$2/$2");
    const tag = `<script>window.__BA_PID__=${projectId};</script>`;
    if (/<head[^>]*>/i.test(content)) content = content.replace(/<head[^>]*>/i, (m) => m + tag);
    else if (/<body[^>]*>/i.test(content)) content = content.replace(/<body[^>]*>/i, (m) => m + tag);
    else content = tag + content;
    // Google Search Console verification: if this project connected GSC, keep its meta tag in the <head>
    // on every page (Google re-checks it, so it must stay present, not just during initial verification).
    try {
      const [gsc] = await db.select().from(projectGsc).where(eq(projectGsc.projectId, projectId));
      const vtag = gsc?.verifyTag || "";
      if (vtag && !content.includes("google-site-verification")) {
        content = /<head[^>]*>/i.test(content) ? content.replace(/<head[^>]*>/i, (m) => m + vtag) : vtag + content;
      }
    } catch { /* best-effort */ }
    // The GENERATED booking-app page is self-contained: injecting the imported site's fonts/CSS
    // would override its own nav/hero styling (nav-colour mismatch), so skip both for it.
    const isBookingApp = file.path === "booking-app.html";
    // Self-contained fonts (survive edits): inject the stored @font-face blob (data: URIs) at serve
    // time, so imported icon-fonts render instead of "tofu" boxes.
    // Reference the fonts/CSS as EXTERNAL cacheable files (served above at /_nebula/*.css) instead of
    // inlining the (up to ~5 MB) blob into every page. One download, reused across pages → far lighter
    // pages and much better Core Web Vitals. ?v=<hash> busts the cache whenever the blob changes.
    const fontBlob = isBookingApp ? undefined : rows.find((r) => r.path === ".nebula-fonts.css")?.content;
    if (fontBlob) {
      const st = `<link rel="stylesheet" data-nebula-fonts href="/_nebula/fonts.css?v=${shortHash(fontBlob)}">`;
      content = /<\/head>/i.test(content) ? content.replace(/<\/head>/i, st + "</head>") : content.replace(/<head[^>]*>/i, (m) => m + st);
    }
    // Imported CSS: injected after fonts so it wins over the original cross-origin <link> stylesheets
    // (which 404 once the domain points at Nebula).
    const cssBlob = isBookingApp ? undefined : rows.find((r) => r.path === ".nebula-imported.css")?.content;
    if (cssBlob) {
      const st = `<link rel="stylesheet" data-nebula-imported-css href="/_nebula/imported.css?v=${shortHash(cssBlob)}">`;
      content = /<\/head>/i.test(content) ? content.replace(/<\/head>/i, st + "</head>") : content.replace(/<head[^>]*>/i, (m) => m + st);
    }
    // Site-wide restyle (after the imported CSS so it wins) — applies the "make it prettier" refinements
    // to EVERY page, not just index.html.
    const restyleBlob = isBookingApp ? undefined : rows.find((r) => r.path === NEBULA_RESTYLE_PATH)?.content;
    if (restyleBlob) {
      const st = `<style data-nebula-restyle>${restyleBlob}</style>`;
      content = /<\/head>/i.test(content) ? content.replace(/<\/head>/i, st + "</head>") : content.replace(/<head[^>]*>/i, (m) => m + st);
    }
    // Mobile fixes for imported pages: show lazy-loaded images without the (404'ing) theme JS, and give
    // the hamburger a working toggle. Skip the self-contained booking-app page.
    if (!isBookingApp) {
      content = unlazyImages(content);
      content = /<\/head>/i.test(content) ? content.replace(/<\/head>/i, RENDER_FIX_STYLE + "</head>") : RENDER_FIX_STYLE + content;
      const tail = MOBILE_MENU_SCRIPT + VIDEO_EMBED_SCRIPT + TICKER_SCRIPT;
      content = /<\/body>/i.test(content) ? content.replace(/<\/body>/i, tail + "</body>") : content + tail;
      // Strip a leftover duplicate "blog.html" nav link (the old SEO engine added one next to the site's
      // own Blog link) — server-side, so it disappears regardless of any re-publish state.
      content = content
        .replace(/<li\b(?:(?!<\/li>)[\s\S])*?\bhref=["']blog\.html["'](?:(?!<\/li>)[\s\S])*?<\/li>/gi, "")
        .replace(/<a\b[^>]*\bhref=["']blog\.html["'][\s\S]*?<\/a>/gi, "");
      // On the studio's OWN blog page, list the published SEO articles — built server-side from the DB,
      // so it's always current and never depends on the re-publish/snapshot mechanism. Identify the blog
      // page by its filename ("blog…"), excluding the article pages (blog/…) and the redirect stub.
      if (/(^|\/)blog[\w-]*(\.html$|\/index\.html$)/i.test(file.path) && file.path !== "blog.html" && !/^blog\//i.test(file.path)) {
        try {
          const arts = await db.select().from(seoArticles).where(and(eq(seoArticles.projectId, projectId), eq(seoArticles.status, "published")));
          if (arts.length) {
            const e = (s: string) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
            const cards = arts.map((a) => `<a href="/blog/${e(a.slug)}.html" style="display:block;background:#fff;border:1px solid #e6e8ec;border-radius:12px;padding:16px 18px;margin:0 0 12px;text-decoration:none;color:#1f2937"><span style="display:block;font-size:18px;font-weight:600;color:#7a00df">${e(a.title)}</span></a>`).join("");
            const section = `<section data-nebula-blog-list style="max-width:760px;margin:40px auto;padding:0 20px;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif"><h2 style="font-size:26px;margin:0 0 16px;color:#1f2937">Blog</h2>${cards}</section>`;
            content = /data-nebula-blog-list/i.test(content)
              ? content.replace(/<section\b[^>]*data-nebula-blog-list[\s\S]*?<\/section>/i, section)
              : (/<footer\b/i.test(content) ? content.replace(/<footer\b/i, section + "\n<footer") : content.replace(/<\/body>/i, section + "</body>"));
          }
        } catch { /* best-effort */ }
      }
    }
    // Floating "Boek nu" CTA on a site that has a booking system (except the booking page). Scope is
    // controlled by an optional .nebula-book-scope file the AI writes: "all" (default) | "off" | a
    // page path (or comma list) to limit it to specific page(s).
    if (!isBookingApp && rows.some((r) => r.path === "booking-app.html") && showBookButtonOn(file.path, rows.find((r) => r.path === ".nebula-book-scope")?.content)) {
      content = /<\/body>/i.test(content) ? content.replace(/<\/body>/i, BOOK_FLOAT_BUTTON + "</body>") : content + BOOK_FLOAT_BUTTON;
    }
    // Opt-in growth widgets (not on the booking-app page): lead capture, exit pop-up, A/B test,
    // welcome-back banner, newsletter sign-up.
    if (!isBookingApp) {
      const [prj] = await db.select({ leadEmail: projects.leadEmail, exitPopup: projects.exitPopup, siteConfig: projects.siteConfig }).from(projects).where(eq(projects.id, projectId));
      const inject = (w: string) => { content = /<\/body>/i.test(content) ? content.replace(/<\/body>/i, w + "</body>") : content + w; };
      let sc: SiteConfig = {};
      try { sc = prj?.siteConfig ? JSON.parse(prj.siteConfig) as SiteConfig : {}; } catch { /* ignore */ }
      // A/B first so window.__nbVar is set before the beacon.
      if (sc.abTest?.enabled && sc.abTest.selector) inject(abTestScript(sc.abTest));
      if (prj?.leadEmail) inject(leadWidget(projectId));
      if (prj?.exitPopup) { try { const cfg = JSON.parse(prj.exitPopup) as ExitCfg; if (cfg?.enabled) inject(exitPopupWidget(cfg)); } catch { /* skip */ } }
      if (sc.welcomeBack?.enabled) inject(welcomeBackWidget(sc.welcomeBack));
      if (sc.newsletter?.enabled) inject(newsletterWidget(projectId, sc.newsletter));
    }
    // Free (unsubscribed) sites carry a big non-removable Nebula watermark + a clickable corner badge.
    if (!(await ownerSubscribed(projectId))) {
      const mark = NEBULA_WATERMARK + NEBULA_BADGE;
      content = /<\/body>/i.test(content) ? content.replace(/<\/body>/i, mark + "</body>") : content + mark;
    }
    // Visitor analytics beacon on every hosted page (booking-app included) — counts real traffic.
    const beacon = analyticsBeacon(projectId);
    content = /<\/body>/i.test(content) ? content.replace(/<\/body>/i, beacon + "</body>") : content + beacon;
  }
  res.send(content);
}
