/**
 * Full reverse-proxy for imported-site previews.
 *
 * Route: /api/site-proxy/:domain/*
 *
 * The preview iframe's <base href> is set to "/api/site-proxy/{domain}/" so every
 * relative URL the site makes (scripts, styles, AJAX) automatically routes here.
 * The iframe has `allow-same-origin`, giving it origin localhost:{API_PORT}, so
 * requests are same-origin — no null-origin CORS problem.
 *
 * Session cookies: the iframe sends X-Preview-Session (set by the injected patcher)
 * or falls back to the ?__sid query param. Cookies received from the origin server
 * are stored per-session in the in-memory jar and forwarded on subsequent requests.
 */
import { Router } from "express";
import type { Request, Response } from "express";
import { readCookies, storeCookies, isPrivateHostname } from "../lib/preview-session";

const router = Router();

async function handleSiteProxy(req: Request, res: Response): Promise<void> {
  // Parse domain and path from the URL
  // req.path here is like "/shop.myshopify.com/cart/add.js"
  const rawPath = req.path.replace(/^\/site-proxy/, ""); // "/shop.myshopify.com/cart/add.js"
  const slashIdx = rawPath.indexOf("/", 1);
  const domain = rawPath.slice(1, slashIdx < 0 ? undefined : slashIdx);
  const restPath = slashIdx < 0 ? "/" : rawPath.slice(slashIdx);
  const rawQuery = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  // Strip __sid and __inject from the forwarded query string
  const forwardQuery = rawQuery
    .replace(/([?&])__sid=[^&]*/g, "")
    .replace(/([?&])__inject=[^&]*/g, "")
    .replace(/^&/, "?");
  const shouldInject = req.query["__inject"] === "1";

  if (!domain || isPrivateHostname(domain)) {
    res.status(403).send("Forbidden"); return;
  }

  const targetUrl = `https://${domain}${restPath}${forwardQuery}`;
  const sid =
    (req.headers["x-preview-session"] as string) ||
    (req.query["__sid"] as string) ||
    "";

  const cookieHdr = sid ? readCookies(sid, domain) : "";
  const siteOrigin = `https://${domain}`;

  const fwdHeaders: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": (req.headers["accept"] as string) || "*/*",
    "Accept-Language": "nl-NL,nl;q=0.9,en;q=0.8",
    "Accept-Encoding": "identity", // disable gzip so we can read the body
    "Origin": siteOrigin,
    "Referer": siteOrigin + "/",
    "X-Requested-With": (req.headers["x-requested-with"] as string) || "XMLHttpRequest",
  };
  if (cookieHdr) fwdHeaders["Cookie"] = cookieHdr;
  const reqCt = req.headers["content-type"] as string | undefined;
  if (reqCt) fwdHeaders["Content-Type"] = reqCt;

  let body: string | undefined;
  const method = req.method.toUpperCase();
  if (method === "POST" || method === "PUT" || method === "PATCH") {
    if (reqCt?.includes("application/x-www-form-urlencoded") && req.body && typeof req.body === "object") {
      body = new URLSearchParams(req.body as Record<string, string>).toString();
    } else if (reqCt?.includes("application/json") && req.body != null) {
      body = JSON.stringify(req.body);
    }
  }

  try {
    const upstream = await fetch(targetUrl, {
      method,
      headers: fwdHeaders,
      body,
      redirect: "follow",
    });

    // Store Set-Cookie
    if (sid) {
      const setCookies: string[] =
        typeof (upstream.headers as { getSetCookie?: () => string[] }).getSetCookie === "function"
          ? (upstream.headers as { getSetCookie: () => string[] }).getSetCookie()
          : upstream.headers.get("set-cookie")
            ? [upstream.headers.get("set-cookie")!]
            : [];
      if (setCookies.length) storeCookies(sid, domain, setCookies);
    }

    const ct = upstream.headers.get("content-type") ?? "";

    // __inject=1: rewrite HTML so the page loads correctly inside our preview iframe.
    // This lets live Shopify/WooCommerce product pages navigate through our proxy.
    if (shouldInject && ct.includes("text/html") && upstream.status === 200) {
      let html = await upstream.text();

      // Rewrite or inject <base href> so all relative URLs resolve through site-proxy
      const hasBase = /<base\s[^>]*href=/i.test(html);
      if (hasBase) {
        html = html.replace(/<base\s[^>]*href=["'][^"']*["'][^>]*>/i, `<base href="/api/site-proxy/${domain}/">`);
      } else {
        html = html.replace(/<head[^>]*>/i, (m) => m + `<base href="/api/site-proxy/${domain}/">`);
      }

      // Strip Next.js runtime if present — it would hydrate against the wrong URL and blank the page
      const isNextJs = /<script\b[^>]*\bid=["']__NEXT_DATA__["']/i.test(html);
      if (isNextJs) {
        html = html
          .replace(/<script\b[^>]*\bsrc=["'][^"']*_next\/[^"']*["'][^>]*>[\s\S]*?<\/script>/gi, "")
          .replace(/<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>[\s\S]*?<\/script>/gi, "");
      }

      const sidJson = JSON.stringify(sid);
      const hostJson = JSON.stringify(domain);

      // Inject session patcher + navigation interceptors (no stored KEYS in live-proxy mode)
      const injectScript = `<script>
(function(){
"use strict";
var SID=${sidJson};
var HOST=${hostJson};
function nm(h){return(h||"").replace(/^www\\./,"").toLowerCase();}
function rewriteUrl(url){
  var s=String(url);
  var u;try{u=new URL(s);}catch(e){u=null;}
  if(u){
    if((u.protocol!=="http:"&&u.protocol!=="https:")||nm(u.hostname)!==nm(HOST))return null;
    return"/api/site-proxy/"+u.hostname+u.pathname+u.search+u.hash;
  }
  if(s.startsWith("//"))return"/api/site-proxy/"+s.slice(2);
  if(s.startsWith("/"))return"/api/site-proxy/"+HOST+s;
  if(/^(data:|blob:|javascript:|mailto:|tel:)/i.test(s))return null;
  try{var u2=new URL(s,"https://"+HOST+"/");return"/api/site-proxy/"+HOST+u2.pathname+u2.search+u2.hash;}catch(e2){}
  return null;
}
function addSid(h){
  if(!h)h={};
  if(typeof Headers!=="undefined"&&h instanceof Headers){h.set("X-Preview-Session",SID);}
  else{h=Object.assign({},h,{"X-Preview-Session":SID});}
  return h;
}
if(typeof fetch!=="undefined"){
  var _f=window.fetch.bind(window);
  window.fetch=function(inp,ini){
    var url=typeof inp==="string"?inp:(inp&&inp.url!=null?String(inp.url):String(inp));
    ini=ini?Object.assign({},ini):{};
    ini.headers=addSid(ini.headers);
    var px=rewriteUrl(url);
    if(px)return _f(px,ini);
    return _f(inp,ini);
  };
}
if(typeof XMLHttpRequest!=="undefined"){
  var _xo=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(){
    var args=Array.prototype.slice.call(arguments);
    if(args[1]){var px=rewriteUrl(args[1]);if(px)args[1]=px;}
    var ret=_xo.apply(this,args);
    if(SID)this.setRequestHeader("X-Preview-Session",SID);
    return ret;
  };
}
// Click handler — live proxy navigation for same-site, block external
document.addEventListener("click",function(e){
  var a=e.target&&e.target.closest?e.target.closest("a[href]"):null;
  if(!a)return;
  if(e.defaultPrevented)return;
  var raw=(a.getAttribute("href")||"").trim();
  if(!raw||raw.charAt(0)==="#")return;
  if(/^(mailto:|tel:|sms:|javascript:)/i.test(raw))return;
  var u;try{u=new URL(a.href,document.baseURI);}catch(err){return;}
  var sitePath=u.pathname;
  if(u.hostname===location.hostname&&u.pathname.startsWith("/api/site-proxy/")){
    sitePath=u.pathname.replace(/^\\/api\\/site-proxy\\/[^\\/]+/,"");
  }
  if(nm(u.hostname)===nm(HOST)){
    e.preventDefault();
    var liveUrl="/api/site-proxy/"+HOST+sitePath+"?__inject=1&__sid="+SID;
    if(u.search)liveUrl+="&"+u.search.slice(1);
    window.location.href=liveUrl;
    return;
  }
  e.preventDefault();
  if(raw&&raw.charAt(0)!=="#"){
    var id="__bd_toast";
    var prev=document.getElementById(id);
    if(prev){clearTimeout(prev.__t);prev.parentNode&&prev.parentNode.removeChild(prev);}
    var el=document.createElement("div");el.id=id;
    el.textContent="Externe link geblokkeerd in previewmodus.";
    el.style.cssText="position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:rgba(20,20,30,.92);color:#fff;padding:10px 20px;border-radius:8px;font-size:13px;z-index:2147483647;pointer-events:none;";
    document.body.appendChild(el);
    el.__t=setTimeout(function(){el.parentNode&&el.parentNode.removeChild(el);},3000);
  }
},true);
document.addEventListener("submit",function(e){if(e.defaultPrevented)return;e.preventDefault();},false);
(function(){
  var _ps=history.pushState.bind(history);
  var _rs=history.replaceState.bind(history);
  function swallow(){}
  history.pushState=swallow;
  history.replaceState=swallow;
})();
})();
</script>`;

      html = html.replace(/<head[^>]*>/i, (m) => m + injectScript);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.status(200).send(html);
      return;
    }

    if (ct) res.setHeader("Content-Type", ct);

    // Pass through most headers (skip hop-by-hop and security headers that would break framing)
    const passthroughHeaders = [
      "cache-control", "etag", "last-modified", "expires",
      "content-language", "content-length",
    ];
    for (const h of passthroughHeaders) {
      const v = upstream.headers.get(h);
      if (v) res.setHeader(h, v);
    }

    res.status(upstream.status);
    res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch (err) {
    console.error("[site-proxy] error proxying", targetUrl, err);
    res.status(502).json({ error: "upstream error" });
  }
}

// Match all methods and all paths under /site-proxy
router.use("/site-proxy", handleSiteProxy);

export default router;
