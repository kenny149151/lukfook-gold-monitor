import { readFile, writeFile, rename, mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT=path.dirname(fileURLToPath(import.meta.url));
export const FIELDS=['gold','tianfu','platinum','pt950'];
export const OFFICIAL='https://www.lukfookeshop.com.cn/lfg-category/bracelet/G39G0021DS';
export const HISTORY='https://www.jinjia.com.cn/lukfook/history.html';
export const BULLION='https://vip.stock.finance.sina.com.cn/q/view/vGold_Matter_History.php?pp=0&pz=15';
export const todayCN=(now=new Date())=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
const validDate=d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&!Number.isNaN(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
const clean=s=>s.replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();

export function parseOfficial(html){
  const values={};
  for(const m of html.matchAll(/<span[^>]*class=["']name-key["'][^>]*>([^<]+)<\/span>\s*<span[^>]*>\s*[：:]\s*([\d.]+)\s*元\/克/g)){
    const f=m[1].includes('黄金添富')?'tianfu':m[1].includes('铂金950')?'pt950':m[1].includes('足铂金')?'platinum':m[1].includes('足金')?'gold':null;
    if(f)values[f]=Number(m[2]);
  }
  const times=[...html.matchAll(/更新时间[：:]\s*(\d{4}-\d{2}-\d{2})\s+(\d{1,2}):(\d{2}):(\d{2})/g)].map(m=>`${m[1]} ${m[2].padStart(2,'0')}:${m[3]}:${m[4]}`).sort();
  const quotedAt=times.at(-1);
  if(!quotedAt||!FIELDS.every(f=>Number.isFinite(values[f])&&values[f]>0&&values[f]<10000))throw Error('官方页面缺少完整品类或有效报价时间，保留上次数据');
  return {...values,date:quotedAt.slice(0,10),quotedAt,source:'六福官方商城',sourceUrl:OFFICIAL};
}
export function parseHistory(html){
  const rows=[];
  for(const li of html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)){
    const h=li[1],date=h.match(/class="time">(\d{4}-\d{2}-\d{2})/),g=h.match(/class="new">[\s\S]*?>(\d+)<\/span>/),p=h.match(/class="rise">[\s\S]*?>(\d+)<\/span>/);
    if(date&&g&&p)rows.push({date:date[1],gold:+g[1],pt950:+p[1],source:'金价网历史表',sourceUrl:HISTORY,note:'公开历史报价；铂金列与PT950口径核对，不作为足铂999'});
  }
  if(!rows.length)throw Error('历史表结构变化，未提取到报价');
  return rows;
}
export function parseBullion(html){
  const rows=[];
  for(const tr of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)){
    const c=[...tr[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(m=>clean(m[1]));
    if(validDate(c[0]||'')&&c[1]==='六福'&&c[2]==='金条金价(内地)'&&c[4]==='元/克')rows.push({date:c[0],tianfu:Number(c[3]),source:'新浪财经内地金条历史表',sourceUrl:BULLION,note:'内地金条报价；官方添富金优先'});
  }
  if(!rows.length)throw Error('新浪历史表未提取到六福内地金条');
  return rows;
}
export function mergeQuote(map,row,rank,today=todayCN()){
  if(!validDate(row.date)||row.date<'2026-04-20'||row.date>'2028-12-31'||row.date>today)return false;
  const old=map.get(row.date)||{date:row.date},next={...old,fieldSources:{...old.fieldSources}};
  let changed=false;
  for(const f of FIELDS){
    if(!Number.isFinite(row[f])||row[f]<=0||row[f]>=10000)continue;
    const prior=old.fieldSources?.[f],oldRank=prior?.rank??(Number.isFinite(old[f])?50:0);
    if(rank<oldRank || (rank===oldRank&&prior?.quotedAt&&(!row.quotedAt||row.quotedAt<prior.quotedAt)))continue;
    const source={name:row.source,url:row.sourceUrl,rank,quotedAt:row.quotedAt||null};
    if(old[f]!==row[f]||JSON.stringify(prior)!==JSON.stringify(source))changed=true;
    next[f]=row[f];next.fieldSources[f]=source;
  }
  if(changed){
    const main=next.fieldSources.gold;
    next.source=main?.name||old.source||row.source;next.sourceUrl=main?.url||old.sourceUrl||row.sourceUrl;
    next.quotedAt=main?.quotedAt||old.quotedAt||null;
    next.note=row.note||old.note||'按来源实际日期记录；同日保留较晚报价';
    map.set(row.date,next);
  }
  return changed;
}
async function fetchText(url,encoding='utf-8'){
  let error;
  for(let attempt=0;attempt<3;attempt++)try{
    const r=await fetch(url,{signal:AbortSignal.timeout(25000),headers:{'user-agent':'Mozilla/5.0 (compatible; LukfookPriceMonitor/2.0)','cache-control':'no-cache'}});
    if(!r.ok)throw Error('HTTP '+r.status);
    return new TextDecoder(encoding).decode(await r.arrayBuffer());
  }catch(e){error=e;}
  throw error;
}
export async function atomicJSON(file,value){const tmp=file+'.tmp';await writeFile(tmp,JSON.stringify(value,null,2)+'\n');await rename(tmp,file);}
export async function collect(root=ROOT){
  const now=new Date(),today=todayCN(now),file=path.join(root,'lukfook-prices.json');
  const old=JSON.parse(await readFile(file,'utf8'));
  if(!Array.isArray(old)||!old.length)throw Error('历史文件无效，停止写入');
  const map=new Map(old.map(r=>[r.date.length===5?'2026-'+r.date.replace('/','-'):r.date,{...r,date:r.date.length===5?'2026-'+r.date.replace('/','-'):r.date}]));
  const priorStatus=await readFile(path.join(root,'sync-status.json'),'utf8').then(JSON.parse).catch(()=>({}));
  const status={schemaVersion:2,checkedAt:now.toISOString(),today,lastSuccessAt:priorStatus.lastSuccessAt||null,officialQuotedAt:priorStatus.officialQuotedAt||null,intervalMinutes:30,sources:[],errors:[]};
  const supplements=JSON.parse(await readFile(path.join(root,'lukfook-history-supplement.json'),'utf8'));
  for(const r of supplements)mergeQuote(map,{...r,source:r.source||'官方商城历史快照（检索存档）',note:r.note||'补查历史快照；链接现时内容可能已更新'},r.source?40:80,today);
  const jobs=[{name:'金价网历史表',url:HISTORY,parse:parseHistory,rank:20},{name:'新浪财经内地金条',url:BULLION,parse:parseBullion,rank:20,encoding:'gb18030'},{name:'六福官方商城',url:OFFICIAL,parse:h=>[parseOfficial(h)],rank:100}];
  const results=await Promise.allSettled(jobs.map(async j=>j.parse(await fetchText(j.url,j.encoding))));
  let success=0;
  for(let i=0;i<jobs.length;i++){
    const j=jobs[i],result=results[i];
    if(result.status==='rejected'){status.errors.push(j.name+'：'+result.reason.message);status.sources.push({name:j.name,url:j.url,ok:false});continue;}
    const rows=result.value.filter(r=>validDate(r.date)&&r.date<=today&&r.date<='2028-12-31');
    if(!rows.length){status.errors.push(j.name+'：没有有效日期报价');continue;}
    success++;for(const r of rows)mergeQuote(map,r,j.rank,today);
    const latest=rows.map(r=>r.date).sort().at(-1);
    status.sources.push({name:j.name,url:j.url,ok:true,latestDate:latest,records:rows.length});
    if(j.rank===100)status.officialQuotedAt=rows[0].quotedAt;
  }
  const records=[...map.values()].filter(r=>Number.isFinite(r.gold)).sort((a,b)=>a.date.localeCompare(b.date));
  const changed=JSON.stringify(old)!==JSON.stringify(records);
  if(changed){await copyFile(file,file+'.bak');await atomicJSON(file,records);}
  status.latestDate=records.at(-1).date;status.recordCount=records.length;status.state=success===0?'error':status.latestDate<today?'awaiting_quote':status.errors.length?'partial':'ok';
  if(success)status.lastSuccessAt=now.toISOString();
  status.missingDates=[];
  for(let d=new Date('2026-08-26T00:00:00Z');d.toISOString().slice(0,10)<=today&&d.toISOString().slice(0,10)<='2028-12-31';d.setUTCDate(d.getUTCDate()+1))if(!map.has(d.toISOString().slice(0,10)))status.missingDates.push(d.toISOString().slice(0,10));
  await atomicJSON(path.join(root,'sync-status.json'),status);
  await buildSite(root,records,status);
  console.log(JSON.stringify({state:status.state,latest:records.at(-1),missingDates:status.missingDates,errors:status.errors}));
  return status;
}
export async function buildSite(root,records,status){
  const file=path.join(root,'lukfook-mainland-gold-dashboard.html');
  let html=await readFile(file,'utf8');
  html=html.replace(/const embeddedTrendData=[\s\S]*?\n;\n/,()=> 'const embeddedTrendData='+JSON.stringify(records).replace(/</g,'\\u003c')+'\n;\n');
  html=html.replace(/const embeddedSyncStatus = .*?;\n/,()=> 'const embeddedSyncStatus = '+JSON.stringify(status).replace(/</g,'\\u003c')+';\n');
  await writeFile(file,html);
  const site=path.join(root,'site');await mkdir(site,{recursive:true});
  await writeFile(path.join(site,'index.html'),html);
  await atomicJSON(path.join(site,'lukfook-prices.json'),records);
  await atomicJSON(path.join(site,'sync-status.json'),status);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const status=await collect();if(status.state==='error')process.exitCode=1;
}
