// Real installed registration/capture, explicitly synthetic historical UI states.
// No accepted procedure, actual send, model judgment or delivery claim.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const input = JSON.parse(await fs.readFile(process.env.GITJIG_STATUS_SEED, 'utf8'));
const payload = await fs.realpath(process.env.GITJIG_STATUS_PAYLOAD);
const {openController} = await import(pathToFileURL(path.join(payload, 'dist/controller/index.js')));
const {reconcileOwnedGitProcesses} = await import(pathToFileURL(path.join(payload, 'dist/effects/native-git.js')));
const c = await openController({installationHome: input.home, effectsProfile: {gitBinary: input.git}});
try {
    await c.registerProject({id: 'P', sourceRoot: input.project});
    const {targetId} = await c.registerLocalTarget({projectId: 'P', path: input.receiver,
        ref: 'refs/heads/main', basisCommit: input.basis, publicationInventory: ['file.txt'], authorizedDeltaPaths: ['file.txt']});
    const operations = [];
    for (const phase of ['PREPARED', 'UNKNOWN', 'CONFIRMED']) {
        const work = await c.beginChange({projectId: 'P', request: 'Installed historical status fixture: synthetic procedure/state; no accepted production or send'});
        assert.ok(c.inspectChange(work.workId).baseVersion);
        c.delegateIntegration({workId: work.workId, targetId, mode: 'ordinary', operationLimit: 1});
        const evidence = {workId: work.workId, epoch: 1, generation: 1,
            versions: {base: 'synthetic-base', candidate: 'synthetic-candidate', plan: 'synthetic-plan', verification: 'synthetic-check', requirements: null, contracts: 'synthetic-contracts'},
            candidateDigest: 'synthetic', sourceChainDigest: 'synthetic', selectionDigest: 'synthetic', checkIds: [], reviewLaunchIds: [],
            dispositionDigest: 'synthetic', carryDigest: null, fingerprint: 'synthetic'};
        operations.push({phase, operationId: c.effects.allocate(work.workId, targetId, evidence), workId: work.workId});
    }
    // Allocate all originals before the controlled uncertain endpoint premises.
    for (const op of operations) if (op.phase !== 'PREPARED') {
        c.store.run("UPDATE effect_operations SET phase=?,data=json_set(data,'$.expectedBase',?,'$.headCommit',?,'$.integrationCommit',?,'$.dispatchRun','synthetic-possible-handoff','$.nextAction','Controlled historical display premise') WHERE id=?",
            op.phase, input.basis, input.basis, input.basis, op.operationId);
        if (op.phase === 'CONFIRMED') c.store.run('INSERT INTO effect_receipts VALUES(?,?,?,?)', randomUUID(), op.operationId, 'reconciliation',
            JSON.stringify({kind: 'contains-integration', targetCommit: input.basis, integrationCommit: input.basis, commands: []}));
    }
    const conversations = {};
    for (const locale of ['en', 'ko']) {
        const {conversationId} = c.createConversation();
        const view = c.inspectConversation(conversationId), language = c.getConversationLanguage(conversationId);
        c.setConversationLanguage({conversationId, expectedGeneration: view.generation, expectedRevision: language.revision, replyLanguage: locale});
        conversations[locale] = conversationId;
    }
    for (const op of operations) {
        const original = c.inspectRetainedIntegration(op.operationId);
        assert.equal(original.entry.state, 'RETAINED'); assert.equal(original.view.phase, op.phase);
        assert.equal(original.view.transportOutcome, op.phase === 'PREPARED' ? null : 'uncertain');
    }
    await c.close();
    const effects = path.join(input.home, 'effects'), cleanup = [];
    for (const name of await fs.readdir(effects)) {
        const client = path.join(effects, name, 'client');
        try { await fs.access(path.join(client, 'runs')); } catch { continue; }
        const proof = await reconcileOwnedGitProcesses(client, 0);
        assert.equal(proof.cleanup, 'confirmed', JSON.stringify(proof)); cleanup.push({client, proof});
    }
    console.log(JSON.stringify({operations, conversations, cleanup}));
} finally { await c.close(); }
