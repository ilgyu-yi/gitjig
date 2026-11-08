import test from 'node:test';
import assert from 'node:assert/strict';
import {inputCommands} from '../../dist/ui/input-commands.js';

test('cancelling reviewed retry does not acknowledge or clear its command draft',async()=>{
    const input={inputId:'I',fingerprint:'current',eligible:true,text:'original',explanation:'not yet sent',blockingWorkIds:[]};
    let choice=0,acknowledged=0;
    const command=inputCommands({controller:{inspectConversationInputs:()=>[input]},isCurrent:()=>true,
        choose:async(_title,rows)=>choice++===0?rows[0]:'Retry original request',show:async()=>{},retry:async()=>false,
        inspectWork:async()=>assert.fail('Unexpected work inspection'),notice:()=>{}})[0];
    assert.equal(await command.run('', 'C', {acknowledgeSubmission:()=>acknowledged++}), 'cancelled');
    assert.equal(acknowledged,0);
});
