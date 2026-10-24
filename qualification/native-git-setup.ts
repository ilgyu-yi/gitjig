/** Fixed qualification bootstrap. Not compiled or copied into the product payload. */
import {createHash} from 'node:crypto';
import type {AcceptanceSetupInput, AcceptanceSetupOperations, PreparedHttpsSend} from '../dist/effects/native-git.js';
import type {GitFile, CommandReceipt} from '../dist/effects/types.js';
import {acceptanceSyntheticFiles, acceptancePeerReadmeSuffix, assertAcceptanceSynthetic} from './acceptance-synthetic.js';
type BytesFile = GitFile & {bytes: Buffer};
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const text = (bytes: Buffer) => new TextDecoder('utf-8', {fatal:true, ignoreBOM:true}).decode(bytes);
export async function prepareAcceptanceSetup(operations: AcceptanceSetupOperations, input: AcceptanceSetupInput, signal: AbortSignal): Promise<PreparedHttpsSend & {tree:string}> {
    assertAcceptanceSynthetic();
    const owned = structuredClone(input), commands: CommandReceipt[] = [];
    if (owned.target.owner !== 'ilgyu-yi' || owned.target.repository !== 'gitjig-effects-fixture-20261017-074f7a29' || owned.target.ref !== (owned.step === 'bootstrap-main' ? 'refs/heads/main' : 'refs/heads/fixture/race'))
        throw Error('Fixed setup target differs');
    const inventory = await operations.observeInventory(owned.target, signal);
    commands.push(...inventory.commands);
    if (inventory.refs.some(r => !['main', 'fixture/ordinary', 'fixture/override', 'fixture/head', 'fixture/race', 'fixture/overlap'].some(b => r.ref === 'refs/heads/' + b)))
        throw Error('Unexpected fixture refs; stop setup');
    const parent = owned.step === 'race-peer' ? operations.oid(owned.expectedBase ?? '') : undefined;
    if (owned.step === 'bootstrap-main' ? inventory.refs.length !== 0 : inventory.refs.find(r => r.ref === owned.target.ref)?.commit !== parent)
        throw Error('Setup native precondition differs');
    if (parent)
        await operations.fetchBasis(owned.target, parent, signal);
    const files = new Map<string, BytesFile>();
    for (const [name, literal] of Object.entries(acceptanceSyntheticFiles)) {
        const bytes = Buffer.from(literal + (name === 'README.md' && parent ? acceptancePeerReadmeSuffix : ''));
        files.set(name, { path: name, mode: '100644', blob: '', sha256: digest(bytes), size: bytes.length, bytes });
    }
    const tree = await operations.makeTree(files, commands, signal), operationId = 'acceptance-074f7a29-' + owned.step;
    const commitBytes = Buffer.from(`tree ${tree}\n${parent ? `parent ${parent}\n` : ''}author Gitjig fixture setup <fixture@example.invalid> 1792191600 +0000\ncommitter Gitjig fixture setup <fixture@example.invalid> 1792191600 +0000\n\nFixed synthetic acceptance setup\nOperation: ${operationId}\n`);
    const commit = operations.oid(text(await operations.run(['hash-object', '-t', 'commit', '-w', '--stdin'], commands, signal, commitBytes)).trim());
    if (owned.retainedCommit && owned.retainedCommit !== commit)
        throw Error('Retained fixed setup commit differs');
    return operations.prepare(owned, operationId, parent, commit, tree, signal);
}
