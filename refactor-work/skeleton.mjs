import fs from 'node:fs';
const html = fs.readFileSync('refactor-work/raw/index.html','utf8');
const collapse = (s)=> s
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, m=>`[STYLE ${m.length}c]`)
  .replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (m,a,b)=> /src=/i.test(a)?`<script${a}></script>`:`[SCRIPT ${b.length}c]`);
const head = (html.match(/<head[^>]*>([\s\S]*?)<\/head>/i)||[])[0]||'';
fs.writeFileSync('refactor-work/inspect/head.txt', collapse(head));
// body skeleton: collapse styles/scripts, then keep only tags (drop text nodes) to reveal structure
let body = (html.match(/<body[\s\S]*<\/body>/i)||[])[0]||'';
body = collapse(body)
  .replace(/<!--[\s\S]*?-->/g,'')             // drop comments
  .replace(/>[^<]{1,400}</g, '>…<');          // shorten text nodes
fs.writeFileSync('refactor-work/inspect/body-skeleton.txt', body.slice(0, 24000));
// header & footer full (collapsed)
const grab=(t)=>{const o=html.indexOf('<'+t);const c=html.indexOf('</'+t+'>');return o>-1&&c>-1?html.slice(o,c+t.length+3):'';};
fs.writeFileSync('refactor-work/inspect/header.txt', collapse(grab('header')));
fs.writeFileSync('refactor-work/inspect/footer.txt', collapse(grab('footer')));
console.log('head chars', head.length, '| body chars', body.length, '| header', grab('header').length, '| footer', grab('footer').length);
console.log('inline scripts in doc:', (html.match(/<script\b(?![^>]*src=)/gi)||[]).length, '| external scripts:', (html.match(/<script\b[^>]*src=/gi)||[]).length);
console.log('external stylesheets:', (html.match(/<link[^>]+rel=["']stylesheet["'][^>]*>/gi)||[]).join('\n  ').slice(0,1500));
