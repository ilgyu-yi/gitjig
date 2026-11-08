import test from 'node:test';
import assert from 'node:assert/strict';
import {sharePreviousCriteriaText, restorePreviousCriteriaText} from '../../dist/workflow/criteria-text.js';

const shared = Array.from({length: 80}, (_, i) => `Clause ${i}: preserve the complete original meaning, including 한국어.\r\n`).join('');
for (const [label, previous, current] of [
    ['equal text', shared, shared],
    ['separated edits', 'OLD START\n' + shared + 'OLD END', 'NEW START\n' + shared + 'NEW END'],
    ['reordered and repeated lines', shared + '\n\n' + shared, shared.split('\r\n').reverse().join('\r\n') + '\n\n'],
    ['removed old clauses', shared + 'Prior-only requirement.\nKeep this removed requirement visible.\n', shared],
    ['inserted current clauses', shared, 'New first clause.\n' + shared + 'New last clause.\n'],
    ['mixed terminators and Unicode', shared + '💬\r\n한글\nlast', shared + '💬\n한글\r\nlast\n'],
    ['empty prior', '', shared],
    ['empty current', shared, ''],
    ['all changed', 'Only original words.\r\n', 'Entirely different current words.\n'],
]) test(`criteria sharing preserves exact prior bytes: ${label}`, () => {
    const value = sharePreviousCriteriaText(previous, current);
    assert.equal(restorePreviousCriteriaText(value, current), previous);
    assert.deepEqual(Buffer.from(restorePreviousCriteriaText(value, current)), Buffer.from(previous));
    assert.ok(Buffer.byteLength(JSON.stringify(value)) <= Buffer.byteLength(JSON.stringify(previous)));
    if (label === 'separated edits' || label === 'removed old clauses') {
        assert.equal(typeof value, 'object');
        assert.ok(JSON.stringify(value).includes(label === 'separated edits' ? 'OLD START' : 'Prior-only requirement.'));
        assert.ok(Buffer.byteLength(JSON.stringify(value)) < Buffer.byteLength(previous) / 3);
    }
});

test('invalid sharing cannot silently become a summary or plain-text fallback', () => {
    const value = sharePreviousCriteriaText(shared + 'Old final clause.\n', shared + 'New final clause.\n');
    assert.equal(typeof value, 'object');
    const changes = [
        v => {v.currentSha256 = '0'.repeat(64);},
        v => {v.previousSha256 = '0'.repeat(64);},
        v => {v.previousUtf8Bytes--;},
        v => {v.source = 'another snapshot';},
        v => {v.meaning = 'Summarize previous rules';},
        v => {v.parts.pop();},
        v => {v.parts = [{currentLines: [-1, 1]}];},
        v => {v.parts = [{currentLines: [0, 99999]}];},
        v => {v.parts = [{currentLines: [2, 1]}];},
        v => {v.parts = [{currentLines: [0, 0]}];},
        v => {v.parts = [{currentLines: [0.5, 1]}];},
        v => {v.parts = [{currentLines: [0, 1], extra: true}];},
        v => {v.parts = [null];},
    ];
    for (const change of changes) {
        const malformed = structuredClone(value); change(malformed);
        assert.throws(() => restorePreviousCriteriaText(malformed, shared + 'New final clause.\n'), /malformed|captured definitions/);
    }
    assert.throws(() => restorePreviousCriteriaText(value, shared + 'Later changed current clause.\n'), /captured definitions/);
});
