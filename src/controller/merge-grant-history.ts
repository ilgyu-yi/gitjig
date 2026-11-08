import type { Store } from './store.js';
import { isDeepStrictEqual as same } from 'node:util';
import { hash } from './change-files.js';
interface Grant {
    id: string;
    root: string;
    target: string;
    epoch: number;
    data: string;
}
const bounded = (column: string, max: number) => `CASE WHEN length(CAST(${column} AS BLOB))<=${max} THEN ${column} ELSE NULL END`;
const integer = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;
const object = (value: unknown): Record<string, any> => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw Error('Original merge grant history requires an object');
    return value as Record<string, any>;
};
const immutable = (data: Record<string, any>) => { const { rootEpoch, renewal, ...rest } = data; return rest; };
/** Distinct ordinary PR merge authority; never admits integration grant sources. */
export function mergeGrantHistory(store: Store, grant: Grant) {
    const fail = () => { throw Error('Original merge grant renewal history unavailable or inconsistent'); };
    if (typeof grant.data !== 'string' || Buffer.byteLength(grant.data) > 65536)
        fail();
    let row = grant, data = object(JSON.parse(row.data));
    if (data.kind !== 'github-merge' || data.mode !== 'ordinary' || !['work', 'delegation-lineage'].includes(data.scope) || data.notifications !== 'allow-merge-notifications' || data.ownerUid !== process.getuid?.() || !integer(data.operationLimit) || data.operationLimit < 1 || data.operationLimit > 100 || !integer(data.rootEpoch) || data.rootEpoch < 1)
        fail();
    if (Object.hasOwn(data, 'renewal') && data.scope !== 'work')
        fail();
    const used = store.one('SELECT COUNT(*) AS n FROM effect_operations WHERE grant_id=?', grant.id).n;
    if (!integer(used) || used > data.operationLimit)
        fail();
    const epochs = [{ grantEpoch: row.epoch, rootEpoch: data.rootEpoch as number }], history: unknown[] = [], seen = new Set<string>();
    let bytes = Buffer.byteLength(grant.data), laterUsed = used;
    while (Object.hasOwn(data, 'renewal')) {
        const pointer = object(data.renewal);
        if (!same(Object.keys(pointer).sort(), ['sourceId', 'version']) || pointer.version !== 1 || typeof pointer.sourceId !== 'string' || !pointer.sourceId || seen.has(pointer.sourceId) || history.length >= 64)
            fail();
        seen.add(pointer.sourceId);
        const source = store.one(`SELECT id,conversation,${bounded('origin', 65536)} AS origin,${bounded('raw', 131072)} AS raw FROM sources WHERE id=?`, pointer.sourceId);
        if (!source || source.conversation !== null || typeof source.origin !== 'string' || typeof source.raw !== 'string')
            fail();
        bytes += Buffer.byteLength(source.origin) + Buffer.byteLength(source.raw);
        if (bytes > 1048576)
            fail();
        const origin = object(JSON.parse(source.origin)), event = object(JSON.parse(source.raw)), previous = object(event.previous);
        if (!same(origin, JSON.parse(JSON.stringify({ kind: 'owner-merge-grant-renewal', uid: process.getuid?.(), root: grant.root, grantId: grant.id, targetId: grant.target }))) || !same(Object.keys(event).sort(), ['fromRootEpoch', 'grantId', 'previous', 'reason', 'targetId', 'toRootEpoch', 'used', 'version', 'workId']) || event.version !== 1 || event.grantId !== grant.id || event.workId !== grant.root || event.targetId !== grant.target || typeof event.reason !== 'string' || !event.reason.trim() || Buffer.byteLength(event.reason) > 4096 || !integer(event.used) || event.used > laterUsed || !same(Object.keys(previous).sort(), ['data', 'epoch', 'id', 'root', 'target']) || previous.id !== grant.id || previous.root !== grant.root || previous.target !== grant.target || !integer(row.epoch) || row.epoch < 2 || previous.epoch !== row.epoch - 1 || typeof previous.data !== 'string' || Buffer.byteLength(previous.data) > 65536)
            fail();
        const prior = object(JSON.parse(previous.data));
        if (!integer(data.rootEpoch) || !integer(prior.rootEpoch) || prior.rootEpoch < 1 || data.rootEpoch <= prior.rootEpoch || event.fromRootEpoch !== prior.rootEpoch || event.toRootEpoch !== data.rootEpoch || !same(immutable(data), immutable(prior)))
            fail();
        epochs.push({ grantEpoch: previous.epoch, rootEpoch: prior.rootEpoch });
        history.push(source);
        laterUsed = event.used;
        row = previous as unknown as Grant;
        data = prior;
    }
    if (row.epoch !== 1 || typeof data.source !== 'string' || seen.has(data.source))
        fail();
    const initial = store.one(`SELECT id,conversation,${bounded('origin', 65536)} AS origin,${bounded('raw', 65536)} AS raw FROM sources WHERE id=?`, data.source);
    if (!initial || initial.conversation !== null || typeof initial.origin !== 'string' || typeof initial.raw !== 'string')
        fail();
    bytes += Buffer.byteLength(initial.origin) + Buffer.byteLength(initial.raw);
    if (bytes > 1048576)
        fail();
    const origin = object(JSON.parse(initial.origin)), request = object(JSON.parse(initial.raw));
    if (origin.kind !== 'owner-merge-grant' || origin.uid !== process.getuid?.() || origin.root !== grant.root || request.workId !== grant.root || request.targetId !== grant.target || request.operationLimit !== data.operationLimit || (request.scope ?? 'work') !== data.scope || request.notifications !== data.notifications)
        fail();
    return { events: history.length, epochs, fingerprint: hash({ grant, history, initial }) };
}
