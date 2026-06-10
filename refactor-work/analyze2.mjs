import fs from 'node:fs';
const dir='refactor-work/raw';
const files=fs.readdirSync(dir).filter(f=>f.endsWith('.html'));
const read=f=>fs.readFileSync(dir+'/'+f,'utf8');
const styleBlocks=h=>h.match(/<style\b[^>]*>[\s\S]*?<\/style>/gi)||[];

// style sharing across ALL pages
const counts=new Map();
for(const f of files){ const set=new Set(styleBlocks(read(f))); for(const b of set){counts.set(b,(counts.get(b)||0)+1);} }
const all=files.length;
let sharedBytes=0, sharedN=0, totN=0, totBytes=0;
for(const [b,c] of counts){ totN++; totBytes+=b.length; if(c===all){sharedN++; sharedBytes+=b.length;} }
const idxBlocks=styleBlocks(read('index.html'));
console.log('distinct style blocks across site:',totN,'| shared-by-all:',sharedN,'(',sharedBytes,'bytes )');
console.log('index.html inline style: blocks',idxBlocks.length,'bytes',idxBlocks.reduce((a,b)=>a+b.length,0));
console.log('style block ids (index):', idxBlocks.map(b=>(b.match(/<style[^>]*\bid=["']([^"']+)/i)||[])[1]||'(noid)').join(', '));

// header menu links from index header
const html=read('index.html');
const header=html.slice(html.indexOf('<header'),html.indexOf('</header>')+9);
const menu=[...header.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].map(m=>[m[1],m[2].replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim()]);
console.log('\nHEADER MENU LINKS:'); for(const [h,t] of menu) console.log('  ',t,'->',h);

// all internal link targets across site -> pathname frequency
const freq=new Map();
for(const f of files){ const h=read(f); for(const m of h.matchAll(/href=["']https?:\/\/(?:www\.)?senszenjoy\.nl(\/[^"'#?]*)/gi)){ const p=m[1]; freq.set(p,(freq.get(p)||0)+1);} }
const top=[...freq.entries()].sort((a,b)=>b[1]-a[1]);
console.log('\nDISTINCT INTERNAL PATHS:',top.length);
for(const [p,c] of top) console.log('  ',c,p);
