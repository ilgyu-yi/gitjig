import test from 'node:test';
import assert from 'node:assert/strict';
import {ownedClaudeOutputLimit, ownedClaudeOutputEnvironment, assertOwnedClaudeOutputCapacity} from '../../dist/pi/claude-output-policy.js';
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

test('served capacity contradictions refuse success while missing metrics remain unproven', () => {
    const result = maximum => ({type: 'result', modelUsage: {selected: {maxOutputTokens: maximum}}});
    assert.doesNotThrow(() => assertOwnedClaudeOutputCapacity(result(32000), 32000));
    assert.doesNotThrow(() => assertOwnedClaudeOutputCapacity({type: 'result'}, 32000));
    assert.doesNotThrow(() => assertOwnedClaudeOutputCapacity({type: 'result', modelUsage: {selected: {}}}, 32000));
    for (const invalid of [64000, '32000', NaN, 0]) assert.throws(() => assertOwnedClaudeOutputCapacity(result(invalid), 32000), /OUTPUT_LIMIT_MISMATCH/);
    assert.throws(() => assertOwnedClaudeOutputCapacity(result(32000), 16000), /OUTPUT_LIMIT_MISMATCH/);
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
