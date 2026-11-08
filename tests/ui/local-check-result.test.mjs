import test from 'node:test';
import assert from 'node:assert/strict';
import {localCheckCommands} from '../../dist/ui/local-check-commands.js';
import {localCheckResultText,localCheckReviewText} from '../../dist/ui/local-check-result.js';

// UI boundary fixture: retained execution facts are controlled, not a real engine qualification.
function fixture(overrides={}) {
    const result={workId:'W',runId:'R',kind:'command-observation',status:'succeeded',exitCode:0,captureRef:'capture',actualCwd:'/work',scratchInput:'mutable-or-unknown',cleanup:'removed',limitations:['Adequacy unknown'],stdout:'original stdout',stderr:'original stderr',...overrides};
    let view={workId:'W',projectId:'P',state:'DELIVERED',cwd:'work',command:'node check.cjs',epoch:1,generation:1,unsettled:false,
        latestRun:{runId:'R',resultId:'result',phase:'SETTLED',cleanup:'removed',command:'node check.cjs',runtime:{image:'captured'}},
        result:{resultId:'result',runId:'R',status:result.status,exitCode:result.exitCode,cleanup:result.cleanup}};
    const choices=['/work · captured project, read only','Run new independent check'],shown=[],evidence=[];let calls=0,current=true;
    const c={options:{runtimeProfile:{image:'active'}},inspectLocalCheck:id=>{assert.equal(id,'W');return structuredClone(view);},startOwnerLocalCheck:async()=>{calls++;return result;}};
    const host={controller:c,projectId:'P',signal:new AbortController().signal,guard:()=>{if(!current)throw Error('Source changed');},input:async()=> 'node check.cjs',choose:async(_title,rows)=>{const action=choices.shift();assert.ok(action===undefined||rows.includes(action),JSON.stringify(rows));return action;},show:async(title,value)=>shown.push({title,value}),notice(){},track:task=>task,evidence:async(original,action)=>evidence.push({original,action})};
    return {result,c,host,choices,shown,evidence,get view(){return view;},set view(value){view=value;},get calls(){return calls;},stale(){current=false;},run:()=>localCheckCommands(host).newCheck()};
}

test('successful new check proceeds directly to exact original candidate review once and keeps the raw receipt',async()=>{
    const f=fixture();f.choices.push('Inspect original receipt','Record exact commit candidate');
    assert.equal(await f.run(),true);assert.equal(f.calls,1);assert.equal(f.evidence.length,1);
    assert.deepEqual(f.evidence[0],{original:f.view,action:'record'});
    assert.deepEqual(f.shown.find(x=>x.title.startsWith('Original local check receipt')).value,f.result);
    assert.match(f.shown[1].value,/command finished successfully/);assert.match(f.shown[1].value,/Before recording.*current project and staged files/s);
});

for(const cancel of [undefined,'Return to local tools'])test('returning from result does not inspect or record evidence: '+String(cancel),async()=>{
    const f=fixture();f.choices.push(cancel);assert.equal(await f.run(),true);assert.equal(f.evidence.length,0);assert.equal(f.calls,1);
});

for(const kind of ['failed','scratch','unknown-cleanup','unsettled','older-result','wrong-command'])test('result does not offer candidate recording for '+kind,async()=>{
    const f=fixture(kind==='failed'?{status:'failed',exitCode:1}:kind==='scratch'?{actualCwd:'/scratch'}:kind==='unknown-cleanup'?{cleanup:'unknown'}:{});
    if(kind==='scratch')f.view.cwd='scratch';
    if(kind==='unsettled')f.view.unsettled=true;
    if(kind==='older-result')f.view.latestRun.runId='NEW-RUN';
    if(kind==='wrong-command')f.view.latestRun.command='different later command';
    const choose=f.host.choose;f.host.choose=async(title,rows)=>{if(title==='Next step for this check'){assert.ok(!rows.some(row=>row.includes('commit candidate')));assert.ok(!rows.includes('Inspect current check correspondence'));return rows[0];}return choose(title,rows);};
    assert.equal(await f.run(),true);assert.equal(f.evidence.length,0);assert.equal(f.calls,1);
    assert.ok(f.shown[1].value.includes('node check.cjs'));assert.ok(!f.shown[1].value.includes('different later command'));
});

for(const drift of ['run','source','runtime'])test('changed '+drift+' cannot replace reviewed result at evidence handoff',async()=>{
    const f=fixture(),choose=f.host.choose;f.host.choose=async(title,rows)=>{
        if(title!=='Next step for this check')return choose(title,rows);
        if(drift==='run')f.view.latestRun.runId='NEW-RUN';else if(drift==='source')f.stale();else f.c.options.runtimeProfile={image:'changed'};
        return 'Record exact commit candidate';
    };
    await assert.rejects(f.run(),error=>error.workId==='W'&&/changed/i.test(error.message));assert.equal(f.evidence.length,0);assert.equal(f.calls,1);
});

test('scope and control-bearing command remain explicit without interpreting scratch success as verification',()=>{
    const f=fixture({actualCwd:'/scratch'}),text=localCheckResultText(f.result,'printf "\u009b"');
    assert.ok(text.includes('\\u009b'));assert.ok(!text.includes('\u009b'));assert.match(text,/scratch-directory result does not establish/);assert.match(text,/does not establish test adequacy/);
});
test('large escaped command cannot hide result scope, cleanup or original identity',()=>{
    const f=fixture(),text=localCheckResultText(f.result,'\u009b'.repeat(16000));
    assert.ok(text.length<65536);assert.match(text,/Command preview shortened/);
    for(const value of ['cleanup: removed','Original work: W','Result run: R','does not establish test adequacy'])assert.ok(text.includes(value));
    assert.ok(text.indexOf('Original work: W')<text.indexOf('Requested command'));
    assert.ok(!text.includes('Full stdout'));
});

test('check review makes exact command, runtime and retained spend readable before confirmation',()=>{
    const active={dockerBinary:'/trusted/docker',dockerContext:'current',image:'sha256:current'},previous={...active,dockerContext:'historical',image:'sha256:previous'};
    const review=localCheckReviewText({workId:'W',projectId:'P',command:'printf "\u009b"',cwd:'/scratch',state:'CANCELLED',allowance:{execution:{limit:8,consumed:3,reserved:0}},previousRuntime:previous,nextAttemptRuntime:active,scope:'Same original work and command.'});
    const body=review.split('\n\nOriginal observation')[0];
    assert.match(body,/^Run another attempt/);assert.match(body,/3 used · 0 reserved · 8 total/);assert.match(body,/This cannot establish staged-source correspondence/);
    assert.ok(body.includes('Exact command: "printf \\"\\u009b\\""'));assert.doesNotMatch(body,/\u009b/);
    assert.ok(body.indexOf('Active runtime for the next attempt')<body.indexOf('"current"'));
    assert.ok(body.indexOf('Previous attempt runtime · historical only')<body.indexOf('"historical"'));
    assert.match(body,/Back starts no new attempt/);
});

test('unreviewably large escaped command refuses before confirmation or work admission',async()=>{
    const f=fixture();f.host.input=async()=> '\u009b'.repeat(6500);
    await assert.rejects(f.run(),/exceed the terminal review limit/);
    assert.equal(f.calls,0);assert.equal(f.shown.length,0);assert.equal(f.choices.length,1);
});

test('check output preview is readable and explicitly bounded without changing outcome scope',()=>{
    const f=fixture({stdout:'Answer is 3\n',stderr:'warning\u009b'}),text=localCheckResultText(f.result,'node check.cjs');
    assert.ok(text.includes('Output: "Answer is 3\\n"'));assert.ok(text.includes('Error output: "warning\\u009b"'));assert.doesNotMatch(text,/\u009b/);
    const long=localCheckResultText({...f.result,stdout:'x'.repeat(20000)},'node check.cjs');
    assert.match(long,/Output preview shortened/);assert.match(long,/Original work: W/);assert.match(long,/does not establish test adequacy/);assert.ok(long.length<10000);
});
