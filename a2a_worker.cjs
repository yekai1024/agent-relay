'use strict';
// Local, tool-free A2A session owner and command client. No dependencies.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const net=require('node:net'),{spawn}=require('node:child_process');
const {randomUUID}=require('node:crypto'),{StringDecoder}=require('node:string_decoder');
const modelCatalog=require('./model_catalog.cjs');
const terminal=s=>/^TASK_STATE_(COMPLETED|FAILED|CANCELED|REJECTED)$/.test(s||'');
const textOf=t=>(t.artifacts||[]).filter(a=>a.name==='Answer').flatMap(a=>a.parts||[]).map(p=>p.text||'').join('\n');
function atomic(file,value){const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(value,null,2),'utf8');fs.renameSync(tmp,file);}
function lines(stream,handle,onError){const d=new StringDecoder('utf8');let b='';stream.on('data',x=>{b+=d.write(x);let n;while((n=b.indexOf('\n'))>=0){const l=b.slice(0,n);b=b.slice(n+1);try{handle(JSON.parse(l));}catch(e){onError(e);}}});}
function connect(meta,request){return new Promise((resolve,reject)=>{const s=net.createConnection(meta.endpoint);s.on('error',reject);s.on('connect',()=>s.write(JSON.stringify(request)+'\n','utf8'));let answered=false;lines(s,r=>{answered=true;s.end();r.error?reject(new Error(r.error)):resolve(r);},reject);s.on('close',()=>{if(!answered)reject(new Error('Session owner disconnected; inspect session.json. Do not resubmit blindly.'));});});}
async function serve(dir,model,selection){
 if(!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(model)||model==='auto')throw Error('Explicit model required');
 fs.mkdirSync(path.dirname(dir),{recursive:true});fs.mkdirSync(dir,{recursive:false});const cwd=path.join(dir,'workspace');fs.mkdirSync(cwd);
 const endpoint=process.platform==='win32'?'\\\\.\\pipe\\codex-cb-'+randomUUID():path.join(os.tmpdir(),'codex-cb-'+randomUUID()+'.sock');
 const meta={state:'starting',ownerPid:process.pid,requested_model:model,modelSelection:selection,endpoint,contextId:randomUUID(),activeTask:null,started:new Date().toISOString()};
 const metaFile=path.join(dir,'session.json');const save=()=>atomic(metaFile,{...meta,updated:new Date().toISOString()});save();
 const entry=path.join(process.env.APPDATA||'', 'npm/node_modules/@tencent-ai/codebuddy-code/bin/codebuddy');
 if(!fs.existsSync(entry))throw Error('Installed npm CodeBuddy entry not found');
 const child=spawn(process.execPath,[entry,'-p','--a2a','--input-format','stream-json','--output-format','stream-json','--session-id',meta.contextId,'--model',model,'--tools=','--strict-mcp-config','--no-session-persistence','--setting-sources',''],{cwd,windowsHide:true,stdio:['pipe','pipe','pipe']});
 child.stderr.pipe(fs.createWriteStream(path.join(dir,'stderr.txt')));
 const pending=new Map();let busy=false,closing=false;
 const rejectPending=e=>{for(const w of pending.values())w.reject(e);pending.clear();};
 lines(child.stdout,r=>{const w=pending.get(r.id);if(w){pending.delete(r.id);r.error?w.reject(new Error(JSON.stringify(r.error))):w.resolve(r.result);}},e=>rejectPending(new Error('Invalid A2A JSON: '+e.message)));
 function rpc(method,params){return new Promise((resolve,reject)=>{if(child.exitCode!==null)return reject(Error('CodeBuddy exited'));const id=randomUUID();pending.set(id,{resolve,reject});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n','utf8',e=>{if(e){pending.delete(id);reject(e);}});});}
 function record(task){
  if(!task?.id||!task?.status?.state)throw Error('Malformed A2A task');
  if(!/^[A-Za-z0-9_-]+$/.test(task.id))throw Error('Invalid task ID');
  fs.mkdirSync(path.join(dir,'tasks'),{recursive:true});atomic(path.join(dir,'tasks',task.id+'.json'),task);
  if(task.contextId&&task.contextId!==meta.contextId)throw Error('Unexpected contextId; refusing context substitution');
  if(!meta.activeTask||meta.activeTask===task.id)meta.activeTask=terminal(task.status.state)?null:task.id;save();
  const text=textOf(task),validated=task.status.state==='TASK_STATE_COMPLETED'&&!!text.trim();
  if(validated)fs.writeFileSync(path.join(dir,'tasks',task.id+'.txt'),text,'utf8');
  return {taskId:task.id,contextId:task.contextId,state:task.status.state,validated,text,acceptance:'pending: Codex must independently review',task};
 }
 const unwrap=r=>r.task||r;
 let server;
 async function close(){if(closing)return;closing=true;meta.state='closing';save();child.stdin.end();const timer=setTimeout(()=>child.kill(),5000);timer.unref();server.close();}
 server=net.createServer(socket=>{let used=false;lines(socket,async request=>{
  if(used)return;used=true;
  try{
   let result;
   if(request.action==='send'){
    if(busy||meta.activeTask)throw Error('Session has an active task; query, answer or cancel it first');
    if(typeof request.text!=='string'||!request.text.trim())throw Error('Task text required');
    busy=true;try{const message={messageId:randomUUID(),role:'ROLE_USER',parts:[{text:request.text}]};if(meta.contextId)message.contextId=meta.contextId;result=record(unwrap(await rpc('SendMessage',{message,configuration:{returnImmediately:true}})));}finally{busy=false;}
   }else if(request.action==='get'||request.action==='cancel'){
    if(typeof request.taskId!=='string')throw Error('taskId required');
    result=record(unwrap(await rpc(request.action==='get'?'GetTask':'CancelTask',{id:request.taskId})));
   }else if(request.action==='answer'){
    if(busy||meta.activeTask!==request.taskId)throw Error('Answer requires the current interrupted task');
    const old=JSON.parse(fs.readFileSync(path.join(dir,'tasks',request.taskId+'.json'),'utf8'));
    if(old.status.state!=='TASK_STATE_INPUT_REQUIRED')throw Error('Task is not waiting for input');
    if(typeof request.text!=='string'||!request.text.trim())throw Error('Answer text required');
    busy=true;try{result=record(unwrap(await rpc('SendMessage',{message:{messageId:randomUUID(),role:'ROLE_USER',taskId:request.taskId,contextId:meta.contextId,parts:[{text:request.text}]},configuration:{returnImmediately:true}})));}finally{busy=false;}
   }else if(request.action==='status'){result={...meta};}
   else if(request.action==='close'){if(busy||meta.activeTask)throw Error('Cancel/finish active task before closing');result={state:'closing'};}
   else throw Error('Unknown action');
   socket.end(JSON.stringify(result)+'\n');if(request.action==='close')await close();
  }catch(e){socket.end(JSON.stringify({error:e.message})+'\n');}
 },e=>socket.end(JSON.stringify({error:e.message})+'\n'));});
 child.once('error',e=>{meta.error=e.message;rejectPending(e);});
 child.once('exit',(code,signal)=>{meta.state=closing?'closed':'failed';meta.exitCode=code;meta.signal=signal;save();rejectPending(Error('CodeBuddy exited; running tasks cannot be resumed automatically'));server.close();});
 child.stdin.on('error',e=>rejectPending(e));
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(endpoint,resolve);});
 meta.state='running';meta.childPid=child.pid;save();console.log(JSON.stringify({sessionDir:dir,...meta}));
 process.once('SIGINT',()=>{closing=true;child.kill();server.close();});
 process.once('SIGTERM',()=>{closing=true;child.kill();server.close();});
}
async function main(argv){
 const [action,...rest]=argv;const opts={};for(let i=0;i<rest.length;i+=2){if(!rest[i]?.startsWith('--')||rest[i+1]===undefined)throw Error('Options require values');opts[rest[i].slice(2)]=rest[i+1];}
 if(action==='models'){const c=await modelCatalog.catalog({file:opts['catalog-file']&&path.resolve(opts['catalog-file']),refresh:opts.refresh==='true'});console.log(JSON.stringify(c));return;}
 if(!opts['session-dir'])throw Error('Usage: models [--refresh true] OR serve|send|wait|get|answer|cancel|status|close --session-dir ABSOLUTE_DIR [--task-file UTF8_FILE] [--task-id ID] [--model ID] [--tier simple|routine|complex]');
 const dir=path.resolve(opts['session-dir']);if(action==='serve'){
  const c=await modelCatalog.catalog({file:opts['catalog-file']&&path.resolve(opts['catalog-file']),refresh:opts.refresh==='true'});
  const policyFile=opts['policy-file']?path.resolve(opts['policy-file']):path.join(path.dirname(opts['catalog-file']?path.resolve(opts['catalog-file']):modelCatalog.DEFAULT_CACHE),'model-policy.json');
  let policy={};if(fs.existsSync(policyFile))policy=JSON.parse(fs.readFileSync(policyFile,'utf8'));
  const selection=modelCatalog.select(c,{model:opts.model,tier:opts.tier||'routine',policy});
  console.error(JSON.stringify({modelSelection:selection}));return serve(dir,selection.model,selection);
 }
 const meta=JSON.parse(fs.readFileSync(path.join(dir,'session.json'),'utf8'));
 if(meta.state!=='running')throw Error('Session is '+meta.state+'; create a new session with explicit fresh context');
 const request={action:action==='wait'?'get':action,taskId:opts['task-id']};
 if(action==='send'||action==='answer')request.text=fs.readFileSync(path.resolve(opts['task-file']),'utf8').replace(/^\uFEFF/,'');
 let result=await connect(meta,request);
 if(action==='wait')while(!terminal(result.state)&&!/^TASK_STATE_(INPUT_REQUIRED|AUTH_REQUIRED)$/.test(result.state||'')){await new Promise(r=>setTimeout(r,1000));result=await connect(meta,request);}
 // Avoid printing reasoning/history; full task snapshot stays local.
 const {task,...summary}=result;console.log(JSON.stringify(summary));
 if(result.state&&terminal(result.state)&&!result.validated&&action!=='cancel')process.exitCode=1;
}
if(require.main===module)main(process.argv.slice(2)).catch(e=>{console.error(JSON.stringify({error:e.message}));process.exitCode=1;});
module.exports={terminal,textOf,lines,connect};
