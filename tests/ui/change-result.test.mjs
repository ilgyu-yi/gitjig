import test from 'node:test';
import assert from 'node:assert/strict';
import {changeResultText} from '../../dist/ui/change-result.js';
import {changeCommands} from '../../dist/ui/change-commands.js';
import {workCommands} from '../../dist/ui/work-commands.js';
import {HostCommands} from '../../dist/ui/host-commands.js';
import {uiText} from '../../dist/ui/i18n.js';
import {registryWorld, workLedger} from '../controller/change-registry-fixture.mjs';
import {managedWorld} from './managed-change-fixture.mjs';

// Controlled presentation input; this is not evidence of actual checks or review.
const result = overrides => ({
    workId:'original-work', projectId:'P', request:'Keep the requested behavior', requestTruncated:false,
    registeredSourceRoot:'/project', state:'BLOCKED', recordedPhase:'CHECKED', reviewReady:false,
    blocked:[], blockedOmitted:0, nextAction:'repairChange',
    candidate:{versionId:'candidate',path:'/saved/candidate',hash:'0'.repeat(64)},
    changes:{availability:'recorded',entries:[{path:'consumer.cjs',kind:'modified'}],total:1,omitted:0},
    checks:{availability:'recorded',entries:[{checkId:'consumer-check',status:'pass',passed:true,cleanup:'removed'}],total:1,omitted:0},
    reviews:{availability:'recorded',entries:[{key:'reviewer:behavior',state:'selected',outcome:'clear',findingCount:0}],total:1,omitted:0},
    provenance:{baseVersion:'base',candidateVersion:'candidate',planVersion:'plan',verificationVersion:'verification'},
    limitations:['Recorded metadata only.'], ...overrides,
});

for(const locale of ['en','ko']) {
    test(`${locale} baseline observations stay distinct from candidate passes and pending independent assessment`,()=>{
        const view=result({checks:{availability:'recorded',entries:[
            {checkId:'baseline-check',target:'base',purpose:'baseline',status:'baseline-observed',observed:true,passed:false},
            {checkId:'candidate-check',status:'pass',passed:true},
        ],total:2,omitted:0},verificationEvidence:{availability:'unavailable',reason:'A distinct review is pending',requirements:[{
            requirementId:'scope',kind:'manifest-scope-duty',strategyDigest:'a'.repeat(64),reviewKey:'independent-review',witnessAvailability:'recorded',witnessIds:['original-scope-witness'],reviewLaunchIds:[],
            scope:{witnessId:'original-scope-witness',predicate:'complete-effective-manifest-scope/v1',actual:{satisfied:true,changedCount:1,violationCount:0},adverse:{satisfied:false}},
        }]}});
        const text=changeResultText(view,locale);
        assert.ok(text.includes(uiText(locale,'result.checksWithBaseline')));
        assert.ok(text.includes(uiText(locale,'result.baseline')+' · '+uiText(locale,'result.check.baseline-observed')+' · "baseline-check"'));
        assert.ok(!text.includes(uiText(locale,'result.check.pass')+' · "baseline-check"'));
        assert.ok(text.includes(uiText(locale,'result.check.pass')+' · "candidate-check"'));
        for(const key of ['result.scopeWithin','result.scopeAdverseRejected','result.verificationReviewPending','result.verificationPending'])assert.ok(text.includes(uiText(locale,key)),key);
        const violation=changeResultText(result({verificationEvidence:{...view.verificationEvidence,requirements:[{
            ...view.verificationEvidence.requirements[0],scope:{witnessId:'failed-scope-witness',predicate:'complete-effective-manifest-scope/v1',actual:{satisfied:false,changedCount:2,violationCount:1},adverse:{satisfied:false}},
        }]}}),locale);
        assert.ok(violation.includes(uiText(locale,'result.scopeViolation')));
        assert.ok(!violation.includes(uiText(locale,'result.scopeWithin')));
        for(const oversized of [{requirementId:'identity'.repeat(800)},{reason:'long diagnosis '.repeat(500)}]){
            const omitted=changeResultText(result({verificationEvidence:{availability:'unavailable',requirements:[{
                ...view.verificationEvidence.requirements[0],...oversized,
            }]}}),locale);
            assert.ok(omitted.includes(uiText(locale,'result.omitted',{count:1})));
            for(const key of ['result.scopeWithin','result.scopeAdverseRejected','result.verificationReviewPending'])assert.ok(!omitted.includes(uiText(locale,key)),key);
            assert.ok(omitted.includes(uiText(locale,'result.verificationPending')));
            assert.ok(omitted.includes('/work original-work'));
        }
        const invalid=changeResultText(result({checks:{availability:'recorded',entries:[
            {checkId:'unproven-baseline',target:'base',purpose:'baseline',status:'baseline-observed',observed:false,passed:false},
            {checkId:'candidate-is-not-baseline',target:'candidate',status:'baseline-observed',observed:true,passed:true},
        ],total:2,omitted:0}}),locale);
        assert.ok(!invalid.includes(uiText(locale,'result.check.baseline-observed')));
        for(const id of ['unproven-baseline','candidate-is-not-baseline'])assert.ok(invalid.includes(uiText(locale,'result.check.unavailable')+' · '+JSON.stringify(id)));
    });
    test(`${locale} result never promotes an unproven pass, hides omitted entries as empty, or sends recovery to a different task`,()=>{
        const view=result({
            checks:{availability:'recorded',entries:[{checkId:'missing-case-proof',status:'pass',passed:false}],total:1,omitted:0},
            changes:{availability:'recorded',entries:[],total:1,omitted:1},
            reviews:{availability:'recorded',entries:[],total:2,omitted:2},
            request:'Long owner text\n'.repeat(300),
        });
        const text=changeResultText(view,locale);
        assert.ok(text.includes(uiText(locale,'result.check.unavailable')+' · "missing-case-proof"'));
        assert.ok(!text.includes(uiText(locale,'result.check.pass')+' · "missing-case-proof"'));
        for(const key of ['result.noChanges','result.noReview']) assert.ok(!text.includes(uiText(locale,key)));
        assert.ok(text.includes(uiText(locale,'result.omitted',{count:1})));
        assert.ok(text.includes(uiText(locale,'result.omitted',{count:2})));
        assert.ok(text.includes('/work original-work')); assert.ok(text.includes('/change inspect original-work'));
        assert.ok(text.indexOf('missing-case-proof')<text.indexOf(view.request.slice(0,100)));
        assert.ok(text.includes(uiText(locale,'result.delivery')));
        assert.ok(text.includes(uiText(locale,'result.sourceUncompared')));
        assert.ok(text.includes('Recorded metadata only.'));
        const primary=text.split(uiText(locale,'result.provenance'))[0];
        assert.ok(!primary.includes('repairChange'));
    });
}

test('result displays path identities safely and distinguishes carried findings from current clear review',()=>{
    const view=result({request:'Owner\x1b[2J text',changes:{availability:'recorded',entries:[{path:'line\n\x1b[2Jfile',kind:'modified'},{path:'C1\u009btest.cjs',kind:'added'}],total:2,omitted:0},reviews:{availability:'recorded',entries:[{key:'carried',state:'carried',outcome:'findings',findingCount:2},{key:'old-clear',state:'stale',outcome:'clear',findingCount:0}],total:2,omitted:0}});
    const text=changeResultText(view,'en');
    assert.ok(!text.includes('\x1b')); assert.ok(text.includes(JSON.stringify(view.changes.entries[0].path)));
    assert.ok(text.includes('"C1\\u009btest.cjs"'));assert.ok(!text.includes('\u009b'));
    assert.match(text,/Review has findings · "carried" · 2 findings · Carried/);
    assert.match(text,/Evidence unavailable or no longer applicable · "old-clear"/);
    assert.ok(!text.includes('Review clear · "old-clear"'));
});

test('large recorded sections retain checks, review and exact recovery within the actual host display limit',async()=>{
    const long='\u009b'.repeat(1000),view=result({request:'owner '.repeat(5461),blocked:Array(16).fill('reason '.repeat(170)),nextAction:'next'.repeat(1024),candidate:{versionId:'candidate',path:'/saved/'+long.repeat(8)},registeredSourceRoot:'/source/'+long.repeat(8),
        changes:{availability:'recorded',entries:Array.from({length:100},(_,i)=>({path:long+i,kind:'modified'})),total:101,omitted:1},
        checks:{availability:'recorded',entries:Array.from({length:100},(_,i)=>({checkId:'check'+i+'x'.repeat(600),status:'pass',passed:true})),total:101,omitted:1},
        reviews:{availability:'recorded',entries:Array.from({length:100},(_,i)=>({key:'review'+i+'x'.repeat(600),state:'selected',outcome:'clear',findingCount:0})),total:101,omitted:1},
        verificationEvidence:{availability:'unavailable',reason:'Missing observation '.repeat(600),requirements:Array.from({length:100},(_,i)=>({requirementId:'requirement'+i+'x'.repeat(600),kind:'manifest-scope-duty',strategyDigest:'a'.repeat(64),reviewKey:'independent-review',witnessAvailability:'unavailable',witnessIds:[],reviewLaunchIds:[]}))},
    });
    const text=changeResultText(view,'en');assert.ok(text.length<65536,text.length);
    for(const key of ['result.changes','result.checks','result.verificationEvidence','result.reviews','result.next','result.provenance','result.shortened','result.longLocation'])assert.ok(text.includes(uiText('en',key)),key);
    assert.ok(text.includes('/work original-work'));assert.ok(text.includes('101 additional entries are omitted'));
    assert.ok(!text.includes(uiText('en','result.noChanges')));assert.ok(!text.includes('\u009b'));
    // Exercise the real display component; reaching the end must retain provenance, not its overflow warning.
    const {InspectionDetails}=await import('../../dist/ui/inspection-details.js');
    const {initTheme}=await import('@earendil-works/pi-coding-agent');
    const {stripTerminalSequences,TuiAltScreen}=await import('@earendil-works/pi-tui');
    initTheme('dark',false);const detail=new InspectionDetails('Task result',text,()=>{});
    const terminal={columns:80,rows:24,kittyProtocolActive:false,start(){},stop(){},async drainInput(){},write(){},moveBy(){},clearLine(){},clearFromCursor(){},clearScreen(){},hideCursor(){},showCursor(){},setTitle(){},setProgress(){},setProgramStatus(){}};
    const screen=new TuiAltScreen(terminal,true);screen.setLayoutRoot(detail);let rendered='';
    try {
        screen.start();await new Promise(resolve=>setTimeout(resolve,30));
        for(let page=0;page<150;page++) {
            rendered=screen.getScreenLines().map(stripTerminalSequences).join('\n');
            assert.ok(!rendered.includes('[Display shortened; inspect the original retained work for full details]'));
            if(rendered.includes('Verification: verification'))break;
            detail.handleInput('\x1b[6~');screen.requestRender();await new Promise(resolve=>setTimeout(resolve,20));
        }
        assert.ok(rendered.includes('Verification: verification'),rendered);
    }finally{detail.dispose();screen.stop({preserveScreen:true});}
});

test('result discovery scopes to selected project, preserves exact selected work and rejects navigation drift',async t=>{
    const f=await registryWorld(t),cid=f.c.createConversation({projectId:'B'}).conversationId;
    f.c.setDraft({conversationId:cid,expectedRevision:0,text:'  Keep 한국어\nrequest  '});
    const before=workLedger(f.c),shown=[];let current=true;
    const host={controller:f.c,isCurrent:()=>current,show:async(title,text)=>shown.push({title,text}),choose:async(title,rows)=>{
        assert.match(title,/Task result · B/);assert.ok(!rows.some(row=>row.startsWith('Start a new')));
        assert.ok(!rows.some(row=>row.includes(f.works[0].workId)));
        return rows.find(row=>row.includes(f.works[1].workId));
    }};
    const registry=new HostCommands(changeCommands(host));
    await registry.execute('/result',cid);assert.equal(shown.length,1);assert.ok(shown[0].text.includes('Owner request 1 한국어'));
    await registry.execute('/result '+f.works[0].workId,cid);assert.ok(shown[1].text.includes('/work '+f.works[0].workId));
    const stale=new HostCommands(changeCommands({...host,choose:async(_title,rows)=>{current=false;return rows[0];}}));
    await assert.rejects(stale.execute('/result',cid),/target changed/);assert.equal(shown.length,2);
    assert.equal(f.c.inspectConversation(cid).draft.text,'  Keep 한국어\nrequest  ');assert.deepEqual(workLedger(f.c),before);
});

test('linked original result opens directly and work result returns to original menu without dispatch',async t=>{
    const f=await managedWorld(t),tasks=[];
    const starter=new HostCommands(changeCommands({controller:f.c,isCurrent:()=>true,choose:async(_title,rows)=>rows[0],show:async()=>{},controls:{models:f.models,input:async()=>undefined,draft:()=>'',notice(){},activateSource:async()=>assert.fail('Unexpected source switch'),launch:(_cid,task)=>tasks.push(task)}}));
    await starter.execute('/change start Preserve original identity',f.cid);const work=await tasks[0];
    const before=workLedger(f.c),shown=[],h={controller:f.c,isCurrent:()=>true,locale:()=> 'ko',show:async(title,text)=>shown.push({title,text})};
    await new HostCommands(changeCommands({...h,choose:async()=>assert.fail('Linked result should open directly')})).execute('/result',f.cid);
    assert.equal(shown[0].title,'작업 결과');assert.ok(shown[0].text.includes('Preserve original identity'));
    let menus=0;
    const registry=new HostCommands(workCommands({...h,choose:async(title,rows)=>{assert.ok(title.includes(work.workId));menus++;return menus===1?rows.find(row=>row==='결과 보기'):undefined;},input:async()=>assert.fail('No write form'),notice(){},activate:async()=>assert.fail('No navigation')}));
    assert.equal(await registry.execute('/work '+work.workId,f.cid),'cancelled');assert.equal(menus,2);assert.equal(shown.length,2);
    assert.equal(f.calls.length,1);assert.deepEqual(workLedger(f.c),before);f.pass();
});
