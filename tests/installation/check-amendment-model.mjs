import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

export async function stageCheckAmendmentModel(root, payload) {
    const controller = path.join(root, 'controller');
    const workflow = path.join(root, 'workflow');
    await fs.mkdir(controller, {recursive: true});
    await fs.mkdir(workflow, {recursive: true});
    const source = await fs.readFile(new URL('../controller/check-amendment-fixture.mjs', import.meta.url), 'utf8');
    const sdkSpecifier = "'@earendil-works/pi-ai/compat'";
    assert.equal(source.split(sdkSpecifier).length, 2, 'Exact installed SDK binding');
    const sdk = pathToFileURL(path.join(payload, 'node_modules/@earendil-works/pi-ai/dist/compat.js'));
    await fs.writeFile(path.join(controller, 'check-amendment-fixture.mjs'), source.replace(sdkSpecifier, JSON.stringify(sdk.href)));
    await fs.copyFile(new URL('../workflow/current-verification-fixture.mjs', import.meta.url),
        path.join(workflow, 'current-verification-fixture.mjs'));
}
