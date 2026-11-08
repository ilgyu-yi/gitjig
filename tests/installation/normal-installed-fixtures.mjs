import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installedQualificationModule } from './qualification-sidecar.mjs';

const checkout = fileURLToPath(new URL('../../', import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

// Review the exact fixture sources and their installed adaptations before changing a pin.
const sourceDigests = {
    "tests/cli/no-sdk-loader.mjs": "d5e1e6eb3e0e719c45f8a58e5f97ea608ba8edcdeec78d7717f55ad8550dcb0f",
    "tests/cli/normal-hosted-adapter.mjs": "f75a5409c168c31fb35ede585b001e76278cec87d443eae75ae5fc78f18346a7",
    "tests/cli/normal-hosted-integration.test.mjs": "a798651adcada602702dfa550ebbe988243801c4ad83e277f22110d71f64c0e0",
    "tests/cli/normal-hosted-model.mjs": "0ccd6cf257dbcbde85289d00cfa7eb6a2cd76555831690e8d720c86a1b1d9627",
    "tests/controller/configuration-fixture.mjs": "3296556e64e851a1009e33ce27786ccde760ca0e0676001531346369785a004b",
    "tests/controller/effect-fixture.mjs": "961a51032052e956d12a7ff7923d1ef6ce4fbdb47b56459897487383aa0e34ce",
    "tests/controller/hosted-core-fixture.mjs": "e744f9f4fda86a1b7e613aac668b26b391c207a39e2b635a140423c740d8f9b3",
    "tests/controller/hosted-integration-fixture.mjs": "a5357bd2f86bea8349cdbfcc778132fd28cdcb1a2a5bc37b1af41cf92bec1047",
    "tests/controller/normal-landing-agent.test.mjs": "bf1f1328adc82261d205b7d496b6c87c92e69928c722cf45b92530dddbb0bc3c",
    "tests/normal-hosted/agent-model.mjs": "54752797e7500a62c7aba9a9d70ef0d15dc9641fd3836c26c5b17b0697d8616f",
    "tests/normal-hosted/agent.test.mjs": "7e3f0d5dcb4b28831544ec3ebefb40532eff7773a708fa09f3c0b365156d80ac",
    "tests/normal-hosted/cli-adapter.mjs": "5c38c05a7bb9a6674709c20a6542897686d8e6743970cffabef9114bae41cc8c",
    "tests/normal-hosted/cli.test.mjs": "8a19b93255d2ba4c543164f579b8a5102e49b6537d30c5898cc65c1b35a424f3",
    "tests/normal-hosted/fixture.mjs": "45072d459bb83cb7cc6b4761b5968a6b5b9ac50aa72dabd9e652104853901ea7",
    "tests/normal-hosted/no-external.mjs": "df429cdb08a39e5e1f20adfb9c12a39089f1516beb1ed4a2ba767933b4496d3c",
    "tests/workflow/current-verification-fixture.mjs": "37fc4213449cda3ad0f77a765c2c913044ae4fdc9f79c51c55edb9fbafe28bf2"
};
const sourceFiles = {
    'publication': new Set([
        'tests/normal-hosted/fixture.mjs',
        'tests/controller/configuration-fixture.mjs',
        'tests/normal-hosted/no-external.mjs',
        'tests/cli/no-sdk-loader.mjs',
        'tests/normal-hosted/cli-adapter.mjs',
        'tests/normal-hosted/cli.test.mjs',
        'tests/normal-hosted/agent-model.mjs',
        'tests/controller/effect-fixture.mjs',
        'tests/normal-hosted/agent.test.mjs',
        'tests/workflow/current-verification-fixture.mjs',
    ]),
    'integration': new Set([
        'tests/cli/normal-hosted-integration.test.mjs',
        'tests/cli/normal-hosted-adapter.mjs',
        'tests/cli/normal-hosted-model.mjs',
        'tests/controller/hosted-core-fixture.mjs',
        'tests/controller/hosted-integration-fixture.mjs',
        'tests/controller/effect-fixture.mjs',
        'tests/normal-hosted/no-external.mjs',
        'tests/cli/no-sdk-loader.mjs',
        'tests/workflow/current-verification-fixture.mjs',
    ]),
    'agent-integration': new Set([
        'tests/controller/normal-landing-agent.test.mjs',
        'tests/controller/hosted-core-fixture.mjs',
        'tests/controller/hosted-integration-fixture.mjs',
        'tests/controller/effect-fixture.mjs',
        'tests/normal-hosted/no-external.mjs',
        'tests/workflow/current-verification-fixture.mjs',
    ]),
};

export function installedFixtureIO({ lane, root, originals, generated, substitutions }) {
    const allowed = sourceFiles[lane];
    assert.ok(allowed, 'Unknown installed fixture lane');
    return {
        async read(file) {
            assert.ok(allowed.has(file), 'Fixture is not in the reviewed ' + lane + ' roster: ' + file);
            const bytes = await fs.readFile(path.join(checkout, file));
            originals[file] = sha(bytes);
            assert.equal(originals[file], sourceDigests[file], 'Reviewed fixture changed: ' + file);
            return bytes.toString('utf8');
        },
        async write(relative, contents) {
            const file = path.join(root, relative);
            await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
            await fs.writeFile(file, contents, { mode: 0o600 });
            generated[relative] = sha(contents);
            return file;
        },
        replace(label, contents, from, to, expected = 1) {
            const parts = contents.split(from), count = parts.length - 1;
            if (expected === null)
                assert.ok(count > 0, 'Required adaptation absent: ' + label);
            else
                assert.equal(count, expected, 'Exact adaptation count: ' + label);
            substitutions.push({ label, from, to, count });
            return parts.join(to);
        },
    };
}

export async function copyEffectFixture({ read, write, replace }, relative, sdk) {
    const text = replace('bind report producer to installed SDK', await read('tests/controller/effect-fixture.mjs'),
        "'@earendil-works/pi-ai/compat'", JSON.stringify(sdk));
    const contents = replace('bind reviewed verification fixture', text,
        "'../workflow/current-verification-fixture.mjs'", "'./current-verification-fixture.mjs'");
    const verification = await read('tests/workflow/current-verification-fixture.mjs');
    await write(path.join(path.dirname(relative), 'current-verification-fixture.mjs'), verification);
    return write(relative, contents);
}

export async function copyHostedFixtures(io, { payload, home, projectId, repository, repositoryId, repositoryNodeId }) {
    const { read, write, replace } = io;
    const url = file => pathToFileURL(path.join(payload, file)).href;
    await copyEffectFixture(io, 'effect-fixture.mjs', url('node_modules/@earendil-works/pi-ai/dist/compat.js'));

    let native = await read('tests/controller/hosted-integration-fixture.mjs');
    native = replace('native fixture uses installed effects', native, "'../../dist/effects/index.js'", JSON.stringify(url('dist/effects/index.js')));
    native = replace('native repository paths', native, 'owner/repo', 'owner/' + repository, 13);
    native = replace('native repository regex paths', native, 'owner\\/repo', 'owner\\/' + repository, 2);
    native = replace('native repository name', native, "name:'repo'", 'name:' + JSON.stringify(repository));
    native = replace('native target repository', native, "repository:'repo'", 'repository:' + JSON.stringify(repository));
    native = replace('native target repository ID', native, 'repositoryId:9', 'repositoryId:' + repositoryId);
    native = replace('native REST repository ID', native, 'id:9,', 'id:' + repositoryId + ',');
    native = replace('native repository node IDs', native, "'R9'", JSON.stringify(repositoryNodeId), 3);
    await write('hosted-integration-fixture.mjs', native);

    let subject = await read('tests/controller/hosted-core-fixture.mjs');
    subject = replace('subject uses installed Controller', subject, "'../../dist/controller/index.js'", JSON.stringify(url('dist/controller/index.js')));
    subject = replace('subject uses installed qualification sidecar', subject, "'../../.qualification/controller-testing.js'", JSON.stringify(installedQualificationModule(payload, 'controller-testing.js')));
    subject = replace('subject uses retained installed home', subject, "home=path.join(native.root,'home')", 'home=' + JSON.stringify(home));
    subject = replace('subject uses fresh project namespace', subject, "'P'", JSON.stringify(projectId), 3);
    subject = replace('subject uses exact repository', subject, "repository:'repo'", 'repository:' + JSON.stringify(repository));
    subject = replace('subject uses exact repository ID', subject, 'repositoryId:9', 'repositoryId:' + repositoryId);
    subject = replace('subject uses exact repository node ID', subject, "repositoryNodeId:'R9'", 'repositoryNodeId:' + JSON.stringify(repositoryNodeId));
    await write('hosted-core-fixture.mjs', subject);
}
