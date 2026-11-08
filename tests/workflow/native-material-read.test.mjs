import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeRoleEntries,nativeRoleMaterial} from '../../dist/workflow/native-role-output.js';
import {nativeSubmissionToolName} from '../../dist/workflow/native-submission-source.js';

function trace() {
    const intent='intent',entries=[{id:intent,type:'custom',customType:nativeRoleEntries.intent,
        data:{request:{version:3,carrier:'tool-submission/v1'}}}];
    const sdk=(id,message)=>entries.push({id,type:'custom',customType:nativeRoleEntries.sdk,
        data:{intentEntryId:intent,message:{session_id:'native',parent_tool_use_id:null,...message}}});
    const event=(id,event,parent=null)=>sdk(id,{type:'stream_event',parent_tool_use_id:parent,event});
    return {intent,entries,sdk,event,read:options=>nativeRoleMaterial(entries,intent,options)};
}

test('material read preserves received claims alongside separate extraction and global coverage faults',()=>{
    const f=trace();
    f.event('unowned',{type:'content_block_delta',index:0,delta:{type:'text_delta',text:'Received claim'}});
    f.sdk('missing-input',{type:'assistant',message:{id:'assistant',content:[{type:'tool_use',id:'tool',name:nativeSubmissionToolName}]}});
    const before=structuredClone(f.entries),read=f.read();
    assert.deepEqual(read.materials.map(m=>[m.sourceEntryId,m.raw,m.complete,m.invalid]),[['unowned','Received claim',false,true]]);
    assert.deepEqual(read.diagnostics.extraction,{count:1,sample:[{entryId:'missing-input',reason:'original submission input is not JSON'}]});
    assert.deepEqual(read.diagnostics.prefix,{count:1,sample:[{entryId:'unowned',sourceEntryId:null,reason:'unowned-public-delta'}],sources:new Set([null])});
    assert.deepEqual(f.entries,before);
    assert.deepEqual(nativeRoleMaterial(JSON.parse(JSON.stringify(f.entries)),f.intent),read);
});

test('repeated starts retain both original claims and distinguish detecting entries from affected sources',()=>{
    const f=trace();
    f.event('message',{type:'message_start',message:{id:'message'}});
    for(const id of ['first','second'])f.event(id,{type:'content_block_start',index:0,content_block:{type:'text',text:id}});
    f.event('stop',{type:'message_stop'});
    const {materials,diagnostics}=f.read();
    assert.deepEqual(materials.map(m=>[m.sourceEntryId,m.raw,m.invalid]),[['first','first',true],['second','second',true]]);
    assert.equal(diagnostics.extraction.count,0);
    assert.deepEqual(diagnostics.prefix,{count:4,sources:new Set([null,'first','second']),sample:[
        {entryId:'second',sourceEntryId:null,reason:'repeated-block-start'},
        {entryId:'second',sourceEntryId:'first',reason:'conflicting-block-start'},
        {entryId:'second',sourceEntryId:'second',reason:'conflicting-block-start'},
        {entryId:'stop',sourceEntryId:'second',reason:'message-stopped-with-open-block'},
    ]});
});

test('diagnostic sample bounds preserve exact totals, late coverage and independent extraction samples',()=>{
    const f=trace();
    for(let i=0;i<70;i++){
        f.event('message-'+i,{type:'message_start',message:{id:'message-'+i}});
        f.event('source-'+i,{type:'content_block_start',index:0,content_block:{type:'text',text:'Received '+i}});
        f.event('stop-'+i,{type:'message_stop'});
    }
    f.event('late-global',{type:'content_block_delta',index:0,delta:{type:'text_delta',text:'Unowned'}},'other-parent');
    for(let i=0;i<65;i++)f.sdk('issue-'+i,{type:'assistant',message:{content:[{type:'tool_use',name:nativeSubmissionToolName}]}});
    const {materials,diagnostics}=f.read();
    assert.equal(materials.length,71);
    assert.equal(diagnostics.prefix.count,71);
    assert.equal(diagnostics.prefix.sample.length,64);
    assert.deepEqual(diagnostics.prefix.sources,new Set([...Array.from({length:70},(_,i)=>'source-'+i),null]));
    assert.equal(diagnostics.extraction.count,65);
    assert.equal(diagnostics.extraction.sample.length,64);
    assert.equal(diagnostics.extraction.sample[0].entryId,'issue-0');
    assert.equal(diagnostics.extraction.sample[63].entryId,'issue-63');
});

test('material result keeps exact stream aliases optional and conflicting original identities visible',()=>{
    const f=trace();
    f.event('start',{type:'message_start',message:{id:'message'}});
    f.event('text',{type:'content_block_start',index:0,content_block:{type:'text',text:'Claim'}});
    f.event('block-stop',{type:'content_block_stop',index:0});
    f.event('message-stop',{type:'message_stop'});
    const assistant={type:'assistant',uuid:'sdk-message',message:{id:'message',content:[{type:'text',text:'Claim'}]}};
    f.sdk('assistant',assistant);f.sdk('copy',structuredClone(assistant));
    assert.deepEqual(f.read().materials.map(m=>m.sourceEntryId),['assistant']);
    assert.deepEqual(f.read({includeTextStreamAliases:true}).materials.map(m=>m.sourceEntryId),['text','assistant']);
    f.sdk('conflict',{...assistant,message:{id:'message',content:[{type:'text',text:'Other claim'}]}});
    const {materials,diagnostics}=f.read();
    assert.deepEqual(materials.map(m=>m.raw),['Claim','Claim','Other claim']);
    assert.deepEqual(diagnostics.extraction,{count:1,sample:[{entryId:'conflict',reason:'conflicting original SDK message identity'}]});
    assert.equal(diagnostics.prefix.count,0);
});

test('zero diagnostics do not turn an interrupted original stream into complete material',()=>{
    const f=trace();
    f.event('message',{type:'message_start',message:{id:'message'}});
    f.event('partial',{type:'content_block_start',index:0,content_block:{type:'text',text:'Partial claim'}});
    const {materials,diagnostics}=f.read();
    assert.equal(diagnostics.extraction.count,0);assert.equal(diagnostics.prefix.count,0);
    assert.deepEqual(materials.map(m=>[m.raw,m.complete,m.invalid]),[['Partial claim',false,true]]);
});

for(const duplicate of [false,true])test('text alias index preserves received block order and duplicate open-stream ambiguity '+duplicate,()=>{
    const f=trace();f.event('start',{type:'message_start',message:{id:'shared'}});
    f.event('text-B',{type:'content_block_start',index:1,content_block:{type:'text',text:'B'}});
    f.event('opaque',{type:'content_block_start',index:2,content_block:{type:'thinking'}});
    f.event('text-A',{type:'content_block_start',index:0,content_block:{type:'text',text:'A'}});
    for(const index of [1,2,0])f.event('stop-'+index,{type:'content_block_stop',index});
    f.event('end',{type:'message_stop'});
    f.sdk('assistant',{type:'assistant',message:{id:'shared',content:[{type:'text',text:'B'},{type:'text',text:'A'}]}});
    if(duplicate){f.event('duplicate-start',{type:'message_start',message:{id:'shared'}});f.event('duplicate-text',{type:'content_block_start',index:0,content_block:{type:'text',text:'Other'}});}
    assert.deepEqual(f.read().materials.map(m=>m.sourceEntryId),duplicate?['text-B','text-A','assistant','assistant','duplicate-text']:['assistant','assistant']);
    assert.deepEqual(f.read({includeTextStreamAliases:true}).materials.map(m=>m.raw),duplicate?['B','A','B','A','Other']:['B','A','B','A']);
});
test('text alias index keeps equal message IDs in separate parent namespaces',()=>{
    const f=trace();
    for(const parent of [null,'child']){
        const id=parent??'root';f.event(id+'-start',{type:'message_start',message:{id:'same'}},parent);
        f.event(id+'-text',{type:'content_block_start',index:0,content_block:{type:'text',text:id}},parent);
        f.event(id+'-block-stop',{type:'content_block_stop',index:0},parent);f.event(id+'-stop',{type:'message_stop'},parent);
        f.sdk(id+'-assistant',{type:'assistant',parent_tool_use_id:parent,message:{id:'same',content:[{type:'text',text:id}]}});
    }
    assert.deepEqual(f.read().materials.map(m=>m.sourceEntryId),['root-assistant','child-assistant']);
});
