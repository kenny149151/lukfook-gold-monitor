#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { collect, ROOT } from './collect-prices.mjs';
const PORT=Number(process.env.PORT||8787),HOST=process.env.HOST||'127.0.0.1';
let pending;
function sync(){if(pending)return pending;pending=collect().catch(e=>console.error('采集失败：',e.message)).finally(()=>pending=null);return pending;}
await sync();
createServer(async(req,res)=>{
  try{
    const pathname=new URL(req.url,'http://localhost').pathname;
    const files={'/':['site/index.html','text/html'],'/lukfook-mainland-gold-dashboard.html':['site/index.html','text/html'],'/lukfook-prices.json':['lukfook-prices.json','application/json'],'/sync-status.json':['sync-status.json','application/json']};
    const file=files[pathname];
    if(!file){res.writeHead(404);return res.end('Not found');}
    const body=await readFile(path.join(ROOT,file[0]));res.writeHead(200,{'content-type':file[1]+'; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(body);
  }catch(e){res.writeHead(500);res.end('服务暂不可用');}
}).listen(PORT,HOST,()=>console.log(`六福金价：http://${HOST}:${PORT}`));
setInterval(sync,30*60*1000);
