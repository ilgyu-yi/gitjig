import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {validateApplicationStartup} from '../../dist/cli/application-startup.js';
import {ApplicationStartup} from '../../dist/app/startup.js';
import {openController} from '../../dist/controller/index.js';
import {runCommand} from '../../runtime/setup.mjs';
import {runtimePrerequisites} from '../../dist/ui/runtime-setup-help.js';
import {dockerContextInspection} from '../helpers/docker-context-inspection.mjs';

const root = process.argv[2];
const owner = path.join(root, 'operator'), app = path.join(root, 'application');
const bin = path.join(owner, 'bin'), config = path.join(owner, '.docker');
const agent = path.join(app, 'agent'), cwd = path.join(app, 'host');
const receipt = path.join(root, 'calls.jsonl');
const image = 'sha256:' + 'b'.repeat(64);
const controller = await openController({installationHome: app});
for (const directory of [bin, config, path.join(owner, '.colima/gitjig'), path.join(agent, 'home'), cwd, path.join(app, 'artifacts')])
    await fs.mkdir(directory, {recursive: true, mode: 0o700});
const body = `#!${process.execPath}
import fs from 'node:fs';
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(receipt)}, JSON.stringify({name: process.argv[1].split('/').at(-1), args, cwd: process.cwd(), env: process.env}) + '\\n');
${await dockerContextInspection(config, 'colima-gitjig')}
if (args.includes('version')) console.log(JSON.stringify('29.5.2'));
if (args.includes('inspect')) console.log(JSON.stringify(${JSON.stringify(image)}));
if (args.includes('--iidfile')) fs.writeFileSync(args[args.indexOf('--iidfile') + 1], ${JSON.stringify(image)});
`;
for (const name of ['docker', 'colima'])
    await fs.writeFile(path.join(bin, name), body, {mode: 0o700});
// Original host routing selectors are poison. Proxy/certificate settings remain
// necessary for approved preparation downloads, independent of Pi's environment.
const environment = {...process.env, HOME: owner, PATH: bin, HTTPS_PROXY: 'http://owned-proxy.invalid:8080',
    SSL_CERT_FILE: path.join(owner, 'cert.pem'), DOCKER_HOST: 'MUST_NOT_INHERIT', COLIMA_HOME: 'MUST_NOT_INHERIT',
    NODE_OPTIONS: 'MUST_NOT_INHERIT', NODE_PATH: 'MUST_NOT_INHERIT'};
delete process.env.NODE_OPTIONS;
delete process.env.NODE_PATH;
process.env.TMPDIR = path.join(app, 'artifacts');
const prepared = {configuration: {version: 1, bridge: {profile: {cwd, agentDir: agent}, nativeAccountDirectory: path.join(owner, '.claude')}},
    sources: {runtime: 'none', bridge: 'saved'}};
const originalDirectory = process.cwd(), originalEnvironment = {...process.env};
await validateApplicationStartup(prepared, app);
assert.deepEqual({...process.env}, originalEnvironment);
assert.equal(process.cwd(), originalDirectory);
const isolatedHome = path.join(agent, 'home');
try {
    const startup = ApplicationStartup.open(controller, prepared, environment);
    environment.HOME = path.join(root, 'MUTATED');
    environment.PATH = '';
    process.env.HTTPS_PROXY = 'http://MUTATED.invalid';
    assert.equal(ApplicationStartup.open(controller, undefined, {HOME: 'MUST_NOT_RETARGET'}), startup);
    const edit = await startup.prepareRuntimeEdit();
    assert.equal((await edit.suggestPaths(() => {})).dockerConfigDirectory, config);
    assert.ok(runtimePrerequisites(edit.defaultDockerConfigDirectory).includes(config));
    assert.ok(!runtimePrerequisites(edit.defaultDockerConfigDirectory).includes(isolatedHome));
    const guard = () => {};
    const execute = (file, args, options) => runCommand(file, args, options);
    const existingAnswers = ['1', undefined, undefined, 'colima-gitjig', 'n', 'y'];
    const result = await edit.prepareInteractive({}, guard, {output() {}, execute,
        ask: async (_question, value) => existingAnswers.shift() ?? value});
    assert.equal(result.dockerConfigDirectory, config);
    assert.equal(result.dockerContext, 'colima-gitjig');
    assert.equal(result.image, image);
    const colimaAnswers = ['2', 'n', 'gitjig', 'y', 'y', 'y'];
    const questions = [];
    const colimaResult = await edit.prepareInteractive({}, guard, {output() {}, execute,
        ask: async (question, value) => {questions.push(question); return colimaAnswers.shift() ?? value;}});
    assert.ok(questions.some(question => question.startsWith('Profile exists.')));
    assert.equal(colimaResult.dockerConfigDirectory, config);
    await edit.buildImage(result, guard, new AbortController().signal, () => {});
    await edit.checkRuntime(result, guard, new AbortController().signal, () => {});
    const calls = (await fs.readFile(receipt, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(calls.length, 14);
    assert.equal(calls.filter(call => call.args[2] === 'context' && call.args[3] === 'inspect').length, 8);
    const start = calls.find(call => call.name === 'colima');
    assert.deepEqual(start.args, ['start', '--profile', 'gitjig', '--activate=false']);
    assert.equal(start.env.COLIMA_HOME, path.join(owner, '.colima'));
    assert.equal(start.env.DOCKER_CONFIG, config);
    for (const call of calls) {
        assert.equal(call.env.HOME, owner);
        assert.equal(call.env.HTTPS_PROXY, 'http://owned-proxy.invalid:8080');
        assert.equal(call.env.SSL_CERT_FILE, path.join(owner, 'cert.pem'));
        assert.equal(call.env.DOCKER_HOST, undefined);
        assert.equal(call.env.NODE_OPTIONS, undefined);
        assert.equal(call.env.NODE_PATH, undefined);
    }
    // Two standalone image preparations plus Colima start precede app-owned actions.
    assert.ok(calls.slice(0, 7).every(call => call.cwd === owner));
    assert.ok(calls.slice(7).every(call => call.cwd === app));
    assert.equal(process.env.HOME, originalEnvironment.HOME);
    assert.equal(process.cwd(), originalDirectory);
    await assert.rejects(fs.access(path.join(isolatedHome, '.docker')), {code: 'ENOENT'});
    await assert.rejects(fs.access(path.join(isolatedHome, '.colima')), {code: 'ENOENT'});
    await assert.rejects(fs.access(path.join(app, 'config/startup.json')), {code: 'ENOENT'});
    console.log('Original operator environment retained; operator HOME/cwd unchanged; no runtime saved.');
} finally {
    await controller.close();
}
