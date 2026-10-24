import fs from 'node:fs/promises';
import path from 'node:path';
import { openController } from '../../dist/controller/index.js';
import { selectControllerModel } from '../../dist/cli/selected-model.js';
import { startConversationUI } from '../../dist/ui/index.js';
const cfg = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
const c = await openController({ installationHome: cfg.home });
process.env.TMPDIR = path.join(cfg.home, 'artifacts');
const parent = c.createConversation(), child = c.createConversation();
c.setConversationParent({ childId: child.conversationId, parentId: parent.conversationId, expectedRevision: 0 });
const goal = c.createGoal({ conversationId: parent.conversationId, objective: 'Observe held goal responsiveness', criteria: ['Owner can navigate and pause'] });
const model = await selectControllerModel(cfg.profile, c);
let cache, calls = 0, writes = Promise.resolve();
const write = () => { const snapshot = { selected: cache?.selectedConversationId, parent: parent.conversationId, child: child.conversationId, goal: c.inspectGoal(goal.goalId), calls }; writes = writes.then(() => fs.writeFile(cfg.control, JSON.stringify(snapshot))); };
globalThis.fetch = async (url, init) => {
  if (String(url) !== 'https://openrouter.ai/api/v1/chat/completions' || ++calls > 1) throw Error('Undeclared goal UI request');
  write(); return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('Owner pause', 'AbortError')), { once: true }));
};
const off = c.subscribeGoals(write);
try {
  await startConversationUI({ controller: c, model, conversationId: parent.conversationId, onViewCacheState: value => { cache = value; write(); } });
  await writes; await fs.writeFile(cfg.receipt, JSON.stringify({ goal: c.inspectGoal(goal.goalId), calls, selected: cache?.selectedConversationId }));
} finally { off(); await c.close(); }
