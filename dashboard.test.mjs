import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const html=await readFile(new URL('./lukfook-mainland-gold-dashboard.html',import.meta.url),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/    startLivePage\(\);\s*$/,'');
const node={innerHTML:'',textContent:'',parentElement:{innerHTML:''}};
const context={document:{querySelector:()=>node,querySelectorAll:()=>[]},window:{}};
vm.createContext(context);
vm.runInContext(script+'\nthis.api={quoteChanges,monthSummary,calculateTrendMA,smoothSegments,curvePath};',context);
const {quoteChanges,monthSummary,calculateTrendMA,smoothSegments,curvePath}=context.api;
const data=JSON.parse(await readFile(new URL('./lukfook-prices.json',import.meta.url),'utf8')).map(r=>({...r,dateKey:r.date,dateLabel:r.date.replaceAll('-','/')}));
test('September first day includes Aug 31 and monthly totals telescope',()=>{
  const stats=monthSummary(data.filter(r=>r.dateKey<='2026-09-07'),'2026-09');
  assert.equal(stats.first.change,-6);assert.equal(stats.baseline.dateKey,'2026-08-31');
  assert.equal(stats.net,stats.rows.reduce((s,r)=>s+r.change,0));
  assert.equal(stats.down,4);assert.equal(stats.up,2);assert.equal(stats.flat,1);
});
test('comparison spans year boundaries and missing-price dates',()=>{
  const rows=[{dateKey:'2026-12-31',gold:100},{dateKey:'2027-01-01',gold:null},{dateKey:'2027-01-02',gold:105}];
  const changes=quoteChanges(rows);assert.equal(changes[1].change,null);assert.equal(changes[2].change,5);
  assert.equal(monthSummary(rows,'2027-01').net,5);
});
test('first 29 points are explicitly reference means, 30th is exact MA30',()=>{
  const rows=Array.from({length:40},(_,i)=>({gold:i+1})),ma=calculateTrendMA(rows);
  assert.equal(ma[0].ma30,null);assert.equal(ma[0].maPreview,1);assert.equal(ma[28].ma30,null);
  assert.equal(ma[29].ma30,15.5);assert.equal(ma[30].ma30,16.5);assert.equal(ma[29].maPreview,null);
  assert.equal(ma[39].ma30,25.5);
});
test('monthly filtering retains pre-window quotes for MA30',()=>{
  const full=calculateTrendMA(data),sep=full.filter(r=>r.dateKey.startsWith('2026-09'));
  const i=data.findIndex(r=>r.dateKey==='2026-09-01');
  assert.equal(sep[0].ma30,data.slice(i-29,i+1).reduce((s,r)=>s+r.gold,0)/30);
});
test('smooth line passes through data and never creates overshoot',()=>{
  const points=[10,10,3,8,20,4,4].map((y,x)=>({x:x*10,y})),segments=smoothSegments(points);
  assert.ok(curvePath(segments).startsWith('M0,10 C'));
  for(const s of segments)for(let j=0;j<=100;j++){
    const t=j/100,u=1-t,v=u*u*u*s.start.y+3*u*u*t*s.c1.y+3*u*t*t*s.c2.y+t*t*t*s.end.y;
    assert.ok(v>=Math.min(s.start.y,s.end.y)-1e-9&&v<=Math.max(s.start.y,s.end.y)+1e-9);
  }
});
