import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {getCurrentTools} from '@earendil-works/pi-ai';
import {createAssistantMessageEventStream} from '@earendil-works/pi-ai/compat';
import {temporaryDirectory} from '../helpers/temporary-directory.mjs';
import {createPiSession, initializePiHost} from '../../dist/pi/index.js';

const contexts = [undefined,
    {projectRoot: '/work', shellCwd: '/work', projectAccess: 'read-only', readOnlyPaths: ['/work/check.cjs'], scratchRoots: ['/tmp', '/scratch'], inputMountRoot: null},
    {projectRoot: '/project-view', shellCwd: '/project-view/subdir', projectAccess: 'read-write', readOnlyPaths: ['/project-view/locked'], scratchRoots: ['/disposable'], inputMountRoot: '/checked-input'},
];
test('ordinary SDK project tools preserve declared executor facts across distinct backends', async t => {
    const root = await temporaryDirectory('project-coordinates'), stateRoot = path.join(root, 'state'), artifactRoot = path.join(root, 'artifacts'), project = path.join(root, 'project');
    for (const dir of [stateRoot, artifactRoot, project]) await fs.mkdir(dir, {mode: 0o700});
    const oldTemp = process.env.TMPDIR, oldHome = process.env.HOME;
    process.env.TMPDIR = artifactRoot; process.env.HOME = root;
    let product, passed = false;
    t.after(async () => {
        await product?.closeOwned();
        if (oldTemp === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = oldTemp;
        if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome;
        if (passed) await fs.rm(root, {recursive: true, force: true}); else t.diagnostic('Retained coordinate fixture: ' + root);
    });
    const fail = async () => assert.fail('Metadata observation must not execute a project tool');
    const host = await initializePiHost({stateRoot, artifactRoot});
    for(const executionContext of contexts){
    const captured = executionContext && structuredClone(executionContext);
    const operations = {...(captured ? {executionContext: captured} : {}), workspaceRoot: project, validatePath: p => path.resolve(project, p), exec: fail, access: fail, readFile: fail, writeFile: fail, mkdir: fail};
    let observed = 0;
    const definition = {api: 'coordinate-fixture', apiKey: 'DUMMY_NO_REQUEST', baseUrl: 'http://unused.invalid',
        models: [{id: 'fixture', input: ['text'], reasoning: false, contextWindow: 32000, maxTokens: 1000}],
        streamSimple(model, context) {
            const tools = getCurrentTools(context.messages); assert.equal(tools.length, 4);
            for (const tool of tools) {
                assert.match(tool.description, /captured project workspace/);
                assert.match(tool.description, /project-relative paths/);
                assert.match(tool.description, /native connection directory is a separate host context/);
                assert.equal(tool.description.includes(project), false);
            }
            assert.doesNotMatch(tools.find(t => t.name === 'bash').description, /current working directory/);
            assert.match(tools.find(t => t.name === 'read').description, /Registered native tool-output artifacts/);
            const bash=tools.find(t=>t.name==='bash').description;
            if(executionContext){
                assert.ok(bash.includes('Executor shell cwd: '+JSON.stringify(executionContext.shellCwd)));
                assert.ok(bash.includes('Disposable scratch roots: '+JSON.stringify(executionContext.scratchRoots)));
                for(const tool of tools)assert.ok(tool.description.includes('Executor project access: '+executionContext.projectAccess));
                assert.equal(bash.includes('/mutated-after-construction'),false);
                if(executionContext.inputMountRoot===null)assert.match(bash,/No host input mount is supplied/);
                else {assert.ok(bash.includes(JSON.stringify(executionContext.inputMountRoot)));assert.equal(bash.includes('"/work"'),false);}
            }else assert.doesNotMatch(bash,/Executor shell cwd|Disposable scratch roots|host input mount/);
            observed++;
            const message = {role: 'assistant', content: [{type: 'text', text: 'Controlled metadata observation.'}], api: model.api, provider: model.provider, model: model.id,
                usage: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0}}, stopReason: 'stop', timestamp: Date.now()};
            const stream = createAssistantMessageEventStream(); queueMicrotask(() => {stream.push({type: 'done', reason: 'stop', message}); stream.end(message);}); return stream;
        }};
    product = await createPiSession({host, operations, model: {provider: 'coordinate-fixture', modelId: 'fixture', definition}, systemPrompt: 'Observe tool metadata only.', maxReadBytes: 1024});
    if(captured){captured.scratchRoots.push('/mutated-after-construction');captured.projectAccess='read-only';}
    await product.session.prompt('Observe the supplied project tools.'); assert.equal(observed, 1); await product.closeOwned();
    }
    passed = true;
});
