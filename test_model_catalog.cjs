const {test}=require('node:test'),assert=require('node:assert/strict');
const {normalize,fresh,select}=require('./model_catalog.cjs');
const fixture=()=>({discoveredAt:new Date().toISOString(),models:[{id:'future-free',creditMultiplier:0,maxInputTokens:100},{id:'other-free',creditMultiplier:0,maxInputTokens:50},{id:'reviewed-paid',creditMultiplier:0.1,displayedRate:'x0.10 credits'}]});
test('selection uses discovered IDs without hy4free dependency',()=>assert.equal(select(fixture()).model,'future-free'));
test('no silent paid fallback when free model disappears',()=>assert.throws(()=>select({models:fixture().models.filter(x=>x.creditMultiplier>0)}),/No advertised zero-rate/));
test('complexity is not inferred from price/name',()=>assert.throws(()=>select(fixture(),{tier:'complex'}),/explicit/));
test('reviewed tier mapping selects model and records reason',()=>assert.equal(select(fixture(),{tier:'complex',policy:{tiers:{complex:{model:'reviewed-paid',reason:'accepted feature tests'}}}}).reason,'accepted feature tests'));
test('removed and disabled explicit selections rejected',()=>{
 assert.throws(()=>select(fixture(),{model:'gone'}),/absent/);
 const f=fixture();f.models[0].disabled=true;assert.throws(()=>select(f,{model:'future-free'}),/disabled/);
});
test('discovery only saves safe model metadata; unknown rate is not free',()=>{
 const m=normalize({models:{availableModels:[{modelId:'new',name:'New',description:'unknown',apiKey:'never-store',_meta:{token:'never-store'}}]}})[0];
 assert.equal(m.creditMultiplier,null);assert.equal(JSON.stringify(m).includes('never-store'),false);
 assert.throws(()=>normalize({models:{availableModels:[]}}),/no model catalog/);
});
test('model ID validation and exact displayed rate parsing',()=>{
 const m=normalize({models:{availableModels:[{modelId:'new',_meta:{credits:'x0.00 credits',maxInputTokens:1000}}]}})[0];assert.equal(m.creditMultiplier,0);
 assert.throws(()=>normalize({models:{availableModels:[{modelId:'../bad'}]}}),/Invalid/);
});
test('cache refreshes after expiry, version change or invalid dates',()=>{
 const i={version:'1',entry:'entry'},now=Date.now();const c={schemaVersion:1,cliVersion:'1',cliEntry:'entry',discoveredAt:new Date(now).toISOString(),models:[{}]};
 assert.equal(fresh(c,i,now),true);assert.equal(fresh(c,i,now+86400001),false);assert.equal(fresh(c,{...i,version:'2'},now),false);assert.equal(fresh({...c,discoveredAt:'bad'},i,now),false);
});
