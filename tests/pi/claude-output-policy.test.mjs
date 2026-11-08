import test from 'node:test';
import assert from 'node:assert/strict';
import {ownedClaudeOutputLimit, ownedClaudeOutputEnvironment, assertOwnedClaudeResponseOutput} from '../../dist/pi/claude-output-policy.js';
import {assertModelContextBudget} from '../../dist/pi/context-budget.js';

test('owned output policy binds the effective child limit without changing other environment or model limits', () => {
    const environment = Object.freeze({HOME: '/explicit-account', PATH: '/explicit-client', CLAUDE_CODE_MAX_OUTPUT_TOKENS: '128000'});
    assert.equal(ownedClaudeOutputLimit(128000), 32000);
    assert.equal(ownedClaudeOutputLimit(16000), 16000);
    assert.deepEqual(ownedClaudeOutputEnvironment(environment, 16000), {...environment, CLAUDE_CODE_MAX_OUTPUT_TOKENS: '16000'});
    assert.equal(environment.CLAUDE_CODE_MAX_OUTPUT_TOKENS, '128000');
    assert.deepEqual(ownedClaudeOutputEnvironment({HOME: environment.HOME}, 32000), {HOME: environment.HOME, CLAUDE_CODE_MAX_OUTPUT_TOKENS: '32000'});
    for (const invalid of [undefined, 0, -1, NaN, Infinity, 1.5, '32000']) assert.throws(() => ownedClaudeOutputLimit(invalid), /OUTPUT_LIMIT_UNAVAILABLE/);
    assert.throws(() => ownedClaudeOutputEnvironment(environment, 128000), /OUTPUT_LIMIT_UNAVAILABLE/);
});

test('model defaults and multi-turn totals are not individual response output limits', () => {
    for (const maxOutputTokens of [64000, 128000, 0, undefined, 'unknown'])
        assert.doesNotThrow(() => assertOwnedClaudeResponseOutput({type:'result',modelUsage:{selected:{maxOutputTokens,outputTokens:64001}},usage:{output_tokens:64001}},32000));
    for (const envelope of [null, {}, {type:'result'}, {type:'assistant',message:{}}, {type:'stream_event',event:{type:'message_delta'}}])
        assert.doesNotThrow(() => assertOwnedClaudeResponseOutput(envelope,32000));
});

test('actual individual root output refuses overruns and malformed counts without summing repeated envelopes', () => {
    for (const wrap of [output_tokens=>({type:'assistant',parent_tool_use_id:null,message:{usage:{output_tokens}}}),
        output_tokens=>({type:'stream_event',parent_tool_use_id:null,event:{type:'message_delta',usage:{output_tokens}}})]) {
        for (const count of [0, 1, 32000]) assert.doesNotThrow(() => assertOwnedClaudeResponseOutput(wrap(count),32000));
        for (const count of [32001, '32000', NaN, Infinity, -1, 1.5, null]) assert.throws(() => assertOwnedClaudeResponseOutput(wrap(count),32000),/OUTPUT_LIMIT_MISMATCH/);
        assert.throws(() => assertOwnedClaudeResponseOutput(wrap(16001),16000),/OUTPUT_LIMIT_MISMATCH/);
        for (let i=0;i<3;i++) assert.doesNotThrow(() => assertOwnedClaudeResponseOutput(wrap(20000),32000));
        assert.doesNotThrow(() => assertOwnedClaudeResponseOutput({...wrap(64000),parent_tool_use_id:'foreign-query'},32000));
    }
});

test('an explicitly requested response reserve admits retained input while real overflow still refuses', () => {
    const context = size => ({messages: [{role: 'user', content: 'x'.repeat(size), timestamp: 0}]});
    const model = {contextWindow: 200000, maxTokens: 32000};
    const retained = context(350000);
    assert.throws(() => assertModelContextBudget({...model, maxTokens: 128000}, retained), /MODEL_CONTEXT_LIMIT/);
    const fit = assertModelContextBudget(model, retained);
    assert.equal(fit.outputReserve, 32000);
    assert.equal(fit.margin, 4096);
    assert.throws(() => assertModelContextBudget(model, context(700000)), /MODEL_CONTEXT_LIMIT/);
});
