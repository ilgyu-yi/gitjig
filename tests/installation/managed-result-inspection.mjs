import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {stripVTControlCharacters} from 'node:util';

// The immutable installed launcher and existing terminal consumer remain the
// only application entry. Read-only SQLite observes evidence; it creates none.
export async function inspectInstalledManagedResult({root, project, workId, view, operationId, read, terminal, requests, reviews, sourceBase}) {
    const candidate=view.versions.find(version=>version.id===view.candidateVersion);
    assert.ok(candidate?.artifact);assert.equal(view.reviewReady,true);
    const selected=read(db=>db.prepare('SELECT selected FROM interaction_view').get().selected);
    assert.equal(read(db=>db.prepare('SELECT work FROM conversation_state WHERE conversation=?').get(selected).work),workId,
        'Menu result must resolve the original selected conversation without copying a work ID');
    const tables=['works','sources','requirements','change_state','change_versions','runs','budgets','check_runs',
        'role_launches','role_outputs','finding_occurrences','finding_dispositions','remedy_confirmations','obligations',
        'effect_operations','effect_delegations','effect_receipts','conversation_inputs','capacity_leases','results','observations'];
    const snapshot=()=>read(db=>Object.fromEntries(tables.map(table=>[table,db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()])));
    const before=snapshot(),beforeRequests=requests.length,beforeReviews=reviews.length;
    const queries=[...tables.map(table=>({sql:'SELECT COUNT(*) FROM '+table,rows:[[before[table].length]]})),
        {sql:'SELECT * FROM budgets ORDER BY rowid',rows:before.budgets.map(Object.values)},
        {sql:'SELECT phase FROM effect_operations WHERE id=?',params:[operationId],rows:[['CONFIRMED']]},
        {sql:"SELECT COUNT(*) FROM effect_receipts WHERE operation=? AND kind='send'",params:[operationId],rows:[[1]]}];
    const draft='  Keep this unsent installed result question 한국어  ';
    const preserved={queries,assertDraft:draft,expectedSelected:selected,expectedInputs:before.conversation_inputs.length};
    const label='landed-result-inspection';
    await terminal(label,[
        {wait:'Model: original',queries,send:'\x15\x1b[200~'+draft+'\x1b[201~\x07'},
        {wait:'Commands · Ctrl+G',...preserved,send:'r'},
        // Consume the complete first inspection frame before scrolling. A match
        // near its top can otherwise leave its tail in the next PTY read.
        {wait:'up / down scroll · pageUp / pageDown page',...preserved,send:'\x1b[6~'},
        {wait:'Evidence identifiers · details',...preserved,send:'\x1b[5~'},
        {wait:'Saved output · candidate snapshot',...preserved,send:'\x1b'},
        {wait:'INPUT · Conversation idle',...preserved,send:'\x07'},
        {wait:'Commands · Ctrl+G',...preserved,send:'q'},
    ]);
    const inspectOutput=async(name)=>{
        const file=path.join(root,name+'.json.terminal'),progress=JSON.parse(await fs.readFile(file+'.progress.json','utf8'));
        assert.equal(progress.error,null);assert.equal(progress.stage,7);
        const bytes=await fs.readFile(file),offsets=progress.actionOutputOffsets;
        // Only bytes displayed between opening and closing the real result view.
        const text=stripVTControlCharacters(bytes.subarray(offsets[1],offsets[4]).toString('utf8'));
        const compact=text.replace(/\s/gu,'');
        for(const expected of ['Task result','Checks and required review passed for this candidate.','Saved output · candidate snapshot','Modified · "consumer.cjs"',
            'Checks for this candidate and verification plan','Passed · "value"','Selected review evidence','Review clear',
            'Delivery is separate. Publication, merge and current destination state are not inspected here.',
            'The original folder has not been compared here. Opening this result applies no files.',
            JSON.stringify(candidate.artifact),JSON.stringify(project)])
            assert.ok(compact.includes(expected.replace(/\s/gu,'')),name+' displayed '+expected);
        assert.ok(!text.includes('CONFIRMED'),'A task result must not infer or advertise native destination state');
    };
    await inspectOutput(label);
    assert.deepEqual(snapshot(),before);assert.equal(requests.length,beforeRequests);assert.equal(reviews.length,beforeReviews);
    assert.equal(read(db=>db.prepare('SELECT draft FROM conversation_views WHERE conversation=?').get(selected).draft),draft);
    const reopen='landed-result-pure-reopen';
    await terminal(reopen,[
        {wait:'Model: original',...preserved,send:'\x07'},
        {wait:'Commands · Ctrl+G',...preserved,send:'r'},
        {wait:'up / down scroll · pageUp / pageDown page',...preserved,send:'\x1b[6~'},
        {wait:'Evidence identifiers · details',...preserved,send:'\x1b[5~'},
        {wait:'Saved output · candidate snapshot',...preserved,send:'\x1b'},
        {wait:'INPUT · Conversation idle',...preserved,send:'\x07'},
        {wait:'Commands · Ctrl+G',...preserved,send:'q'},
    ]);
    await inspectOutput(reopen);
    assert.deepEqual(snapshot(),before);assert.equal(requests.length,beforeRequests);assert.equal(reviews.length,beforeReviews);
    assert.equal(read(db=>db.prepare('SELECT draft FROM conversation_views WHERE conversation=?').get(selected).draft),draft);
    assert.equal(await fs.readFile(path.join(project,'consumer.cjs'),'utf8'),sourceBase);
    return {workId,candidateVersion:view.candidateVersion,operationId,opens:2,exactDraftRetained:true,
        scope:'Pure installed task-result inspection after separately confirmed local branch delivery. Result view reports retained candidate/check/review and excludes current native destination observation; no new execution or send.'};
}
