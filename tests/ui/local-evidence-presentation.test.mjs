// Synthetic observations isolate rendering only; actual controller/native chains
// remain covered by local-evidence-commands and the runtime result consumer.
import test from 'node:test';
import assert from 'node:assert/strict';
import {localEvidenceText,localCandidateText,localCandidateReviewText,localAuditText,localAuditReviewText,localUnavailableCandidateText} from '../../dist/ui/local-evidence-presentation.js';
const details=text=>JSON.parse(text.split('\n\nOriginal observation · details\n\n')[1]);
const sha=character=>character.repeat(64);
const check={workId:'original-work',runId:'original-run',resultId:'original-result',observationId:'original-observation',capture:sha('a'),binding:sha('b')};
const candidate={version:1,id:'candidate-id',projectId:'project',createdAt:'2026-10-30T00:00:00Z',home:{path:'/private/home',identity:{device:'1',inode:'2'}},source:{path:"/project/owner's tree",identity:{device:'1',inode:'3'}},index:{objectFormat:'sha1',roster:{sha256:sha('c'),entries:2,directories:1},parent:'d'.repeat(40),intendedBranch:'feature/test'},messageSha256:sha('e'),policy:{revision:2,hash:sha('f'),rules:{}},check};
const evidence=()=>({status:'CURRENT',...check,command:'node meaningful-check.cjs',cwd:'/work',scratchInput:'mutable-or-unknown',runtime:{image:'exact-retained-image'},originalCapture:sha('a'),currentCapture:sha('a'),sourceMatches:true,index:{entries:2,head:'d'.repeat(40),branch:'feature/test',mismatchedPaths:[],remainingMismatches:0},scope:'Original API scope',limitations:['Original limitation'],nextAction:'Review the actual staged diff; assess adequacy separately.'});
const audit=()=>({status:'MATCH',candidateId:candidate.id,createdAt:candidate.createdAt,checks:{objectFormat:true,wholeTree:true,message:true,parents:true},expected:{index:candidate.index,messageSha256:candidate.messageSha256,policy:candidate.policy,check},actual:{oid:'1'.repeat(40),tree:'2'.repeat(40),parents:[candidate.index.parent],messageSha256:candidate.messageSha256,objectFormat:'sha1',roster:candidate.index.roster,author:'Unverified',committer:'Unverified'},originalCheck:{command:'node meaningful-check.cjs',cwd:'/work'},current:{branch:'later-branch',head:'3'.repeat(40),policy:{state:'CONFIGURED',revision:3,matchesOriginal:false},work:{state:'BLOCKED',epoch:2,currentResultRunId:'later-run',pending:true}},scope:'Historical only',limitations:['Original limitation'],nextAction:'Assess actual repository rules separately.'});

test('CURRENT leads with correspondence, original check and next step while preserving exact details',()=>{
 const view=evidence(),before=structuredClone(view),text=localEvidenceText(view);
 assert.match(text,/^CURRENT · Current full source and index files match/);
 assert.match(text,/Regular index files compared: 2/);assert.ok(text.includes(JSON.stringify(view.command)));
 assert.match(text,/not check adequacy, review, commit approval or a reservation/);
 assert.match(text,/Next:/);assert.deepEqual(details(text),view);assert.deepEqual(view,before);
});
test('source-only STALE remains stale even without an index mismatch path',()=>{
 const text=localEvidenceText({...evidence(),status:'STALE',sourceMatches:false,currentCapture:sha('9')});
 assert.match(text,/^STALE/);assert.match(text,/No index mismatch is named, but the full source capture changed/);
 assert.match(text,/Git metadata, ignored and untracked files/);assert.match(text,/Full captured source: differs/);
});
test('index mismatch paths are quoted exactly and omitted-count remains visible',()=>{
 const path='line\nwith\ttabs',text=localEvidenceText({...evidence(),status:'STALE',index:{...evidence().index,mismatchedPaths:[path],remainingMismatches:7}});
 assert.ok(text.includes('Index mismatch: '+JSON.stringify(path)));assert.match(text,/Additional index mismatches not listed: 7/);
});
test('immediate candidate output supplies safely quoted native Git context without claiming a commit or saving the message body',()=>{
 const context={gitBinary:"/trusted path/g'it",messageFile:"/private/owner's message",receipt:{status:'RECORDED',candidate}};
 const text=localCandidateText(candidate,context);
 assert.match(text,/^RECORDED · Historical candidate receipt. No commit was made/);
 assert.ok(text.includes("'/trusted path/g'\\''it' -C '/project/owner'\\''s tree' commit --cleanup=verbatim -F '/private/owner'\\''s message'"));
 assert.match(text,/existing hooks\/signing/);assert.deepEqual(details(text),context.receipt);
 const review=localCandidateReviewText({projectId:'project',workId:check.workId,runId:check.runId,resultId:check.resultId,gitBinary:context.gitBinary,messageFile:context.messageFile,scope:'No stage or commit'});
 assert.match(review,/message must use LF with a final LF/);assert.match(review,/private body and original file path are not stored/);
});
test('reopened candidate identifies historical message digest without inventing a previous message path',()=>{
 const text=localCandidateText(candidate);
 assert.match(text,/original message path and private body are not retained/);
 assert.ok(text.includes(candidate.messageSha256));assert.ok(!text.includes('Selected exact message file:'));
 assert.match(text,/not a lock, current eligibility/);assert.deepEqual(details(text),candidate);
});
test('historical MATCH remains separate from later blocked work, changed conventions and unsettled input',()=>{
 const view=audit(),text=localAuditText(view);
 assert.match(text,/^MATCH · Native commit matches this historical candidate receipt/);
 assert.match(text,/Later context · shown separately/);assert.match(text,/Current original work state: "BLOCKED"/);
 assert.match(text,/Current work has unsettled input or producers: true/);assert.match(text,/Current conventions versus receipt: differs/);
 assert.match(text,/does not replace the historical receipt or make its check current/);
 assert.match(text,/no current eligibility, test adequacy, independent review/);
 assert.deepEqual(details(text),view);
});
test('MISMATCH names comparison failures and immutable commit identity without implying rollback',()=>{
 const view={...audit(),status:'MISMATCH',checks:{objectFormat:true,wholeTree:false,message:false,parents:false}},text=localAuditText(view);
 assert.match(text,/^MISMATCH/);assert.match(text,/The commit remains intact/);
 for(const name of ['Whole tree','Exact message','Normal parent or initial root'])assert.ok(text.includes(name+': differs'));
 assert.ok(text.includes(view.actual.oid));assert.deepEqual(details(text),view);
});
test('initial root commits show no expected/actual parents rather than unavailable ancestry',()=>{
 const view=audit();view.expected={...view.expected,index:{...view.expected.index,parent:null}};view.actual={...view.actual,parents:[]};
 const text=localAuditText(view);assert.match(text,/Expected parent: none · initial commit/);assert.match(text,/Actual parents: none · initial commit/);
 const review=localAuditReviewText({projectId:'project',candidateId:candidate.id,commitRef:'HEAD~1',gitBinary:'/trusted/git',scope:'No native commit is amended or reset.'});
 assert.match(review,/resolved once by audit/);assert.match(review,/No commit is created, amended, reset or published/);
});
test('oversized fields and original details are omitted whole without plausible shortened identities',()=>{
 const command='DO_NOT_SHOW_THIS_OPAQUE_PREFIX'+'한'.repeat(16000),text=localEvidenceText({...evidence(),command});
 assert.match(text,/whole value omitted/);assert.match(text,/Original details omitted as a whole/);
 assert.ok(!text.includes('DO_NOT_SHOW_THIS_OPAQUE_PREFIX'));assert.ok(Buffer.byteLength(text)<50000);
});
test('unsupported display status stays unavailable and unavailable candidates claim no acceptance',()=>{
 assert.match(localEvidenceText({...evidence(),status:'UNAVAILABLE'}),/^UNAVAILABLE/);
 assert.match(localAuditText({...audit(),status:'UNAVAILABLE'}),/^UNAVAILABLE/);
 assert.match(localUnavailableCandidateText('exact-unavailable-id'),/Missing or unreadable receipts cannot establish acceptance/);
});
test('viewer control filtering cannot change an exact path or produce a misleading native command',()=>{
 const path='/private/message\u009b31m\tfile',view={...evidence(),status:'STALE',index:{...evidence().index,mismatchedPaths:[path]}};
 const text=localEvidenceText(view);assert.ok(text.includes('message\\u009b31m\\tfile'));assert.doesNotMatch(text,/[\x1b\x9b]/);assert.deepEqual(details(text),view);
 for(const messageFile of [path,'/private/message\tfile','/private/message\nfile','/private/message\x1bfile']){
  const output=localCandidateText(candidate,{gitBinary:'/trusted/git',messageFile,receipt:{status:'RECORDED',candidate}});
  assert.match(output,/Native command omitted as a whole/);assert.doesNotMatch(output,/Separate native command · review before running/);assert.doesNotMatch(output,/[\x1b\x9b]/);
 }
});
