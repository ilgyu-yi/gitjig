import fs from 'node:fs/promises';
import path from 'node:path';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { prepareNativeSeed } from '../../dist/controller/native-seed.js';
import { nativeCheckpoint } from '../../dist/controller/history.js';

/** Original SDK context fixture; no generated answer, run, role or review proof. */
export async function seedForkUI(controller, root, home) {
    const raw = controller.createConversation(), source = controller.createConversation(), sibling = controller.createConversation();
    const directory = path.join(home, 'state', 'fixture-native'); await fs.mkdir(directory, { mode: 0o700 });
    const manager = SessionManager.create(root, directory);
    manager.appendModelChange('fixture', 'not-executed');
    const message = text => ({ role: 'user', content: [{ type: 'text', text }], timestamp: Date.now() });
    const first = manager.appendMessage(message('FIXTURE_FIRST_CONTEXT')); manager.appendMessage(message('FIXTURE_SECOND_CONTEXT'));
    const seed = await prepareNativeSeed({ stateRoot: path.join(home, 'state'), cwd: root, kind: 'clone', destinationId: source.conversationId,
        source: { conversationId: raw.conversationId, generation: 0, projectId: null, modelRevision: 0, sessionId: manager.getSessionId(),
            historyRef: manager.getSessionFile(), checkpoint: await nativeCheckpoint(manager.getSessionFile()), selectedLeaf: manager.getLeafId() } });
    controller.store.run('UPDATE conversations SET history=? WHERE id=?', seed.destination.historyRef, source.conversationId);
    controller.store.run('UPDATE conversation_state SET native_id=?,data=? WHERE conversation=?', seed.destination.sessionId,
        JSON.stringify({ nativeSeed: seed, fixture: 'original SDK non-authority context' }), source.conversationId);
    controller.setConversationName({ conversationId: source.conversationId, expectedGeneration: 0, name: 'UI_SOURCE' });
    controller.setConversationName({ conversationId: sibling.conversationId, expectedGeneration: 0, name: 'UI_SIBLING' });
    controller.setDraft({ conversationId: sibling.conversationId, expectedRevision: 0, text: 'SIBLING_KEEP' });
    controller.setConversationView({ selectedId: source.conversationId, secondId: sibling.conversationId });
    return { source, sibling, first, file: seed.destination.historyRef };
}
