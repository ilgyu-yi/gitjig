import fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

/** Allocation only. The caller owns cleanup and retained evidence. */
export async function temporaryDirectory(prefix) {
    if (typeof prefix !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9-]{0,79}$/u.test(prefix))
        throw Error('Fixture prefix must be a plain name of at most 80 characters');
    const parent = await fs.realpath(tmpdir());
    const checkout = await fs.realpath(fileURLToPath(new URL('../../', import.meta.url)));
    const relative = path.relative(checkout, parent);
    if (!relative || !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep))
        throw Error('Ordinary test fixtures require temporary storage outside the checkout');
    const root = await fs.mkdtemp(path.join(parent, 'gitjig-' + prefix + '-'));
    await fs.chmod(root, 0o700);
    return root;
}
