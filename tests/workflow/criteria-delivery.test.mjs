import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {prepareCriteriaDelivery, resolveCriteriaDelivery, workflowCriteriaManifest, criteriaOperatingProfile, freshCriteriaDeliveryVersion} from '../../dist/workflow/criteria-delivery.js';
import {loadCriteria} from '../../dist/controller/criteria.js';

const hash = text => createHash('sha256').update(text).digest('hex');
const names = ['MISSION.md','PRINCIPLES.md','DESIGN.md','CONTRACTS.md'];
function definition(overrides = {}) {
    const texts = {
        'MISSION.md': '# Mission\n\nPreserve executable owner intent. 한국어 💬\r\n',
        'PRINCIPLES.md': '# Principles\n\nRead required exceptions or hold.\n',
        'DESIGN.md': ['D2. Agent task path','D4. Enforcement and evidence','D5. Independent review','D6. Verification','D7. Records','D10. Delivery'].map(title=>`## ${title}\n\nUnchanged dependency for ${title.slice(0,3)}.\n\n`).join('') + 'Old removable condition.\n',
        'CONTRACTS.md': '## C2. Planning\n\nPreserve prior obligations.\n\n## C4. Resolution\n\nEvery pending finding needs accounting.\n',
        ...overrides,
    };
    const assets = Object.fromEntries(names.map(name=>[name,{sha256:hash(texts[name]),selected:texts[name]}]));
    return {id:randomUUID(),hash:hash(JSON.stringify(assets)),assets,text:'Canonical owned criteria.\n'+names.map(name=>`\n# ${name}\n${texts[name]}`).join('\n')};
}
const input = (changes={}) => ({id:randomUUID(),workId:randomUUID(),epoch:1,role:'adjudicator',stage:'planning-adjudication',artifactRoot:'/private/tmp/criteria-delivery-test',...changes});
const context = view => ({stage:view.manifest.stage,workflowCriteriaInput:{version:view.version,id:view.manifest.id},workflowCriteria:view});
const restore = prepared => resolveCriteriaDelivery(prepared.evidence.contents,prepared.view);
const rejection = fn => assert.throws(fn,/criteria delivery unavailable or corrupt/);
function rebindHeader(prepared, mutate) {
    const lines=prepared.evidence.contents.split('\n'),header=JSON.parse(lines[0]);
    mutate(header,prepared.view);lines[0]=JSON.stringify(header);
    prepared.evidence.contents=lines.join('\n');
    prepared.view.manifest.sha256=hash(prepared.evidence.contents);
    prepared.view.manifest.bytes=Buffer.byteLength(prepared.evidence.contents);
    return prepared;
}

test('adjudication v2 retains complete definitions with a smaller explicit core and frozen version1 recipes', async () => {
    const current={id:randomUUID(),...await loadCriteria()};
    for(const stage of ['planning-adjudication','review-adjudication']){
        const legacy=prepareCriteriaDelivery(current,null,input({stage})),core=prepareCriteriaDelivery(current,null,input({stage,version:2}));
        assert.equal(core.view.version,2);assert.equal(core.view.profile,'adjudication-v2');assert.equal(core.evidence.manifest.version,1,'Physical indexed carrier keeps its original grammar');
        assert.ok(Buffer.byteLength(core.operating)<Buffer.byteLength(legacy.operating)*0.65);
        assert.deepEqual(restore(core),{current,prior:null,operating:core.operating});assert.equal(restore(legacy).operating,legacy.operating);
        for(const section of ['C0','C2','C4'])assert.equal(core.view.catalogue.find(row=>row.side==='current'&&row.section===section).delivery,'eager');
        for(const section of ['C1','C3','C10','D4','D5'])assert.equal(core.view.catalogue.find(row=>row.side==='current'&&row.section===section).delivery,'read');
        assert.match(core.operating,/Read every omitted definition or exception needed for your judgment, or hold/);
        rejection(()=>workflowCriteriaManifest({...context(core.view),workflowCriteriaInput:{version:1,id:core.view.manifest.id}}));
        rejection(()=>workflowCriteriaManifest({...context(legacy.view),workflowCriteriaInput:{version:2,id:legacy.view.manifest.id}}));
    }
    for(const [role,stage]of [['planner','planning'],['challenger','planning-challenge'],['reviewer','fresh-review']])rejection(()=>prepareCriteriaDelivery(current,null,input({role,stage,version:2})));
});

test('exact current and prior definitions survive omitted and shared delivery, including removed clauses and Unicode', () => {
    const prior=definition(), current=definition({'DESIGN.md':prior.assets['DESIGN.md'].selected.replace('Old removable condition.','New current condition.')});
    const prepared=prepareCriteriaDelivery(current,prior,input()), resolved=restore(prepared);
    assert.deepEqual(resolved,{current,prior,operating:prepared.operating});
    assert.equal(prepared.view.catalogue.find(row=>row.id==='current:DESIGN.md:D10').delivery,'read');
    assert.equal(prepared.view.catalogue.find(row=>row.id==='prior:MISSION.md:all').delivery,'shared-current');
    assert.ok(prepared.operating.includes(current.assets['MISSION.md'].selected));
    assert.ok(prepared.operating.includes(current.assets['PRINCIPLES.md'].selected));
    assert.ok(prepared.operating.includes(current.assets['CONTRACTS.md'].selected));
    assert.ok(!prepared.operating.includes('New current condition.'));
    assert.deepEqual(prepared.view.additionalChangedBlocks.map(block=>block.text),['New current condition.\n','Old removable condition.\n']);
    assert.match(prepared.operating,/unchanged does not mean irrelevant/);
    assert.match(prepared.operating,/Read every omitted definition or exception needed for your judgment, or hold/);
    assert.equal(workflowCriteriaManifest(context(prepared.view)).sha256,prepared.evidence.manifest.sha256);
});

test('insertions do not classify shifted unchanged paragraphs as changed; fenced examples remain whole', () => {
    const prior=definition(), text=prior.assets['DESIGN.md'].selected;
    const added='Required new exception.\n\n```ts\nfirst();\n\nsecond();\n```\n\n';
    const current=definition({'DESIGN.md':text.replace('## D7. Records\n\n','## D7. Records\n\n'+added)});
    const prepared=prepareCriteriaDelivery(current,prior,input());
    assert.deepEqual(prepared.view.additionalChangedBlocks.map(block=>block.text),['Required new exception.\n\n','```ts\nfirst();\n\nsecond();\n```\n\n']);
    assert.deepEqual(restore(prepared).prior,prior);
});

test('changed eager clauses remain supplied once, while removed prior wording stays explicit', () => {
    const prior=definition(),current=definition({'CONTRACTS.md':prior.assets['CONTRACTS.md'].selected.replace('Preserve prior obligations.','New obligation and exception.')});
    const prepared=prepareCriteriaDelivery(current,prior,input());
    assert.match(prepared.operating,/New obligation and exception/);
    assert.deepEqual(prepared.view.additionalChangedBlocks.map(block=>block.text),['Preserve prior obligations.\n\n']);
    restore(prepared);
});

test('no prior version is explicit and no omitted definition is reported as already supplied', () => {
    const current=definition(),prepared=prepareCriteriaDelivery(current,null,input());
    assert.equal(prepared.view.prior,null);
    assert.deepEqual(prepared.view.additionalChangedBlocks,[]);
    assert.ok(prepared.view.catalogue.every(row=>row.side==='current'&&row.delivery!=='shared-current'));
    assert.equal(restore(prepared).current.text,current.text);
    assert.equal(prepared.view.catalogue.find(row=>row.section==='D7').title,'## D7. Records');
});

test('verification includes D6 and unsupported role/stage pairs cannot acquire artifact access', () => {
    const current=definition();
    const prepared=prepareCriteriaDelivery(current,null,input({role:'reviewer',stage:'fresh-review'}));
    assert.equal(prepared.view.profile,'verification-v1');
    assert.equal(prepared.view.catalogue.find(row=>row.section==='D6').delivery,'eager');
    restore(prepared);
    assert.equal(criteriaOperatingProfile('reviewer','planning'),undefined);
    rejection(()=>prepareCriteriaDelivery(current,null,input({role:'reviewer',stage:'planning'})));
});

test('fresh review v3 supplies verification and review criteria with exact deferred and changed definitions', async () => {
    const current = {id: randomUUID(), ...await loadCriteria()};
    const prior = definition({
        ...Object.fromEntries(names.map(name => [name, current.assets[name].selected])),
        'DESIGN.md': current.assets['DESIGN.md'].selected.replace(/(^## D6\.[^\n]+\n)/m, '$1\nOriginal replaced verification exception.\n'),
    });
    const reviewer = {role: 'reviewer', stage: 'fresh-review'};
    const legacy = prepareCriteriaDelivery(current, prior, input(reviewer));
    const fresh = prepareCriteriaDelivery(current, prior, input({...reviewer, version: 3}));
    assert.equal(fresh.view.profile, 'fresh-review-v3');
    assert.equal(fresh.view.manifest.version, 1);
    assert.ok(Buffer.byteLength(fresh.operating) < Buffer.byteLength(legacy.operating) * 0.6);
    const eager = fresh.view.catalogue.filter(row => row.delivery === 'eager').map(row => row.id);
    assert.deepEqual(new Set(eager), new Set(['current:MISSION.md:all', 'current:PRINCIPLES.md:all', 'current:CONTRACTS.md:C0', 'current:CONTRACTS.md:C3', 'current:CONTRACTS.md:C4']));
    assert.ok(fresh.view.additionalChangedBlocks.some(block => block.recordId === 'prior:DESIGN.md:D6' && block.text.includes('Original replaced verification exception.')));
    assert.match(fresh.operating, /Read every omitted definition or exception needed for your judgment, or hold/);
    assert.deepEqual(restore(fresh), {current, prior, operating: fresh.operating});
    assert.deepEqual(restore(legacy), {current, prior, operating: legacy.operating});
    rejection(() => workflowCriteriaManifest({...context(fresh.view), workflowCriteriaInput: {version: 1, id: fresh.view.manifest.id}}));
    rejection(() => prepareCriteriaDelivery(current, prior, input({version: 3})));
});

test('fresh planner and challenger use one compact criteria core and retain exact deferred definitions', async () => {
    const current = {id: randomUUID(), ...await loadCriteria()};
    const prior = definition({
        ...Object.fromEntries(names.map(name => [name, current.assets[name].selected])),
        'CONTRACTS.md': current.assets['CONTRACTS.md'].selected.replace(/(^## C4\.[^\n]+\n)/m, '$1\nOriginal review exception.\n'),
    });
    const eager = new Set(['current:MISSION.md:all', 'current:PRINCIPLES.md:all',
        'current:CONTRACTS.md:C0', 'current:CONTRACTS.md:C1', 'current:CONTRACTS.md:C2', 'current:CONTRACTS.md:C3']);
    for (const [role, stage] of [['planner', 'planning'], ['challenger', 'planning-challenge']]) {
        const version = freshCriteriaDeliveryVersion(role, stage);
        assert.equal(version, 3);
        const fresh = prepareCriteriaDelivery(current, prior, input({role, stage, version}));
        const legacy = prepareCriteriaDelivery(current, prior, input({role, stage, version: 1}));
        assert.equal(fresh.view.profile, 'planning-v3');
        assert.equal(legacy.view.profile, 'planning-v1');
        assert.deepEqual(new Set(fresh.view.catalogue.filter(row => row.delivery === 'eager').map(row => row.id)), eager);
        assert.ok(Buffer.byteLength(fresh.operating) < Buffer.byteLength(legacy.operating) * 0.55);
        assert.ok(fresh.view.additionalChangedBlocks.some(block => block.recordId === 'prior:CONTRACTS.md:C4' && block.text.includes('Original review exception.')));
        assert.deepEqual(restore(fresh), {current, prior, operating: fresh.operating});
        assert.deepEqual(restore(legacy), {current, prior, operating: legacy.operating});
        rejection(() => workflowCriteriaManifest({...context(fresh.view), stage: role === 'planner' ? 'planning-challenge' : 'planning'}));
        rejection(() => workflowCriteriaManifest({...context(fresh.view), workflowCriteriaInput: {version: 1, id: fresh.view.manifest.id}}));
    }
});

test('source-fit v3 binds its independent receiver and preserves the exact deferred definitions', async () => {
    const current = {id: randomUUID(), ...await loadCriteria()};
    const prior = definition({
        ...Object.fromEntries(names.map(name => [name, current.assets[name].selected])),
        'CONTRACTS.md': current.assets['CONTRACTS.md'].selected.replace(/(^## C3\.[^\n]+\n)/m, '$1\nOriginal verification rule pending replacement.\n'),
    });
    const receiver = {role: 'adjudicator', stage: 'source-fit'};
    const prepared = prepareCriteriaDelivery(current, prior, input({...receiver, version: 3}));
    assert.equal(prepared.view.profile, 'source-fit-v3');
    assert.equal(prepared.view.manifest.version, 1);
    const eager = new Set(prepared.view.catalogue.filter(row => row.delivery === 'eager').map(row => row.id));
    assert.deepEqual(eager, new Set(['current:MISSION.md:all', 'current:PRINCIPLES.md:all', 'current:CONTRACTS.md:C0', 'current:CONTRACTS.md:C1', 'current:CONTRACTS.md:C2']));
    assert.ok(prepared.view.additionalChangedBlocks.some(block => block.recordId === 'prior:CONTRACTS.md:C3' && block.text.includes('Original verification rule pending replacement.')));
    assert.deepEqual(restore(prepared), {current, prior, operating: prepared.operating});
    for (const version of [1, 2]) {
        rejection(() => prepareCriteriaDelivery(current, null, input({...receiver, version})));
        rejection(() => workflowCriteriaManifest({...context(prepared.view), workflowCriteriaInput: {version, id: prepared.view.manifest.id}}));
    }
    rejection(() => prepareCriteriaDelivery(current, prior, input({...receiver, role: 'reviewer', version: 3})));
    const differentProfile = {...prepared.view, profile: 'fresh-review-v3'};
    rejection(() => workflowCriteriaManifest(context(differentProfile)));
    rejection(() => resolveCriteriaDelivery(prepared.evidence.contents + ' ', prepared.view));
});

test('implementation and substantive repair use one exact v3 authoring core', async () => {
    const current = {id: randomUUID(), ...await loadCriteria()};
    const expected = new Set(['current:MISSION.md:all', 'current:PRINCIPLES.md:all',
        'current:CONTRACTS.md:C0', 'current:CONTRACTS.md:C2', 'current:CONTRACTS.md:C3', 'current:CONTRACTS.md:C4']);
    const stages = [['implementer', 'implementation'], ['repairer', 'substantive-repair']];
    for (const [role, stage] of stages) {
        const prepared = prepareCriteriaDelivery(current, null, input({role, stage, version: 3}));
        assert.equal(prepared.view.profile, 'authoring-v3');
        assert.equal(prepared.view.manifest.version, 1);
        assert.deepEqual(new Set(prepared.view.catalogue.filter(row => row.delivery === 'eager').map(row => row.id)), expected);
        assert.equal(prepared.view.catalogue.find(row => row.id === 'current:DESIGN.md:D6').delivery, 'read');
        assert.deepEqual(restore(prepared), {current, prior: null, operating: prepared.operating});
    }
    rejection(() => prepareCriteriaDelivery(current, null, input({role: 'repairer', stage: 'implementation', version: 3})));
    rejection(() => prepareCriteriaDelivery(current, null, input({role: 'implementer', stage: 'substantive-repair', version: 3})));
});

test('catalogue presentation and changed text cannot be altered independently of the original artifact', () => {
    const prior=definition(),current=definition({'DESIGN.md':prior.assets['DESIGN.md'].selected.replace('Old removable condition.','New condition.')});
    const prepared=prepareCriteriaDelivery(current,prior,input());
    for (const mutate of [
        view=>{view.additionalChangedBlocks=[];},
        view=>{view.additionalChangedBlocks[0].text='Invented clause.';},
        view=>{view.additionalChangedBlocks[0].ordinal++;},
        view=>{view.catalogue.find(row=>row.id==='current:DESIGN.md:D7').delivery='eager';},
        view=>{view.catalogue.find(row=>row.delivery==='shared-current').sharedWith='current:DESIGN.md:D2';},
        view=>{view.catalogue[0]=structuredClone(view.catalogue[1]);},
        view=>{view.catalogue.pop();},
        view=>{view.catalogue[0].title='Misleading dependency';},
        view=>{view.catalogue[0].sha256='0'.repeat(64);},
        view=>{view.current.textSha256='0'.repeat(64);},
        view=>{view.prior=null;},
        view=>{view.manifest.role='planner';},
        view=>{view.manifest.path='/private/tmp/foreign.jsonl';},
        view=>{view.extra='ignored';},
    ]) {
        const view=structuredClone(prepared.view);mutate(view);
        rejection(()=>resolveCriteriaDelivery(prepared.evidence.contents,view));
    }
    rejection(()=>resolveCriteriaDelivery(prepared.evidence.contents+' ',prepared.view));
});

test('missing declaration or view cannot silently downgrade to legacy', () => {
    const prepared=prepareCriteriaDelivery(definition(),null,input());
    assert.equal(workflowCriteriaManifest({stage:'planning'}),undefined);
    rejection(()=>workflowCriteriaManifest({stage:'planning-adjudication',workflowCriteria:prepared.view}));
    rejection(()=>workflowCriteriaManifest({stage:'planning-adjudication',workflowCriteriaInput:{version:1,id:prepared.view.manifest.id}}));
    rejection(()=>workflowCriteriaManifest({...context(prepared.view),stage:'fresh-review'}));
});

test('decoder verifies changed-clause completeness even when a producer omitted it consistently', () => {
    const prior=definition(),current=definition({'DESIGN.md':prior.assets['DESIGN.md'].selected.replace('Old removable condition.','New condition.')});
    const prepared=structuredClone(prepareCriteriaDelivery(current,prior,input()));
    rebindHeader(prepared,(header,view)=>{header.presentation.additionalChangedBlocks=[];view.additionalChangedBlocks=[];});
    rejection(()=>restore(prepared));
});

test('historical decoding uses the captured operating recipe rather than today\'s banner writer', () => {
    const current=definition(),prepared=structuredClone(prepareCriteriaDelivery(current,null,input()));
    let captured;
    rebindHeader(prepared,(header,view)=>{
        header.operating.parts[0]='Earlier supported profile wording.\n';
        const all=new Map(names.flatMap(name=>{
            const selected=current.assets[name].selected;
            return name==='DESIGN.md'||name==='CONTRACTS.md' ? selected.split(/(?=^## [DC]\d+\.)/m).map(text=>[`current:${name}:${/^## ([DC]\d+)\./.exec(text)?.[1]??'preamble'}`,text]) : [[`current:${name}:all`,selected]];
        }));
        captured=header.operating.parts.map(part=>typeof part==='string'?part:all.get(part.record)).join('');
        header.operating.sha256=hash(captured);view.operatingSha256=hash(captured);
    });
    assert.equal(restore(prepared).operating,captured);
    assert.equal(restore(prepared).current.text,current.text);
});

test('malformed canonical snapshots and oversized artifacts refuse before dispatch', () => {
    for (const mutate of [
        current=>{current.text+='hidden normative text';},
        current=>{current.hash='0'.repeat(64);},
        current=>{current.assets['MISSION.md'].sha256='unknown';current.hash=hash(JSON.stringify(current.assets));},
    ]) {
        const current=definition();mutate(current);
        rejection(()=>prepareCriteriaDelivery(current,null,input()));
    }
    rejection(()=>prepareCriteriaDelivery(definition({'DESIGN.md':'## D2. Missing core sections\n'}),null,input()));
    rejection(()=>prepareCriteriaDelivery(definition({'MISSION.md':'# Mission\n'+'x'.repeat(1024*1024)}),null,input()));
});

test('current maintained normative assets round-trip exactly without changing canonical identity', async () => {
    const current={id:randomUUID(),...await loadCriteria()},prior=structuredClone(current);prior.id=randomUUID();
    const prepared=prepareCriteriaDelivery(current,prior,input()),resolved=restore(prepared);
    assert.deepEqual(resolved.current,current);assert.deepEqual(resolved.prior,prior);
    assert.deepEqual(prepared.view.additionalChangedBlocks,[]);
    assert.ok(Buffer.byteLength(prepared.operating)<Buffer.byteLength(current.text));
});
