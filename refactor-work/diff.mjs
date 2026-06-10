import fs from 'node:fs';
const read=f=>fs.readFileSync('refactor-work/raw/'+f,'utf8');
const grab=(h,t)=>{const o=h.indexOf('<'+t);const c=h.indexOf('</'+t+'>');return o>-1&&c>-1?h.slice(o,c+t.length+3):'';};
function firstDiff(a,b,label){
  let i=0; const n=Math.min(a.length,b.length);
  while(i<n && a[i]===b[i]) i++;
  console.log(`\n## ${label}  (lenA=${a.length} lenB=${b.length}) firstDiff@${i}`);
  if(i>=n && a.length===b.length){console.log('  IDENTICAL'); return;}
  const s=Math.max(0,i-80);
  console.log('  A:…'+a.slice(s,i+90).replace(/\s+/g,' '));
  console.log('  B:…'+b.slice(s,i+90).replace(/\s+/g,' '));
}
const idx=read('index.html');
for(const f of ['pilates.html','over-mij.html','mindfulness.html']){
  const h=read(f);
  firstDiff(grab(idx,'header'),grab(h,'header'),'HEADER index vs '+f);
}
for(const f of ['pilates.html','over-mij.html','algemene-voorwaarden.html']){
  const h=read(f);
  firstDiff(grab(idx,'footer'),grab(h,'footer'),'FOOTER index vs '+f);
}
// count current-menu occurrences in headers to confirm active-state theory
for(const f of ['index.html','pilates.html','mindfulness.html']){
  const hd=grab(read(f),'header');
  console.log(f,'header current-menu-item count:', (hd.match(/current-menu-item|current-menu-ancestor|current[-_]page/gi)||[]).length);
}
