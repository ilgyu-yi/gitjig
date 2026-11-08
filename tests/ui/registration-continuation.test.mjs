import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHostedTarget} from '../../dist/ui/integration-hosted-target-form.js';
import {browseIntegrationTargets} from '../../dist/ui/integration-target-browser.js';
import {browseMergeTargets} from '../../dist/ui/merge-target-browser.js';

const inventory={listRepositoryConfigurationTargets:()=>({targets:[],nextCursor:null}),listIntegrationTargets:()=>({targets:[],nextCursor:null}),listMergeTargets:()=>({targets:[],nextCursor:null}),listProjects:()=>[]};
function host(steps,extra={}){
 return {guard(){},choose:async(title,rows)=>{const step=steps.shift();assert.ok(step,'Unexpected menu '+title);const result=typeof step==='function'?step(title,rows):rows.find(row=>row.startsWith(step));assert.ok(result,'Missing choice in '+title+' '+JSON.stringify(rows));return result;},input:async()=> 'refs/heads/release',show:async()=>{},register:async()=>assert.fail('No registration admission expected'),...extra};
}
for(const state of ['RETAINED','UNAVAILABLE'])test('populated '+state+' repository identity list retains explicit new registration entry',async()=>{
 const row=state==='RETAINED'?{state,targetId:'gitea-id',target:{provider:'gitea',owner:'owner',repository:'repo',visibility:'public'}}:{state,targetId:'broken-id'};
 const steps=['Repository ·','Register repository identity','Back without registration'];let routes=0;
 assert.equal(await registerHostedTarget(host(steps,{navigate:async command=>{assert.equal(command,'/repo register');routes++;return 'completed';}}),{...inventory,listRepositoryConfigurationTargets:()=>({targets:[row],nextCursor:null})},null),true);
 assert.equal(routes,1);assert.equal(steps.length,0);
});
for(const outcome of ['cancelled','completed','started'])test('hosted prerequisite '+outcome+' preserves staged branch unless execution starts',async()=>{
 let revisited=false;const steps=['Branch ref ·','Repository ·','Register repository identity',...(outcome==='started'?[]:[(_title,rows)=>{assert.ok(rows.includes('Branch ref · refs/heads/release'));revisited=true;return 'Back without registration';}])];
 const result=await registerHostedTarget(host(steps,{navigate:async command=>{assert.equal(command,'/repo register');return outcome;}}),inventory,'project');
 assert.equal(result,outcome==='started'?'started':outcome==='completed');assert.equal(revisited,outcome!=='started');assert.equal(steps.length,0);
});
test('cancelled local project prerequisite returns to staged receiver without discarding its path',async()=>{
 const steps=['Register local bare receiver','Receiver path ·','Project ·','Select or register project',(_title,rows)=>{assert.ok(rows.includes('Receiver path · /private/receiver'));return 'Back without registration';},'Back'];
 assert.equal(await browseIntegrationTargets(host(steps,{input:async()=>'/private/receiver',navigate:async command=>{assert.equal(command,'/project');return 'cancelled';}}),inventory,null),false);assert.equal(steps.length,0);
});
for(const outcome of ['cancelled','completed','started'])test('merge source prerequisite '+outcome+' retains destination branch',async()=>{
 const steps=['Register existing PR merge target','Destination branch ·','Source branch target ·','Open source branch targets and registration',...(outcome==='started'?[]:[(_title,rows)=>{assert.ok(rows.includes('Destination branch · "release"'));return 'Back without registration';},'Back'])];
 const result=await browseMergeTargets(host(steps,{input:async()=> 'release',navigate:async command=>{assert.equal(command,'/repo integration-targets');return outcome;}}),inventory);
 assert.equal(result,outcome==='started'?'started':outcome==='completed');assert.equal(steps.length,0);
});
for(const outcome of ['cancelled','completed'])test('returned prerequisite '+outcome+' cannot revive a stale hosted source',async()=>{
 let current=true;const steps=['Repository ·','Register repository identity'];
 await assert.rejects(registerHostedTarget(host(steps,{guard(){if(!current)throw Error('Original source changed');},navigate:async()=>{current=false;return outcome;}}),inventory,null),/Original source changed/);assert.equal(steps.length,0);
});

for(const outcome of ['cancelled','completed'])test('tracked PR prerequisite '+outcome+' preserves selected source and destination',async()=>{
 const source={state:'RETAINED',family:'github-existing-ref',targetId:'source-target',projectId:'P',ref:'refs/heads/topic',configuration:{repository:{owner:'owner',repository:'repo',repositoryId:7,repositoryNodeId:'R7',visibility:'public'}}};
 const c={...inventory,listIntegrationTargets:()=>({targets:[source],nextCursor:null}),inspectIntegrationTarget:()=>source,listTrackedResources:()=>({resources:[]})};
 const steps=['Register existing PR merge target','Destination branch ·','Source branch target ·','P · owner/repo','Tracked pull request ·','Track an existing pull request',(_title,rows)=>{assert.ok(rows.includes('Source branch target · source-target'));assert.ok(rows.includes('Destination branch · "release"'));return 'Back without registration';},'Back'];
 assert.equal(await browseMergeTargets(host(steps,{input:async()=> 'release',navigate:async command=>{assert.equal(command,'/repo targets');return outcome;}}),c),outcome==='completed');assert.equal(steps.length,0);
});
