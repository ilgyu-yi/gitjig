import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {registryWorld,workLedger} from '../controller/change-registry-fixture.mjs';
import {openController} from '../../dist/controller/index.js';
import {HostCommands} from '../../dist/ui/host-commands.js';import {changeCommands} from '../../dist/ui/change-commands.js';
import {uiText} from '../../dist/ui/i18n.js';
test('all-project UI registry finds original work after scope changes and detail preserves ledger and draft',async t=>{
 const f=await registryWorld(t),conversation=f.c.createConversation({projectId:'B'});f.c.setDraft({conversationId:conversation.conversationId,expectedRevision:0,text:'Keep 한국어 draft'});const before=workLedger(f.c),shown=[];let lists=0;
 const registry=new HostCommands(changeCommands({controller:f.c,isCurrent:()=>true,choose:async(title,rows)=>{assert.match(title,/all projects/);return ++lists===1?rows.find(row=>row.includes(f.works[0].workId)):undefined;},show:async(title,text)=>shown.push({title,text})}));
 assert.equal(await registry.execute('/change',conversation.conversationId),'cancelled');assert.equal(lists,2);assert.match(shown[0].text,/Project: A/);assert.match(shown[0].text,/Owner request 0 한국어/);assert.match(shown[0].text,/Execution: 1 consumed \+ 0 reserved/);
 assert.ok(shown[0].text.includes(uiText('en','change.inspectRecovery',{id:f.works[0].workId})));
 assert.equal(f.c.inspectConversation(conversation.conversationId).draft.text,'Keep 한국어 draft');assert.deepEqual(workLedger(f.c),before);
});
test('selection guards, explicit IDs and cancellation never begin or drive retained work',async t=>{
 const f=await registryWorld(t),conversation=f.c.createConversation();let current=true,shown=0;
 const host={controller:f.c,isCurrent:()=>current,show:async()=>shown++};const before=workLedger(f.c);
 await assert.rejects(new HostCommands(changeCommands({...host,choose:async(_title,rows)=>{current=false;return rows[0];}})).execute('/change',conversation.conversationId),/target changed/);
 current=true;const registry=new HostCommands(changeCommands({...host,choose:async()=>undefined}));assert.equal(await registry.execute('/change',conversation.conversationId),'cancelled');
 await registry.execute('/change inspect '+f.works[1].workId,conversation.conversationId);assert.equal(shown,1);await assert.rejects(registry.execute('/change start',conversation.conversationId),/not available/);assert.deepEqual(workLedger(f.c),before);
});
test('older/newer pages, refresh and project filters keep work identity explicit',async t=>{
    const f=await registryWorld(t),conversation=f.c.createConversation({projectId:'B'});const original=f.c.listChanges.bind(f.c),requests=[],steps=['older','newer','current','refresh','all','close'];
    f.c.listChanges=options=>{requests.push({...options});return original({...options,limit:1});};
    const registry=new HostCommands(changeCommands({controller:f.c,isCurrent:()=>true,show:async()=>assert.fail('Navigation opened work'),choose:async(_title,rows)=>{
        const action=steps.shift();return rows.find(row=>row.startsWith({older:'Older changes',newer:'Newer changes',current:'Current project',refresh:'Refresh this page',all:'All projects',close:'Close'}[action]));
    }}));
    const before=workLedger(f.c);assert.equal(await registry.execute('/change',conversation.conversationId),'cancelled');assert.equal(requests.length,6);
    assert.equal(requests[1].before,f.works[2].workId);assert.equal(requests[2].before,undefined);assert.equal(requests[3].projectId,'B');assert.equal(requests[4].projectId,'B');assert.equal(requests[5].projectId,undefined);assert.deepEqual(workLedger(f.c),before);
});

test('inspection and cancelled managed reviews retain the same scoped older page',async t=>{
 const f=await registryWorld(t),cid=f.c.createConversation({projectId:'A'}).conversationId,id=f.works[0].workId;
 const draft='Keep the separate catalogue draft';
 f.c.setDraft({conversationId:cid,expectedRevision:0,text:draft});
 f.c.options.runtimeProfile={dockerBinary:'/usr/bin/false',dockerContext:'NO_EXECUTION',image:'sha256:'+'0'.repeat(64)};
 const list=f.c.listChanges.bind(f.c),pages=[];
 f.c.listChanges=options=>{pages.push(options);return list({...options,limit:1});};
 const steps=['current','older','work:'+id,'resume','work:'+id,'back','close','cancel','work:'+id,'back','close','close'];
 let inspected=false,before=workLedger(f.c);
 const host={controller:f.c,isCurrent:()=>true,locale:()=> 'en',choose:async()=>assert.fail('Catalogue must use exact values'),
  chooseItems:async(title,items)=>{
   const choice=steps.shift(),item=items.find(row=>row.value===choice);
   assert.ok(item,JSON.stringify({title,choice,items}));
   if(choice==='close'&&!title.startsWith('Managed changes'))assert.equal(item.label,uiText('en','workRecovery.backToSource'));
   return choice;
  },
  async show(title,body,primary) {
   assert.ok(body.includes(id));
   if(title===uiText('en','change.inspectTitle')){
    assert.equal(inspected,false);
    inspected=true;
    await f.c.beginChange({projectId:'A',request:'New original above the older cursor'});
    before=workLedger(f.c);
   }
   else await primary?.run();
  },
  controls:{draft:()=>draft,input:async()=>assert.fail('Review edited the request'),notice(){},launch:()=>assert.fail('Back admitted work'),
   activateSource:async()=>assert.fail('Back changed conversation')},
 };
 const registry=new HostCommands(changeCommands(host));
 assert.equal(await registry.execute('/change',cid),'cancelled');
 assert.deepEqual(steps,[]);
 assert.equal(inspected,true);
 assert.deepEqual(pages.map(({projectId,before})=>[projectId,before]),[
  [undefined,undefined],['A',undefined],...Array.from({length:8},()=>['A',f.works[2].workId]),
 ]);
 assert.equal(f.c.inspectConversation(cid).draft.text,draft);
 assert.deepEqual(workLedger(f.c),before);
});

test('direct managed review catalogue closes and an inspection cannot reopen in another conversation',async t=>{
 const f=await registryWorld(t),cid=f.c.createConversation().conversationId,id=f.works[0].workId;
 let current=true,chosen,count=0;
 const host={controller:f.c,isCurrent:()=>current,locale:()=> 'en',
  choose:async()=>assert.fail('Catalogue must use exact values'),
  chooseItems:async(_title,items)=>{count++;assert.ok(items.some(item=>item.value===chosen));return chosen;},
  show:async()=>{current=false;},
 };
 const registry=new HostCommands(changeCommands(host));
 chosen='close';
 assert.equal(await registry.execute('/change resume',cid),'cancelled');
 assert.equal(count,1);
 chosen='work:'+id;
 assert.equal(await registry.execute('/change',cid),'cancelled');
 assert.equal(count,2);
});

for(const choice of ['back','registry'])test('unavailable delegated roster requires an explicit '+choice+' choice',async t=>{
 const f=await registryWorld(t),cid=f.c.createConversation({projectId:'B'}).conversationId,id=f.works[1].workId;
 f.c.store.run("UPDATE works SET data=json_set(data,'$.conversation',?) WHERE id=?",cid,id);
 assert.equal(f.c.conversationChange(cid).workId,id);
 const before=workLedger(f.c);
 f.c.inspectRecordedDelegatedResults=()=>{throw Error('Controlled whole roster read failure');};
 let menus=0;
 const command=new HostCommands(changeCommands({controller:f.c,isCurrent:()=>true,locale:()=> 'en',
  choose:async()=>assert.fail('Expected stable chooser values'),
  chooseItems:async(title,items)=>{
   if(++menus===1){
    assert.match(title,/Delegated result list unavailable/);
    assert.deepEqual(items.map(item=>item.value),['back','registry']);
    return choice;
   }
   assert.match(title,/Task result · B/);
   assert.ok(items.some(item=>item.value==='work:'+id));
   return 'close';
  },
  show:async()=>assert.fail('An inferred work must not open when the roster fails'),
  execute:async()=>assert.fail('Inspection must not start work'),
 }));
 assert.equal(await command.execute('/result',cid),'cancelled');
 assert.equal(menus,choice==='registry'?2:1);
 assert.deepEqual(workLedger(f.c),before);
});

test('a delegated roster that becomes unavailable after selection refuses that result',async t=>{
 const f=await registryWorld(t),cid=f.c.createConversation().conversationId;
 const before=workLedger(f.c);
 let unavailable=false;
 f.c.inspectRecordedDelegatedResults=()=>{
  if(unavailable)throw Error('Controlled read failure after selection');
  return {entries:[{assignmentId:'assignment',resultId:'publication',workId:f.works[0].workId,
   instructionPreview:'Original delegated request',phase:'BLOCKED',reviewReady:false,uncertain:false}],unavailable:false,omitted:false};
 };
 f.c.inspectConversationResult=()=>assert.fail('The stale publication must not be read');
 f.c.listChanges=()=>assert.fail('A failed exact selection must not open the registry');
 const command=new HostCommands(changeCommands({controller:f.c,isCurrent:()=>true,locale:()=> 'en',
  choose:async()=>assert.fail('Expected stable chooser values'),chooseItems:async(_title,items)=>{
   assert.ok(items.some(item=>item.value==='publication'));
   unavailable=true;
   return 'publication';
  },show:async()=>assert.fail('The stale publication must not be shown'),
 }));
 await assert.rejects(command.execute('/result',cid),/Delegated result changed or is unavailable/);
 assert.deepEqual(workLedger(f.c),before);
});

for(const change of ['empty','different publication','changed hash','changed assignment proof'])test(
 'closing a delegated result does not select a substitute after roster change: '+change,async t=>{
 const f=await registryWorld(t),cid=f.c.createConversation({projectId:'B'}).conversationId,id=f.works[1].workId;
 f.c.store.run("UPDATE works SET data=json_set(data,'$.conversation',?) WHERE id=?",cid,id);
 assert.equal(f.c.conversationChange(cid).workId,id);
 const before=workLedger(f.c);
 const entry={assignmentId:'assignment',resultId:'publication',conversationId:'child',workId:f.works[0].workId,
  publicationHash:'original',assignmentProof:'proof',instructionPreview:'Original delegated request',phase:'BLOCKED',reviewReady:false,uncertain:false};
 let entries=[entry],menus=0,shown=0;
 f.c.inspectRecordedDelegatedResults=()=>({entries,unavailable:false,omitted:false});
 f.c.inspectConversationResult=()=>({...entry,result:{workId:entry.workId}});
 f.c.listChanges=()=>assert.fail('Closing details must not open the general registry');
 const command=new HostCommands(changeCommands({controller:f.c,isCurrent:()=>true,locale:()=> 'en',
  choose:async()=>assert.fail('Expected stable chooser values'),chooseItems:async(_title,items,initial)=>{
   if(++menus===1)return entry.resultId;
   assert.equal(items[0].value,'back');
   assert.ok(initial===undefined||initial==='back');
   return 'back';
  },show:async title=>{
   assert.equal(++shown,1,'Closing details must not open an inferred owner result');
   assert.equal(title,uiText('en','delegated.resultTitle'));
   entries=change==='empty'?[]:[{
    ...entry,
    ...(change==='different publication'?{resultId:'replacement'}:change==='changed hash'?{publicationHash:'changed'}:{assignmentProof:'changed'}),
   }];
  },
 }));
 assert.equal(await command.execute('/result',cid),'cancelled');
 assert.equal(menus,change==='empty'?1:2);
 assert.equal(shown,1);
 assert.deepEqual(workLedger(f.c),before);
});

test('closing a result or backing out of its actions returns to the same older catalogue page',async t=>{
 const f=await registryWorld(t),conversation=f.c.createConversation({projectId:'B'});
 const cid=conversation.conversationId,draft='Retain exact draft 한국어',id=f.works[1].workId;
 f.c.setDraft({conversationId:cid,expectedRevision:0,text:draft});
 let before=workLedger(f.c);
 const read=f.c.listChanges.bind(f.c),pages=[];
 f.c.listChanges=options=>{pages.push(options);return read({...options,limit:1});};
 const steps=['All projects','Older changes',id,id,'Close · inspection only'];
 let shown=0, position;
 const registry=new HostCommands(changeCommands({controller:f.c,isCurrent:()=>true,
  choose:async(_title,rows)=>{
   const next=steps.shift(),choice=rows.find(row=>row.includes(next));
   assert.ok(choice,JSON.stringify({next,rows}));
   return choice;
  },
  show:async(_title,body,primary,scroll)=>{
   assert.ok(body.includes(id));
   if(++shown===1){
    assert.deepEqual(workLedger(f.c),before);
    await f.c.beginChange({projectId:'A',request:'New work above the current catalogue page'});
    before=workLedger(f.c);
   } else if(shown===2) {
    assert.equal(primary.label,uiText('en','result.recovery'));
    position=scroll;
    position.scrollTop=7;
    await primary.run();
   } else {
    assert.equal(scroll,position);
    assert.equal(scroll.scrollTop,7);
   }
  },
  execute:async(action,target)=>{
   assert.deepEqual([action,target],['/work '+id,cid]);
   return 'cancelled';
  },
 }));
 assert.equal(await registry.execute('/result',cid),'cancelled');
 assert.equal(shown,3);
 assert.deepEqual(steps,[]);
 assert.deepEqual(pages.map(({projectId,before})=>[projectId,before]),[
  ['B',undefined],[undefined,undefined],
  ...Array.from({length:3},()=>[undefined,f.works[2].workId]),
 ]);
 assert.equal(f.c.inspectConversation(cid).draft.text,draft);
 assert.deepEqual(workLedger(f.c),before);
});

for (const locale of ['en', 'ko']) test(`${locale} terminal opens sole exact result recovery directly and returns on Back`, async t => {
    const f = await registryWorld(t);
    const {conversationId} = f.c.createConversation({projectId:'B'});
    const id = f.works[1].workId, before = workLedger(f.c);
    const config = path.join(f.root,'direct-result.json'), output = path.join(f.root,'direct-result-terminal');
    const trace = path.join(f.root,'navigation-receipt.json');
    await f.c.close();
    const action = uiText(locale,'result.recovery');
    const language = locale === 'ko' ? 'ko_KR.UTF-8' : 'en_US.UTF-8';
    const steps = [
        {wait:'/ready', send:'/result '+id+'\x1b\r'},
        {wait:action, send:'\r'},
        {wait:uiText(locale,'workRecovery.title',{id,state:'ACTIVE'}), send:'\x1b'},
        {wait:action, send:'\x1b'},
        {wait:'/ready', send:'\x07q'},
    ];
    await fs.writeFile(config, JSON.stringify({output, steps, timeoutSeconds:10, gracefulShutdownSeconds:2,
        command:[process.execPath,...(process.env.GITJIG_UI_MODULE_GUARD ? ['--import',process.env.GITJIG_UI_MODULE_GUARD] : []),
            '--import',path.resolve('tests/ui/navigation-no-execution.mjs'),
            process.env.GITJIG_TEST_CLI_ENTRY ?? path.resolve('dist/cli/entry.js'),
            'conversation','ui','--home',f.home,'--conversation',conversationId],
        env:{HOME:f.root,GITJIG_HOME:f.home,TMPDIR:f.root,PATH:path.dirname(process.execPath)+':/usr/bin:/bin',
            USER:'gitjig-fixture',TERM:'xterm-256color',LANG:language,LC_ALL:language,GITJIG_NAVIGATION_RECEIPT:trace}}));
    const run = await promisify(execFile)('/usr/bin/python3',['tests/cli/fork-ui-pty.py',config],{timeout:14000});
    assert.deepEqual(JSON.parse(run.stdout),
        {exitCode:0,stages:steps.length,terminalRestored:true,alternateEntered:true,alternateExited:true});
    const terminal = await fs.readFile(output,'utf8');
    assert.ok(!terminal.includes(uiText(locale,'result.nextTitle')));
    assert.deepEqual(JSON.parse(await fs.readFile(trace,'utf8')),{process:0,network:0,model:0,run:0});
    const reopened = await openController({installationHome:f.home});
    try {
        assert.deepEqual(workLedger(reopened),before);
        assert.equal(reopened.inspectConversation(conversationId).draft.text,'');
    } finally {
        await reopened.close();
    }
});

test('direct result inspection closes without a catalogue, and a stale catalogue source cannot reopen',async t=>{
 const f=await registryWorld(t),cid=f.c.createConversation().conversationId,id=f.works[2].workId;
 let lists=0,stale=false;
 const registry=new HostCommands(changeCommands({controller:f.c,isCurrent:()=>true,locale:()=> 'en',
  choose:async(_title,rows)=>{lists++;return rows.find(row=>row.includes(id));},
  show:async()=>{
   if(stale){
    const view=f.c.getConversationLanguage(cid);
    f.c.setConversationLanguage({conversationId:cid,expectedGeneration:0,expectedRevision:view.revision,replyLanguage:'ko'});
   }
  },
 }));
 assert.equal(await registry.execute('/result '+id,cid),'completed');
 assert.equal(lists,0);
 stale=true;
 await assert.rejects(registry.execute('/result',cid),/changed/);
 assert.equal(lists,1);
});

test('unreadable current result stays on the exact work and rechecks the conversation on dismissal',async t=>{
 const {c,works}=await registryWorld(t),{conversationId:cid}=c.createConversation({projectId:'A'}),id=works[0].workId;
 const inspect=c.inspectConversation.bind(c);
 c.inspectConversation=target=>({...inspect(target),workId:id});
 c.store.run("UPDATE change_state SET phase='BLOCKED',data='{' WHERE work=?",id);
 assert.throws(()=>c.inspectChangeActivity(id),/malformed JSON/);
 const before=workLedger(c),shown=[];
 let current=true,moveOnClose=false;
 const registry=new HostCommands(changeCommands({
  controller:c,isCurrent:()=>current,
  choose:async()=>assert.fail('Unreadable current work may not fall back to the catalogue'),
  execute:async()=>assert.fail('Unreadable result may not offer a nested action'),
  show:async(title,_body,primary)=>{
   assert.equal(primary,undefined);
   shown.push(title);
   if(moveOnClose)current=false;
  },
 }));
 await assert.rejects(registry.execute('/result missing-work',cid),/original work and result could not be matched/i);
 assert.deepEqual(shown,[],'A wrong ID must be rejected before opening a view');
 assert.equal(await registry.execute('/result',cid),'cancelled');
 moveOnClose=true;
 await assert.rejects(registry.execute('/result '+id,cid),/changed/);
 assert.deepEqual(shown,Array(2).fill('Work result unavailable · '+id));
 assert.deepEqual(workLedger(c),before);
});

test('Korean catalogue controls retain exact typed work identities and original page navigation',async t=>{
 const f=await registryWorld(t),cid=f.c.createConversation({projectId:'B'}).conversationId;
 const chosen=f.works[1].workId,other=f.works[2].workId,read=f.c.listChanges.bind(f.c),queries=[];
 f.c.listChanges=options=>{
  queries.push(options);
  const page=read({...options,limit:1});
  return {...page,changes:page.changes.map(work=>({...work,requestPreview:'동일한 요청 미리보기'}))};
 };
 const steps=[
  ['all','change.registry.all'],['older','change.registry.older'],['refresh','change.registry.refresh'],
  ['work:'+chosen,null],['newer','change.registry.newer'],['current','change.registry.current'],['close','change.registry.close'],
 ];
 let shown=0;
 const host={controller:f.c,locale:()=> 'ko',isCurrent:()=>true,
  choose:async()=>assert.fail('Use stable catalogue values'),
  chooseItems:async(title,items)=>{
   assert.match(title,/작업 결과/);
   const [value,message]=steps.shift(),row=items.find(item=>item.value===value);
   assert.ok(row,JSON.stringify({title,value,items}));
   if(message)assert.equal(row.label,uiText('ko',message));
   else assert.match(row.label,/기록된 단계.*동일한 요청 미리보기/);
   return value;
  },show:async(_title,body)=>{assert.ok(body.includes(chosen));shown++;},
 };
 const before=workLedger(f.c);
 assert.equal(await new HostCommands(changeCommands(host)).execute('/result',cid),'cancelled');
 assert.deepEqual(steps,[]);
 assert.equal(shown,1);
 assert.deepEqual(queries.map(({projectId,before})=>[projectId,before]),[
  ['B',undefined],[undefined,undefined],...Array.from({length:3},()=>[undefined,other]),
  [undefined,undefined],['B',undefined],
 ]);
 const forged=new HostCommands(changeCommands({...host,chooseItems:async()=> 'work:'+other,show:async()=>assert.fail('Unoffered work opened')}));
 await assert.rejects(forged.execute('/result',cid),/Unknown UI choice value/);
 assert.deepEqual(workLedger(f.c),before);
});
