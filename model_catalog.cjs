'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process');
const {StringDecoder}=require('node:string_decoder');
const DEFAULT_CACHE=path.join(os.homedir(),'.codex','codebuddy','model-catalog.json');
function installation(){
 const entry=path.join(process.env.APPDATA||'','npm/node_modules/@tencent-ai/codebuddy-code/bin/codebuddy');
 const packageFile=path.resolve(entry,'../../package.json');
 if(!fs.existsSync(entry))throw Error('Installed npm CodeBuddy entry missing');
 return {entry,version:JSON.parse(fs.readFileSync(packageFile,'utf8')).version};
}
function normalize(session){
 const source=session?.models?.availableModels;
 if(!Array.isArray(source)||!source.length)throw Error('ACP returned no model catalog; no hardcoded fallback');
 const seen=new Set();return source.map(m=>{
  const id=m.modelId;if(typeof id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)||seen.has(id))throw Error('Invalid/duplicate discovered model ID');seen.add(id);
  const meta=m._meta||{},rateText=typeof meta.credits==='string'?meta.credits:(m.description||'');
  const rate=/^x(\d+(?:\.\d+)?)\s+credits$/.exec(rateText.trim());
  return {id,name:typeof m.name==='string'?m.name:id,displayedRate:rate?rateText:null,creditMultiplier:rate?Number(rate[1]):null,disabled:m.disabled===true||meta.disabled===true,supportsImages:meta.supportsImages===true,supportsReasoning:meta.supportsReasoning===true,maxInputTokens:Number.isFinite(meta.maxInputTokens)?meta.maxInputTokens:null};
 });
}
async function probe(entry){
 const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'cb-models-'));
 const p=spawn(process.execPath,[entry,'--acp','--tools=','--strict-mcp-config','--no-session-persistence','--setting-sources',''],{cwd,windowsHide:true,stdio:['pipe','pipe','pipe']});
 const pending=new Map();let id=0,buffer='';const decoder=new StringDecoder('utf8');
 const fail=e=>{for(const w of pending.values())w.reject(e);pending.clear();};
 p.stderr.resume();p.once('error',fail);p.once('exit',code=>fail(Error('Model discovery process exited ('+code+'); check CLI installation/login')));p.stdin.on('error',fail);
 p.stdout.on('data',c=>{buffer+=decoder.write(c);let n;while((n=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,n);buffer=buffer.slice(n+1);try{const r=JSON.parse(line),w=pending.get(r.id);if(w){pending.delete(r.id);r.error?w.reject(Error('ACP metadata request failed ('+r.error.code+'); check CLI login/version')):w.resolve(r.result);}}catch{fail(Error('Invalid JSON in ACP model discovery'));}}});
 function rpc(method,params){return new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});p.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});}
 // Metadata probe only: bounded wait does NOT impose a task execution deadline.
 const timer=setTimeout(()=>{fail(Error('Model discovery timed out; no inference task was submitted'));p.kill();},30000);
 try{
  await rpc('initialize',{protocolVersion:1,clientCapabilities:{fs:{readTextFile:false,writeTextFile:false}},clientInfo:{name:'codex-model-catalog',version:'1'}});
  return normalize(await rpc('session/new',{cwd,mcpServers:[]}));
 }finally{
  clearTimeout(timer);p.stdin.end();
  if(p.exitCode===null)await new Promise(resolve=>{p.once('exit',resolve);const t=setTimeout(()=>p.kill(),2000);t.unref();});
  fs.rmSync(cwd,{recursive:true,force:true});
 }
}
function fresh(catalog,install,now=Date.now()){
 return catalog?.schemaVersion===1&&catalog.cliVersion===install.version&&catalog.cliEntry===install.entry&&Number.isFinite(Date.parse(catalog.discoveredAt))&&now>=Date.parse(catalog.discoveredAt)&&now-Date.parse(catalog.discoveredAt)<86400000&&Array.isArray(catalog.models)&&catalog.models.length>0;
}
async function catalog({file=DEFAULT_CACHE,refresh=false}={}){
 const install=installation();let old;try{old=JSON.parse(fs.readFileSync(file,'utf8'));}catch{}
 if(!refresh&&fresh(old,install))return {...old,cacheHit:true};
 const models=await probe(install.entry);
 const result={schemaVersion:1,cliVersion:install.version,cliEntry:install.entry,discoveredAt:new Date().toISOString(),source:'ACP initialize + session/new (no prompt)',limitations:'Advertised catalog and displayed relative rates; not quota, backend attestation or successful inference proof. Refresh after account/login changes.',models};
 fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+'.'+process.pid+'.tmp';fs.writeFileSync(tmp,JSON.stringify(result,null,2),'utf8');fs.renameSync(tmp,file);return {...result,cacheHit:false};
}
function select(catalog,{model,tier='routine',policy={}}={}){
 if(!['simple','routine','complex'].includes(tier))throw Error('tier must be simple, routine or complex');
 let reason='explicit --model',chosen=model;
 if(!chosen&&policy.tiers?.[tier]){chosen=policy.tiers[tier].model;reason=policy.tiers[tier].reason;if(typeof reason!=='string'||!reason.trim())throw Error('Tier mapping requires a reviewable reason');}
 if(!chosen){
  if(tier==='complex')throw Error('Complex tasks require an explicit --model or reviewed complex tier mapping; price is not a capability ranking');
  const free=catalog.models.filter(m=>!m.disabled&&m.creditMultiplier===0).sort((a,b)=>(b.maxInputTokens||0)-(a.maxInputTokens||0)||a.id.localeCompare(b.id));
  if(!free.length)throw Error('No advertised zero-rate model; choose --model or configure a reviewed tier mapping. No automatic paid fallback');
  chosen=free[0].id;reason='Advertised zero-rate candidate, largest reported context; capability/quota must still be verified';
 }
 const found=catalog.models.find(m=>m.id===chosen&&!m.disabled);if(!found)throw Error('Selected model absent/disabled in current catalog; refresh and explicitly select another model');
 return {model:found.id,tier,reason,displayedRate:found.displayedRate,catalogDiscoveredAt:catalog.discoveredAt};
}
module.exports={DEFAULT_CACHE,installation,normalize,probe,fresh,catalog,select};
