import fs from 'node:fs/promises';
import { startConversationUI } from '../../dist/ui/index.js';
import { createStartupCleanupFixture } from '../controller/startup-cleanup-fixture.mjs';

const config = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
const teardown = [];
const fixture = await createStartupCleanupFixture({after: action => teardown.push(action)}, config.home);
const controller = fixture.controller();
const stopping = new AbortController();
const stop = () => stopping.abort();
process.once('SIGTERM', stop);
try {
    await startConversationUI({controller, conversationId: 'C', signal: stopping.signal});
    await fs.writeFile(config.receipt, JSON.stringify({
        work: fixture.store.one('SELECT state FROM works WHERE id=?', 'W').state,
        run: fixture.store.one('SELECT phase,reservation FROM runs WHERE id=?', 'R'),
        input: fixture.store.one('SELECT state FROM conversation_inputs WHERE id=?', 'I').state,
        lease: fixture.store.one('SELECT state FROM capacity_leases WHERE id=?', 'L').state,
        spent: fixture.store.one("SELECT consumed FROM budgets WHERE lineage='W' AND kind='execution'").consumed,
        workCount: fixture.store.one('SELECT COUNT(*) AS n FROM works').n,
    }));
} finally {
    process.removeListener('SIGTERM', stop);
    for (const action of teardown.reverse()) await action();
}
