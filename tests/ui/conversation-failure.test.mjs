import test from 'node:test';import assert from 'node:assert/strict';
import {conversationRequestFailurePresentation} from '../../dist/ui/conversation-failure.js';
for(const locale of ['en','ko'])for(const cleanup of ['unbound','quarantined:client'])test(`${locale} app limit diagnostic preserves original cause and ${cleanup} cleanup`,()=>{
 const original={conversationId:'conversation',workId:'original-work',runId:'original-run',resultId:'original-result',limit:16,cleanup,relatedWorkIds:[],relatedWorkIncomplete:false,failure:'ORIGINAL_HOST_ERROR /kept/path 한국어'};
 const before=structuredClone(original),shown=conversationRequestFailurePresentation(original,locale);
 assert.equal(shown.code,'CONVERSATION_REQUEST_LIMIT');assert.equal(shown.workId,original.workId);
 assert.match(shown.summary,locale==='ko'?/요청 횟수 한도\(16회\)/:/16-request limit/);assert.ok(!shown.summary.includes('CONVERSATION_REQUEST_LIMIT'));
 assert.ok(shown.detail.includes('ORIGINAL_HOST_ERROR /kept/path 한국어'));assert.ok(shown.detail.includes('/work original-work'));
 assert.match(shown.detail,locale==='ko'?/모델의 최종 답변은 전달되지 않았/:/no final assistant answer was delivered/);
 assert.ok(!shown.detail.includes('/ready'));assert.ok(!shown.detail.includes('/inputs'));
 if(cleanup.startsWith('quarantined'))assert.ok(shown.detail.includes(cleanup));assert.deepEqual(original,before);
});
