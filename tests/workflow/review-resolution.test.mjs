import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';
import {roleOutputSchema} from '../../dist/workflow/role-output-shape.js';
import {roleFraming, nativeRoleFraming} from '../../dist/workflow/role-framing.js';
import {assertDispositionEvidence, dispositionAccountingState, parseRoleOutput} from '../../dist/workflow/protocol.js';
import {reviewResolutionInput, captureReviewResolution} from '../../dist/workflow/role-input.js';
import {createSubjectActionProfile, subjectActionResponseHash} from '../../dist/workflow/subject-actions.js';
import {roleRecipeGuidance} from './role-recipe-guidance.mjs';

const refs = {version: 3, occurrenceIds: ['F','E','D'], diagnosisOccurrenceIds: ['D'],
    pendingOrdinaryIndexes: [0,1], blockingOrdinaryIndexes: [0,1],
    retentionChoices: [{occurrenceId: 'D', dispositionId: 'OLD-D', sha256: 'a'.repeat(64)}]};
const empty = {version: 1, receiptHash: 'b'.repeat(64), eligible: []};
const active = {...empty, eligible: [{occurrenceId: 'D', outputId: 'O', rawSha256: 'c'.repeat(64), materialOccurrenceIds: []}]};
const profile = {version: 1, stage: 'review-adjudication'};
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const ajv = new Ajv2020({strict: false});
const root = decisions => ({version: 1, summary: 'Independent current review', findings: [], assessedScope: [], decisions});
const decision = (resolution, id = 'F') => ({occurrenceId: id, disposition: 'upheld', reason: 'Actual current evidence', witnesses: ['current-check'], ...(resolution === undefined ? {} : {resolution})});
const constraints = {decisionReferences: refs, diagnosisEligibility: empty, reviewResolution: profile};
const parse = (output, limits = constraints) => parseRoleOutput(JSON.stringify(output), 'adjudicator', [], limits);

test('fresh declared review requests select text while explicit and undeclared formatter recipes remain stable', () => {
    const bundle = {requirements: [], contracts: 'Actual requirements', sources: [], context: {stage: 'review-adjudication', reviewResolutionInput: {version: 1}}};
    const current = nativeRoleFraming('adjudicator', bundle, 'request', 3);
    assert.equal(current.intent.version, 2);
    assert.equal(current.intent.carrier, 'assistant-json/v1');
    assert.equal(current.intent.binding.inputDigest, createHash('sha256').update(current.prompt).digest('hex'));
    const historical = nativeRoleFraming('adjudicator', bundle, 'request', 3, 'formatter/v1');
    assert.equal(historical.intent.version, 1);
    assert.equal(historical.intent.binding.inputDigest, hash(bundle));
    assert.deepEqual(current.schema, historical.schema);
    assert.equal(historical.systemPrompt, roleFraming('adjudicator', bundle, true).systemPrompt);
    assert.equal(nativeRoleFraming('adjudicator', {...bundle, context: {stage: 'review-adjudication'}}, 'old', 3).intent.version, 1);
    assert.equal(nativeRoleFraming('reviewer', {...bundle, context: {stage: 'fresh-review'}}, 'review', 3).intent.version, 1);
    assert.throws(() => nativeRoleFraming('reviewer', bundle, 'wrong', 3), /review adjudication/);
    assert.throws(() => nativeRoleFraming('adjudicator', {...bundle, context: {...bundle.context, reviewResolutionInput: {version: 1, extra: true}}}, 'wrong', 3), /review adjudication/);
});

test('undeclared review generation keeps its schema and role guidance with current check instructions', () => {
    // The role recipe pin comes from the original artifact with only its old
    // check-command instructions removed. Source tests authenticate actual captures.
    const hashes = {
        base: '8a58bc4bb9941b57b76c5b9526aa2510054945388c9f1051fa6f3b8168c4fbd8',
        inactive: 'c707decdb11681ede1c64cb029d055a978084748ee5567191e63fd8119a6c778',
        active: 'a9253a033c60df728c3c0c30be4e5449f18ba2f364203035f3b571f382e9561f',
    };
    for (const [name, input] of Object.entries({base: {}, inactive: {decisionReferences: refs, diagnosisEligibility: empty}, active: {decisionReferences: refs, diagnosisEligibility: active}}))
        assert.equal(hash(roleOutputSchema('adjudicator', 'review-adjudication', [], input)), hashes[name]);
    const framing = roleFraming('adjudicator', {requirements: [], contracts: 'Actual requirements', sources: [], context: {stage: 'review-adjudication'}}, true);
    assert.equal(hash(roleRecipeGuidance(framing.systemPrompt)), '72b8e39241f65be66a1a7e579388ef67d27b5e9425b44033e9011b43cbc3167a');
    assert.equal(hash(framing.prompt), 'fcbeb200b1faca9264f19bf4411ed397be74efcfcfc830d35209a3b0a90d70c6');
});

test('review completion choice is required prospectively and pending preserves canonical absence', () => {
    const validate = ajv.compile(roleOutputSchema('adjudicator', 'review-adjudication', [], constraints));
    const absent = root([decision()]);
    assert.equal(validate(absent), false);
    assert.match(parse(absent).issues.join(), /explicit pending/);
    assert.deepEqual(parse(absent, {decisionReferences: refs, diagnosisEligibility: empty}).issues, []);
    const pending = root([decision('pending')]), raw = JSON.stringify(pending);
    assert.equal(validate(pending), true, JSON.stringify(validate.errors));
    assert.deepEqual(parse(pending).issues, []);
    assert.equal(parse(pending).value.decisions[0].resolution, undefined);
    assert.equal(JSON.stringify(pending), raw);
    assert.equal(parse(pending, {decisionReferences: refs}).value, null);
    assert.equal(validate(root([decision('repaired')])), true);
    assert.equal(parse(root([decision('repaired')])).value.decisions[0].resolution, 'repaired');
    assert.equal(parse({arguments: pending}).value, null);
    for (const field of ['acceptedPlan','planAccepted','criteriaDecision','payloadDecision','implementationCarries','implementationCarryGroups']) {
        const extra = {...pending, [field]: {}};
        assert.equal(validate(extra), false);
        assert.equal(parse(extra).value, null);
    }
});

test('pending remains available for eligible and inactive diagnoses without allowing code repair', () => {
    for (const eligible of [empty, active]) {
        const limits = {...constraints, diagnosisEligibility: eligible};
        const validate = ajv.compile(roleOutputSchema('adjudicator', 'review-adjudication', [], limits));
        assert.equal(validate(root([decision('pending', 'D')])), true, JSON.stringify(validate.errors));
        assert.equal(validate(root([decision('repaired', 'D')])), false);
        assert.equal(parse(root([decision('pending', 'D')]), limits).value.decisions[0].resolution, undefined);
        assert.equal(parse(root([decision('repaired', 'D')]), limits).value, null);
        const withDiagnosis = root([{...decision('pending', 'D'), diagnosis: {outputId: 'O', rawSha256: 'c'.repeat(64), inputReceiptHash: active.receiptHash, materialOccurrenceIds: []}}]);
        assert.equal(validate(withDiagnosis), false);
        assert.equal(parse(withDiagnosis, limits).value, null);
    }
});

for (const version of [1, 3]) test(`declared review grammar${version} composes with keyed fresh and retained decisions`, () => {
    const subjectActions = createSubjectActionProfile('review-adjudication', refs);
    const limits = {...constraints, reviewResolution: {version, stage: 'review-adjudication'}, subjectActions};
    const wire = {version: 1, summary: 'Independent keyed review', findings: [], assessedScope: [],
        subjectActionsHash: subjectActionResponseHash(subjectActions, refs),
        decisionActions: {s0: {disposition: 'upheld', resolution: 'pending', reason: 'Original duty remains', witnesses: ['check']},
            s1: {disposition: 'equivalent', equivalentTo: 's0', reason: 'Same current duty', witnesses: ['check']}, s2: 'retain'}};
    const validate = ajv.compile(roleOutputSchema('adjudicator', 'review-adjudication', [], limits));
    assert.equal(validate(wire), true, JSON.stringify(validate.errors));
    const result = parse(wire, limits);
    assert.deepEqual(result.issues, []);
    assert.equal(result.value.decisions[0].resolution, version === 3 ? 'pending' : undefined);
    assert.equal(result.value.decisions[1].equivalentTo, 'F');
    assert.deepEqual(result.value.retainedDispositions, ['OLD-D']);
});

test('review resolution declaration rejects wrong stages, roles and malformed captures', () => {
    assert.deepEqual(reviewResolutionInput('adjudicator', {stage: 'review-adjudication', reviewResolutionInput: {version: 1}}), profile);
    assert.equal(reviewResolutionInput('adjudicator', {stage: 'review-adjudication'}), undefined);
    for (const value of [null, [], {version: 5}, {version: 1, extra: true}])
        assert.throws(() => reviewResolutionInput('adjudicator', {stage: 'review-adjudication', reviewResolutionInput: value}), /declaration/);
    for (const stage of ['planning-adjudication', 'raw-assessment'])
        assert.throws(() => reviewResolutionInput('adjudicator', {stage, reviewResolutionInput: {version: 1}}), /review adjudication/);
    assert.throws(() => reviewResolutionInput('reviewer', {stage: 'review-adjudication', reviewResolutionInput: {version: 1}}));
    assert.throws(() => captureReviewResolution({version: 1}));
});


test('historical declared review recipes retain wire bytes and role guidance', () => {
    for (const [version, prompt, system] of [
        [1, '7e413cfa0ae57ba34a390f7ffb307403c75c547ae1acffbc9ef087ac2ebe7d8d', '93a32a4c9c104497855da2e5d8d24bfa653dab715d7296396b74d7f7f8fdf168'],
        [2, '21bd5132cfee7b3a87bfe4806fddc6fac196634bc495d7036251b526eb4c25fa', '964feeb971f2b7d44e30bab3e99511e963f6ae7f7c26c5eccf376656f21648ca'],
    ]) {
        const reviewResolution = {version, stage: 'review-adjudication'};
        const framing = roleFraming('adjudicator', {requirements: [], contracts: 'Actual requirements', sources: [],
            context: {stage: reviewResolution.stage, reviewResolutionInput: {version}}}, true);
        assert.equal(hash(framing.prompt), prompt);
        assert.equal(hash(roleRecipeGuidance(framing.systemPrompt)), system);
        assert.equal(hash(roleOutputSchema('adjudicator', reviewResolution.stage, [], {reviewResolution})), 'c55e86bf8fb4ad570f69efdc29cd04deea1d26770c202d69b16abcfd90c038a8');
        assert.equal(parse(root([decision('pending')]), {...constraints, reviewResolution}).value.decisions[0].resolution, undefined);
    }
});

test('grammar3 preserves pending independently of severity without granting completion evidence', () => {
    const reviewResolution = {version: 3, stage: 'review-adjudication'}, limits = {...constraints, reviewResolution};
    assert.deepEqual(captureReviewResolution(reviewResolution), reviewResolution);
    assert.deepEqual(reviewResolutionInput('adjudicator', {stage: reviewResolution.stage, reviewResolutionInput: {version: 3}}), reviewResolution);
    const validate = ajv.compile(roleOutputSchema('adjudicator', reviewResolution.stage, [], limits));
    const wire = root([{...decision('pending'), witnesses: []}]);
    assert.equal(validate(wire), true, JSON.stringify(validate.errors));
    const result = parse(wire, limits);
    assert.deepEqual(result.issues, []);
    const current = result.value.decisions[0];
    assert.equal(current.resolution, 'pending');
    assert.deepEqual(parseRoleOutput('```json\n'+JSON.stringify(wire)+'\n```', 'adjudicator', [], limits).value, result.value);
    for (const severity of ['blocking','optional']) {
        const finding = {requirementId: 'R', severity, repair: 'substantive', description: 'Retained unresolved finding', evidence: ['original-source']};
        assert.doesNotThrow(() => assertDispositionEvidence(current, finding, false));
        assert.equal(dispositionAccountingState(current, finding, {repair: true, diagnosis: true}), 'pending');
        assert.throws(() => assertDispositionEvidence(current, finding, true), /retained reason\/witness/);
        assert.throws(() => assertDispositionEvidence(current, {}, false), /retained ordinary finding/);
        for (const resolution of ['repaired','diagnosed'])
            assert.throws(() => assertDispositionEvidence({...current, resolution}, finding, false), /retained reason\/witness/);
    }
    assert.equal(dispositionAccountingState({...current, resolution: undefined}, {severity: 'optional'}, {}), 'resolved');
    assert.equal(parse(wire, {decisionReferences: refs}).value, null);
    for (const disposition of ['rejected','equivalent','deferred']) {
        const bad = root([{...current, disposition, equivalentTo: 'E'}]);
        assert.equal(validate(bad), false);
        assert.equal(parse(bad, limits).value, null);
    }
    assert.equal(parse(root([{...current, diagnosis: {}}]), limits).value, null);
    assert.equal(parse(root([{...current, repair: {kind: 'plan', proposalHash: 'a'.repeat(64)}}]), limits).value, null);
});

test('grammar4 closes only a witnessed ordinary optional observation without a repair claim', () => {
    const decisionReferences = {...refs, blockingOrdinaryIndexes: [0]};
    const reviewResolution = {version: 4, stage: 'review-adjudication'};
    const subjectActions = createSubjectActionProfile('review-adjudication', decisionReferences, 2);
    const limits = {...constraints, decisionReferences, reviewResolution, subjectActions};
    const wire = action => ({version: 1, summary: 'Independent current review', findings: [], assessedScope: [],
        subjectActionsHash: subjectActionResponseHash(subjectActions, decisionReferences), decisionActions: action});
    const validate = ajv.compile(roleOutputSchema('adjudicator', reviewResolution.stage, [], limits));
    const {occurrenceId, ...acknowledge} = decision(undefined, 'E');
    const positive = wire({s1: acknowledge});
    assert.equal(validate(positive), true, JSON.stringify(validate.errors));
    const result = parse(positive, limits);
    assert.deepEqual(result.issues, []);
    assert.equal(result.value.decisions[0].occurrenceId, occurrenceId);
    assert.equal(result.value.decisions[0].resolution, undefined);
    assert.equal(dispositionAccountingState(result.value.decisions[0], {severity: 'optional'}, {}), 'resolved');
    for (const negative of [wire({s0: acknowledge}), wire({s2: acknowledge}), wire({s1: {...acknowledge, witnesses: []}})]) {
        assert.equal(validate(negative), false);
        assert.equal(parse(negative, limits).value, null);
    }
    const pending = wire({s1: {...acknowledge, resolution: 'pending', witnesses: []}});
    assert.equal(validate(pending), true);
    assert.equal(dispositionAccountingState(parse(pending, limits).value.decisions[0], {severity: 'optional'}, {}), 'pending');
    assert.equal(parse(positive, {...limits, reviewResolution: {...reviewResolution, version: 3}}).value, null);
});
