import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {queuedAssignmentWorld} from '../controller/queued-assignment-fixture.mjs';

// The finite fixture uses the original Pi tool; only governed launch is held before allocation.
// The parent owns this worker and verifies its PID/nonce before terminating it.
const [receiptFile, nonce] = process.argv.slice(2);
const watchdog = setTimeout(() => process.exit(93), 15000);
const f = await queuedAssignmentWorld({after() {}, diagnostic() {}});
for (let count = 0; count < 300; count++) {
    if (['IDLE', 'WAITING'].includes(f.c.inspectConversation(f.parent).state)) break;
    await new Promise(resolve => setTimeout(resolve, 10));
}
const review = f.snapshot(), parent = f.c.inspectConversation(f.parent);
if (!['IDLE', 'WAITING'].includes(parent.state) || !parent.historyRef)
    throw Error('Original coordinator did not settle with native history');
const historySha256 = createHash('sha256').update(await fs.readFile(parent.historyRef)).digest('hex');
await fs.writeFile(receiptFile + '.tmp', JSON.stringify({
    nonce, pid: process.pid, root: f.root, home: f.home, parent: f.parent, child: f.input.conversationId,
    assignmentId: f.assignment.id, inputId: review.inputId, parentHistory: parent.historyRef, historySha256,
    works: f.c.store.all('SELECT * FROM works'), runs: f.c.store.all('SELECT * FROM runs'),
    budgets: f.c.store.all('SELECT * FROM budgets ORDER BY rowid'),
}), {mode: 0o600});
await fs.rename(receiptFile + '.tmp', receiptFile);
// No subprocess/native scope or engine can be created: the preload denies every child-process entry.
watchdog.refresh();
await new Promise(() => {});
