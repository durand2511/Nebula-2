import fs from 'node:fs';
const dir='refactor-work/raw';
const files=fs.readdirSync(dir).filter(f=>f.endsWith('.html')).sort();
const read=f=>fs.readFileSync(dir+'/'+f,'utf8');
const grab=(h,t)=>{const o=h.indexOf('<'+t);const c=h.indexOf('</'+t+'>');return o>-1&&c>-1?h.slice(o,c+t.length+3):'';};
const norm=s=>s.replace(/\s+/g,' ').replace(/(class="[^"]*?)\s*current[-_a-z0-9]*menu[-_a-z0-9]*\w*/gi,'$1').replace(/\bcurrent[-_a-z0-9]*\b/gi,'').replace(/aria-current="[^"]*"/gi,'').trim();
const idx=read('index.html');
const H0=norm(grab(idx,'header')), F0=norm(grab(idx,'footer'));
const bodyOpen=h=>{const m=h.match(/<body[^>]*>/i);return m?m.index+m[0].length:0;};
const pre=h=>h.slice(bodyOpen(h), h.indexOf('<header'));
const post=h=>{const c=h.lastIndexOf('</footer>')+9; const b=h.indexOf('</body>'); return h.slice(c, b>-1?b:undefined);};
const P0=norm(pre(idx)), Q0=norm(post(idx));
console.log('file | canonical | hdrSame footSame preSame postSame | contentLen | bodyOpenTag-same');
const bodyTag=h=>(h.match(/<body[^>]*>/i)||[''])[0];
const B0=bodyTag(idx);
const map={};
for(const f of files){
  const h=read(f);
  const can=(h.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)/i)||[])[1]||'';
  const title=((h.match(/<title[^>]*>([\s\S]*?)<\/title>/i)||[])[1]||'').trim();
  const content=h.slice(h.indexOf('</header>')+9, h.lastIndexOf('<footer'));
  map[f]={canonical:can,title};
  console.log([f, can.replace('https://senszenjoy.nl',''),
    (norm(grab(h,'header'))===H0)+' '+(norm(grab(h,'footer'))===F0)+' '+(norm(pre(h))===P0)+' '+(norm(post(h))===Q0),
    content.length, (bodyTag(h)===B0)].join(' | '));
}
fs.writeFileSync('refactor-work/inspect/pagemap.json', JSON.stringify(map,null,1));
console.log('\nINDEX bodyOpenTag:', B0);
console.log('INDEX preBody (norm, first 400):', P0.slice(0,400));
console.log('INDEX postBody (norm, first 400):', Q0.slice(0,400));
