const {test}=require('node:test');
const assert=require('node:assert/strict');
const {PassThrough}=require('node:stream');
const {terminal,textOf,lines,connect}=require('./a2a_worker.cjs');
test('only terminal task states finish waiting',()=>{
 for(const s of ['COMPLETED','FAILED','CANCELED','REJECTED'])assert.equal(terminal('TASK_STATE_'+s),true);
 for(const s of ['WORKING','SUBMITTED','INPUT_REQUIRED','AUTH_REQUIRED',''])assert.equal(terminal('TASK_STATE_'+s),false);
});
test('final answer excludes thought/history and unrelated artifacts',()=>{
 assert.equal(textOf({history:[{parts:[{text:'thought'}]}],artifacts:[{name:'Plan',parts:[{text:'plan'}]},{name:'Answer',parts:[{text:'answer'}]}]}),'answer');
 assert.equal(textOf({}),'');
});
test('UTF8 characters survive every single-byte chunk boundary',()=>{
 const s=new PassThrough(),values=[],errors=[];
 lines(s,x=>values.push(x),e=>errors.push(e));
 const expected={text:'中文上下文 × 你好'};
 for(const b of Buffer.from(JSON.stringify(expected)+'\n','utf8'))s.write(Buffer.from([b]));
 assert.deepEqual(values,[expected]);assert.deepEqual(errors,[]);s.end();
});
test('malformed wire JSON fails explicitly',()=>{
 const s=new PassThrough(),errors=[];lines(s,()=>assert.fail(),e=>errors.push(e));s.write('bad\n');assert.equal(errors.length,1);s.end();
});
test('unavailable owner rejects rather than replaying task',async()=>{
 await assert.rejects(connect({endpoint:process.platform==='win32'?'\\\\.\\pipe\\absent-'+Date.now():'/tmp/absent-'+Date.now()},{action:'status'}));
});
