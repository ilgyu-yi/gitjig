import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {verificationCommandContract,verificationReportExample} from '../../dist/workflow/verification-contract.js';

/** Check current runtime instructions separately from retained role-recipe guidance. */
export function roleRecipeGuidance(systemPrompt, includesReportExample = false) {
    const digest = value => createHash('sha256').update(value).digest('hex');
    const commandContract = 'Owned check execution contract (later host execution only; runtime inputs are absent from the role workspace): ' +
        JSON.stringify(verificationCommandContract) + '.';
    assert.equal(digest(commandContract), '50b4ce73b9253874f294b445151e00b22f7ddf160a549373a4246117543ebed1');
    const contractParts = systemPrompt.split(commandContract);
    assert.equal(contractParts.length, 2, 'One exact current check execution contract');
    const [before, after] = contractParts;
    const reportExample = '\n' + verificationReportExample + '\n';
    const exampleParts = after.split(reportExample);
    assert.equal(exampleParts.length, includesReportExample ? 2 : 1, 'Report example presence matches the assigned stage');
    if (includesReportExample)
        assert.equal(digest(exampleParts[0] + reportExample), '7ffba057696c97650e946f5ff0030f6f78374ad8d1390697118ff158a1528225');
    assert.doesNotMatch(systemPrompt, /Planning\/assessment command contract \(for later host execution/);
    return before + exampleParts.at(-1);
}
