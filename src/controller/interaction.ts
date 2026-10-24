import { assertConversationExecutable, assertWorkConversation, nativeInputRecoveryRequired } from './completed-resources.js';
import { relevantCoordinators, writeNotice } from './conversation-results.js';
import { nativeCheckpoint } from './history.js';
import { privateFile } from './ownership.js';
import { openNativeSeedHistory, validateNativeSeed, currentNativeHeader } from './native-seed.js';
import { randomUUID } from 'node:crypto';
import { prepareCapturedInput, assertCapturedInputRun, consumeInputContext, type ContextReceipt } from './input-context.js';
import type { Store } from './store.js';
import { validateModelChoice, writeConversationModelChoice, type ModelChoiceInput } from './model-choice.js';
import type { ConversationView, RelationView, NativeRegistration, NativeIdentity, NativeLifecycle, InteractionEvent, DraftReceipt, InputOptions, InputReceipt } from './interaction-types.js';
export class Interactions {
    private nativeUnsub = new Map<string, () => void>();
    private initialObserved = new Set<string>();
    private nativePending = new Map<string, string>();
    private routing = new Map<string, {
        inputId: string;
        registration: NativeRegistration;
        phase: 'preparing' | 'delivering';
        settling: boolean;
        done: Promise<void>;
        sdkTail: Promise<unknown> | undefined;
    }>();
    private queuedText = new Map<string, {
        inputId: string;
        registration: NativeRegistration;
        text: string;
    }>();
    private live = new Map<string, NativeRegistration>();
    private listeners = new Set<(event: InteractionEvent) => void>();
    constructor(private store: Store, private assertOpen: () => void, private stateRoot?: string, private admit: (cid: string) => void = () => { }) {
    }
    private ensure(id: string) {
        const row = this.store.one('SELECT * FROM conversations WHERE id=?', id);
        if (!row)
            throw new Error('Unknown conversation');
        this.store.run('INSERT OR IGNORE INTO conversation_state(conversation,data) VALUES(?,?)', id, '{}');
        this.store.run('INSERT OR IGNORE INTO conversation_relations(child) VALUES(?)', id);
        this.store.run('INSERT OR IGNORE INTO conversation_views(conversation) VALUES(?)', id);
        return row;
    }
    create(options: {
        projectId?: string | null;
    } = {}): ConversationView {
        return this.createInitialized(options);
    }
    createWithModelChoice(options: {
        projectId?: string | null;
    }, choice: ModelChoiceInput, assertCurrent: () => void): ConversationView {
        return this.createInitialized(options, validateModelChoice(choice), assertCurrent);
    }
    private createInitialized(options: {
        projectId?: string | null;
    }, choice?: ModelChoiceInput, assertCurrent?: () => void): ConversationView {
        this.assertOpen();
        const project = options.projectId ?? null;
        if (project !== null && !this.store.one('SELECT id FROM projects WHERE id=?', project))
            throw new Error('Unknown registered project');
        const id = randomUUID();
        this.store.tx(() => {
            assertCurrent?.();
            this.store.run('INSERT INTO conversations VALUES(?,?,NULL,0,?)', id, project, 'IDLE');
            this.ensure(id);
            if (choice)
                writeConversationModelChoice(this.store, id, choice, 0);
        });
        return this.inspect(id);
    }
    list(): ConversationView[] {
        this.assertOpen();
        return this.store.all('SELECT id FROM conversations ORDER BY rowid').map(row => this.inspect(row.id)).filter(view => !view.deleted);
    }
    inspect(id: string): ConversationView {
        this.assertOpen();
        const c = this.ensure(id), s = this.store.one('SELECT * FROM conversation_state WHERE conversation=?', id), r = this.store.one('SELECT * FROM conversation_relations WHERE child=?', id), v = this.store.one('SELECT * FROM conversation_views WHERE conversation=?', id);
        const data = JSON.parse(s.data), first = this.store.one('SELECT text FROM conversation_inputs WHERE conversation=? AND text IS NOT NULL ORDER BY rowid LIMIT 1', id);
        const derived = data.role ? (data.role + (data.purpose ? ' · ' + data.purpose : '')) : (first?.text?.replace(/\s+/g, ' ').slice(0, 80) ?? (c.project ? 'Investigation' : 'Control conversation'));
        const label = data.userLabel ? (data.role ? `${derived} · ${data.userLabel}` : data.userLabel) : derived;
        return { conversationId: id, label, ...(data.userLabel ? { userLabel: data.userLabel } : {}), ...(data.role ? { role: data.role } : {}), projectId: c.project, generation: c.generation, state: s.resource, historyRef: c.history, nativeSessionId: s.native_id, workId: s.work, parentId: r.parent, relationRevision: r.revision, directionRevision: s.direction, draft: { revision: v.draft_revision, text: v.draft }, scroll: { entryId: v.scroll_entry, offset: v.scroll_offset, followEnd: !!v.follow_end }, humanLastUsed: s.human_used, inputNeeded: !!JSON.parse(s.data).dialogs?.length, archived: !!s.archived, deleted: !!data.lifecycle?.deleted, ...(data.lifecycle ? { lifecycle: data.lifecycle } : {}), ...(data.noticeDeliveryStatus ? { coordinationDelivery: data.noticeDeliveryStatus } : {}) };
    }
    name(input: {
        conversationId: string;
        expectedGeneration: number;
        name: string | null;
    }): ConversationView {
        this.assertOpen();
        if (input.name !== null && typeof input.name !== 'string')
            throw new Error('Conversation name must be text or an explicit reset');
        if (input.name !== null && /[\x00-\x1f\x7f-\x9f]/u.test(input.name))
            throw new Error('Conversation name cannot contain control characters');
        const name = input.name === null ? null : input.name.trim();
        if (name !== null && (!name || name.length > 120 || /[\x00-\x1f\x7f-\x9f]/u.test(name)))
            throw new Error('Conversation name requires 1..120 UTF-16 code units without control characters');
        return this.store.tx(() => {
            assertConversationExecutable(this.store, input.conversationId);
            if (this.inspect(input.conversationId).generation !== input.expectedGeneration)
                throw new Error('Stale conversation generation');
            const row = this.store.one('SELECT data FROM conversation_state WHERE conversation=?', input.conversationId), data = JSON.parse(row.data);
            if (name === null)
                delete data.userLabel;
            else
                data.userLabel = name;
            this.store.run('UPDATE conversation_state SET data=? WHERE conversation=?', JSON.stringify(data), input.conversationId);
            return this.inspect(input.conversationId);
        });
    }
    parent(options: {
        childId: string;
        parentId: string | null;
        expectedRevision: number;
        actor?: NativeIdentity;
    }): RelationView {
        this.assertOpen();
        const receipt = this.store.tx(() => {
            assertConversationExecutable(this.store, options.childId);
            this.ensure(options.childId);
            if (options.parentId) {
                assertConversationExecutable(this.store, options.parentId);
                this.ensure(options.parentId);
            }
            const current = this.store.one('SELECT * FROM conversation_relations WHERE child=?', options.childId);
            if (current.revision !== options.expectedRevision)
                throw new Error('Relation revision conflict');
            const seen = new Set([options.childId]);
            let next = options.parentId;
            while (next) {
                if (seen.has(next))
                    throw new Error('Conversation parent cycle refused');
                seen.add(next);
                next = this.store.one('SELECT parent FROM conversation_relations WHERE child=?', next)?.parent ?? null;
            }
            this.store.run('UPDATE conversation_relations SET parent=?,revision=revision+1 WHERE child=?', options.parentId, options.childId);
            for (const target of new Set<string>([current.parent, options.parentId].filter((id): id is string => typeof id === 'string')))
                writeNotice(this.store, target, { kind: 'parent-changed', eventKey: `parent:${options.childId}:${current.revision + 1}`, conversationId: options.childId, oldParentId: current.parent, newParentId: options.parentId, fromRevision: current.revision, toRevision: current.revision + 1, actor: options.actor ?? { kind: 'owner', uid: process.getuid?.() ?? null } });
            return { childId: options.childId, parentId: options.parentId, revision: current.revision + 1 };
        });
        this.noticeCommitted(options.childId);
        return receipt;
    }
    lifecycleCommit(id: string, expectedGeneration: number, kind: 'archive' | 'restore' | 'delete') {
        this.assertOpen();
        return this.store.tx(() => {
            assertConversationExecutable(this.store, id, true);
            const view = this.inspect(id);
            if (view.generation !== expectedGeneration)
                throw Error('Stale lifecycle generation');
            const row = this.store.one('SELECT data FROM conversation_state WHERE conversation=?', id), data = JSON.parse(row.data), at = Date.now(), actionId = randomUUID();
            const lifecycle = { ...data.lifecycle, lastAction: { kind, actionId, at }, ...(kind === 'delete' ? { deleted: { conversationId: id, generation: expectedGeneration, actionId, uid: process.getuid?.() ?? null, at } } : {}) };
            this.store.run('UPDATE conversation_state SET archived=?,data=? WHERE conversation=?', kind === 'archive' ? 1 : kind === 'restore' ? 0 : (view.archived ? 1 : 0), JSON.stringify({ ...data, lifecycle }), id);
            if (kind !== 'restore')
                this.store.run('UPDATE interaction_view SET selected=CASE WHEN selected=? THEN NULL ELSE selected END,second=CASE WHEN second=? THEN NULL ELSE second END WHERE id=1', id, id);
            return { conversationId: id, generation: expectedGeneration, outcome: kind === 'delete' ? 'deleted' : kind === 'archive' ? 'archived' : 'restored', actionId };
        });
    }
    draft(options: {
        conversationId: string;
        expectedRevision: number;
        text: string;
    }): DraftReceipt {
        this.assertOpen();
        this.ensure(options.conversationId);
        if (Buffer.byteLength(options.text) > 512 * 1024)
            throw new Error('Draft exceeds512KiB; retain editor and shorten explicitly');
        const row = this.store.one('SELECT * FROM conversation_views WHERE conversation=?', options.conversationId);
        if (row.draft_revision !== options.expectedRevision)
            throw new Error('Draft revision conflict; keep current editor text');
        if (row.draft === options.text)
            return { conversationId: options.conversationId, revision: row.draft_revision, text: options.text };
        this.store.run('UPDATE conversation_views SET draft_revision=draft_revision+1,draft=? WHERE conversation=?', options.text, options.conversationId);
        return { conversationId: options.conversationId, revision: row.draft_revision + 1, text: options.text };
    }
    allocateRole(options: {
        workId: string;
        runId: string;
        launchId: string;
        role: string;
        purpose?: string;
    }): NativeIdentity {
        assertWorkConversation(this.store, options.workId);
        const w = this.store.one('SELECT * FROM works WHERE id=?', options.workId);
        const c = this.create({ projectId: w.project });
        const parent = JSON.parse(w.data).conversation;
        if (parent)
            this.parent({ childId: c.conversationId, parentId: parent, expectedRevision: 0 });
        return this.store.tx(() => {
            const initialInputId = randomUUID();
            this.store.run('UPDATE conversations SET generation=1,state=? WHERE id=?', 'QUEUED', c.conversationId);
            this.store.run('UPDATE conversation_state SET work=?,resource=?,data=? WHERE conversation=?', w.id, 'QUEUED', JSON.stringify({ role: options.role, purpose: options.purpose, runId: options.runId }), c.conversationId);
            this.store.run('INSERT INTO conversation_inputs VALUES(?,?,?,?,?,?,?,?,?)', initialInputId, c.conversationId, 1, w.id, w.source, 'INITIAL_RESERVED', 'initial', null, JSON.stringify({ launchId: options.launchId }));
            return { conversationId: c.conversationId, workId: w.id, runId: options.runId, launchId: options.launchId, generation: 1, directionRevision: 0, initialInputId };
        });
    }
    cleanup(identity: NativeIdentity, receipt: {
        cleanup: string;
        settled: boolean;
    }) {
        const c = this.store.one('SELECT generation FROM conversations WHERE id=?', identity.conversationId), s = this.store.one('SELECT work,data FROM conversation_state WHERE conversation=?', identity.conversationId);
        if (!c || c.generation !== identity.generation || s.work !== identity.workId || JSON.parse(s.data).runId !== identity.runId)
            return;
        const clean = receipt.settled && ['removed', 'not-allocated', 'unbound'].includes(receipt.cleanup);
        this.store.run('UPDATE conversation_state SET resource=?,data=? WHERE conversation=?', clean && !nativeInputRecoveryRequired(this.store, identity.conversationId) ? 'IDLE' : 'UNKNOWN', JSON.stringify({ ...JSON.parse(s.data), cleanup: receipt }), identity.conversationId);
        this.emit({ conversationId: identity.conversationId, generation: identity.generation, type: 'cleanup', data: receipt });
    }
    project(options: {
        conversationId: string;
        projectId: string;
        expectedGeneration: number;
    }) {
        this.assertOpen();
        return this.store.tx(() => {
            assertConversationExecutable(this.store, options.conversationId);
            const view = this.inspect(options.conversationId), state = this.store.one('SELECT data FROM conversation_state WHERE conversation=?', view.conversationId), data = JSON.parse(state.data);
            if (view.archived || view.generation !== options.expectedGeneration || view.state !== 'IDLE' || this.live.has(view.conversationId) || data.continuationAuthorized || this.store.one("SELECT id FROM conversation_inputs WHERE conversation=? AND state IN ('QUEUED','NATIVE_PENDING','RECONCILIATION_REQUIRED','INITIAL_RESERVED')", view.conversationId) || this.store.one("SELECT id FROM conversation_dependencies WHERE waiting=? AND state='PENDING'", view.conversationId))
                throw new Error('PROJECT_SCOPE_UNAVAILABLE: requires exact idle reconciled conversation');
            if (!this.store.one('SELECT id FROM projects WHERE id=?', options.projectId))
                throw new Error('Unknown registered project');
            if (view.projectId === options.projectId)
                return view;
            const source = randomUUID(), transition = { sourceId: source, conversationId: view.conversationId, priorProjectId: view.projectId, projectId: options.projectId, priorWorkId: view.workId, fromGeneration: view.generation, toGeneration: view.generation + 1 };
            this.store.run('INSERT INTO sources VALUES(?,?,?,?)', source, view.conversationId, JSON.stringify({ kind: 'owner-scope-transition', uid: process.getuid?.(), event: randomUUID() }), JSON.stringify(transition));
            this.store.run('UPDATE conversations SET project=?,generation=generation+1 WHERE id=?', options.projectId, view.conversationId);
            this.store.run('UPDATE conversation_state SET data=? WHERE conversation=?', JSON.stringify({ ...data, scopeTransition: transition }), view.conversationId);
            return this.inspect(view.conversationId);
        });
    }
    scroll(options: {
        conversationId: string;
        entryId: string | null;
        offset: number;
        followEnd: boolean;
    }) {
        this.assertOpen();
        this.ensure(options.conversationId);
        if (!Number.isSafeInteger(options.offset) || options.offset < 0)
            throw new Error('Invalid scroll offset');
        this.store.run('UPDATE conversation_views SET scroll_entry=?,scroll_offset=?,follow_end=? WHERE conversation=?', options.entryId, options.offset, options.followEnd ? 1 : 0, options.conversationId);
    }
    entry(): {
        conversationId: string;
        reason: 'last-view' | 'recent-view';
    } | undefined {
        this.assertOpen();
        const accessible = "s.archived=0 AND COALESCE(json_extract(s.data,'$.lifecycle.deleted'),0)=0";
        const selected = this.store.one(`SELECT c.id FROM interaction_view v JOIN conversations c ON c.id=v.selected JOIN conversation_state s ON s.conversation=c.id WHERE v.id=1 AND ${accessible}`);
        if (selected)
            return { conversationId: selected.id, reason: 'last-view' };
        const recent = this.store.one(`SELECT c.id FROM conversations c JOIN conversation_state s ON s.conversation=c.id WHERE ${accessible} AND s.human_used>0 ORDER BY s.human_used DESC,c.id LIMIT 1`);
        return recent ? { conversationId: recent.id, reason: 'recent-view' } : undefined;
    }
    view(options: {
        selectedId: string;
        secondId?: string | null;
    }) {
        this.assertOpen();
        assertConversationExecutable(this.store, options.selectedId, false, true);
        this.ensure(options.selectedId);
        if (options.secondId) {
            assertConversationExecutable(this.store, options.secondId, false, true);
            this.ensure(options.secondId);
        }
        this.store.run('INSERT INTO interaction_view VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET selected=excluded.selected,second=excluded.second', options.selectedId, options.secondId ?? null);
        const humanUse = Date.now();
        this.store.run('UPDATE conversation_state SET human_used=? WHERE conversation=?', humanUse, options.selectedId);
        if (options.secondId && options.secondId !== options.selectedId)
            this.store.run('UPDATE conversation_state SET human_used=? WHERE conversation=?', humanUse, options.secondId);
    }
    dialogs(options: {
        identity: NativeIdentity;
        requestIds: readonly string[];
    }) {
        if (!this.matches(options.identity))
            throw new Error('Stale native dialog identity');
        if (options.requestIds.length > 16 || new Set(options.requestIds).size !== options.requestIds.length)
            throw new Error('Dialog queue exceeds finite profile');
        const row = this.store.one('SELECT data FROM conversation_state WHERE conversation=?', options.identity.conversationId);
        this.store.run('UPDATE conversation_state SET data=? WHERE conversation=?', JSON.stringify({ ...JSON.parse(row.data), dialogs: [...options.requestIds] }), options.identity.conversationId);
    }
    async history(id: string) {
        this.assertOpen();
        const live = this.getHandle(id);
        if (live)
            return { sessionManager: live.sessionManager, cwd: live.sessionManager.getCwd() };
        const view = this.inspect(id);
        if (!view.historyRef)
            return null;
        const rows = this.store.all("SELECT data FROM runs WHERE json_extract(data,'$.nativeSessionId')=? ORDER BY rowid DESC", view.nativeSessionId);
        const proof = rows.map(row => JSON.parse(row.data)).find(data => data.nativeCheckpoint && data.historyRef === view.historyRef);
        const data = JSON.parse(this.store.one('SELECT data FROM conversation_state WHERE conversation=?', id).data);
        if (Object.hasOwn(data, 'nativeSeed')) {
            if (!this.stateRoot)
                throw new Error('Native seed requires trusted controller state root');
            const seed = validateNativeSeed(data.nativeSeed, view, this.stateRoot);
            if (!this.store.one('SELECT id FROM conversations WHERE id=?', seed.source.conversationId))
                throw new Error('Native seed source provenance unavailable');
            const history = await openNativeSeedHistory(seed, view, this.stateRoot);
            // A genuine later run is the current checkpoint; it cannot discard
            // the seed prefix/provenance that admitted the first branch turn.
            if (proof?.nativeCheckpoint) {
                if (proof.nativeSessionId !== view.nativeSessionId)
                    throw new Error('Native history checkpoint identity mismatch');
                await nativeCheckpoint(view.historyRef, proof.nativeCheckpoint);
            }
            this.assertOpen();
            const current = this.inspect(id);
            if (current.generation !== view.generation || current.historyRef !== view.historyRef || current.nativeSessionId !== view.nativeSessionId || current.deleted !== view.deleted || current.archived !== view.archived ||
                JSON.stringify(JSON.parse(this.store.one('SELECT data FROM conversation_state WHERE conversation=?', id).data).nativeSeed) !== JSON.stringify(seed))
                throw new Error('Native seed target changed during history retrieval');
            return history;
        }
        if (!proof?.nativeCheckpoint || proof.nativeSessionId !== view.nativeSessionId)
            throw new Error('Required native history checkpoint unavailable');
        await privateFile(view.historyRef);
        await nativeCheckpoint(view.historyRef, proof.nativeCheckpoint);
        await currentNativeHeader(view.historyRef, view.nativeSessionId!);
        this.assertOpen();
        const { SessionManager } = await import('@earendil-works/pi-coding-agent');
        const manager = SessionManager.open(view.historyRef);
        if (manager.getSessionId() !== view.nativeSessionId)
            throw new Error('Native history identity changed');
        return { sessionManager: manager, cwd: manager.getCwd() };
    }
    /** Controller-created continuation, never a new owner direction or authority grant. */
    enqueueGenerated(options: InputOptions, generated: {
        goalId: string;
        revision: number;
    }): InputReceipt {
        return this.enqueue(options, undefined, undefined, undefined, generated);
    }
    /** Trusted owner entry: commit its synchronous state transition with the input. */
    enqueueOwnerEntry(options: InputOptions, accept: (receipt: InputReceipt) => void): InputReceipt {
        return this.enqueue(options, undefined, undefined, undefined, undefined, accept);
    }
    enqueue(options: InputOptions, actor?: NativeIdentity, trustedAdmission?: () => void, captured?: ContextReceipt, generated?: {
        goalId: string;
        revision: number;
    }, accept?: (receipt: InputReceipt) => void): InputReceipt {
        this.assertOpen();
        this.assertInputReady(options.conversationId);
        if (!options.text.trim() || Buffer.byteLength(options.text) > 512 * 1024)
            throw new Error('Input must be nonempty and at most512KiB');
        if (options.attachments?.length)
            throw new Error('Attachments require owned capture receipt before dispatch');
        const receipt = this.store.tx(() => {
            this.admit(options.conversationId);
            assertConversationExecutable(this.store, options.conversationId);
            const v = this.inspect(options.conversationId);
            if (v.archived || v.generation !== options.expectedGeneration)
                throw new Error('Stale/archived input target');
            if (options.draftRevision !== undefined && v.draft.revision !== options.draftRevision)
                throw new Error('Draft revision changed');
            trustedAdmission?.();
            const queued = this.store.one("SELECT COUNT(*) AS count FROM conversation_inputs WHERE conversation=? AND state='QUEUED'", v.conversationId).count;
            if (queued >= 16)
                throw new Error('Input queue exceeds16');
            if (!actor && !generated) {
                for (const prior of this.store.all("SELECT i.*,s.origin FROM conversation_inputs i JOIN sources s ON s.id=i.source WHERE i.conversation=? AND i.state IN ('QUEUED','NATIVE_PENDING')", v.conversationId)) {
                    if (!['agent-conversation-input', 'agent-assignment'].includes(JSON.parse(prior.origin).kind))
                        continue;
                    const pending = this.nativePending.get(v.conversationId);
                    if (pending === prior.id) {
                        const cleared = this.live.get(v.conversationId)?.session.clearQueue();
                        if (!cleared || !this.clearedMatches(prior.id, cleared)) {
                            this.store.run('UPDATE conversation_state SET resource=? WHERE conversation=?', 'UNKNOWN', v.conversationId);
                        }
                        this.nativePending.delete(v.conversationId);
                        this.queuedText.delete(v.conversationId);
                    }
                    this.store.run('UPDATE conversation_inputs SET state=?,data=? WHERE id=?', 'CONFLICTED', JSON.stringify({ ...JSON.parse(prior.data), reason: 'New direct owner direction supersedes unconsumed parent input', newRevision: v.directionRevision + 1 }), prior.id);
                }
            }
            const retainedWork = v.workId ? this.store.one('SELECT * FROM works WHERE id=?', v.workId) : null, affectedWork = retainedWork?.project === v.projectId ? retainedWork : null;
            const inputId = randomUUID(), sourceId = randomUUID(), revision = v.directionRevision + 1;
            if (captured && actor)
                throw new Error('Agent text cannot acquire host file context');
            const context = captured ? consumeInputContext(captured, options, { projectId: v.projectId,
                root: v.projectId ? this.store.one('SELECT root FROM projects WHERE id=?', v.projectId).root : null, inputId, sourceId }) : undefined;
            this.store.run('INSERT INTO sources VALUES(?,?,?,?)', sourceId, v.conversationId, JSON.stringify({ ...(generated ? { kind: 'goal-continuation', ...generated, event: randomUUID() } : actor ? { kind: 'agent-conversation-input', actor, event: randomUUID() } : { kind: 'owner-conversation-input', uid: process.getuid?.(), event: randomUUID() }),
                ...(context ? { context: context.manifest } : {}) }), context?.raw ?? options.text);
            this.store.run('INSERT INTO conversation_inputs VALUES(?,?,?,?,?,?,?,?,?)', inputId, v.conversationId, v.generation, v.workId, sourceId, 'QUEUED', options.mode, context?.text ?? options.text, JSON.stringify(context ? { context: context.manifest } : {}));
            this.store.run('INSERT INTO conversation_directions VALUES(?,?,?,?)', v.conversationId, revision, sourceId, JSON.stringify({ inputId, classification: generated ? 'explanation' : 'unknown', effectHold: !generated, affectedWorkId: generated ? null : affectedWork?.id ?? null, affectedGeneration: v.generation, affectedAssignmentId: affectedWork ? JSON.parse(affectedWork.data).invocation?.assignmentId ?? JSON.parse(affectedWork.data).assignmentId ?? null : null, affectedRunId: affectedWork ? JSON.parse(this.store.one('SELECT data FROM conversation_state WHERE conversation=?', v.conversationId).data).runId ?? null : null }));
            const state = this.store.one('SELECT data FROM conversation_state WHERE conversation=?', v.conversationId);
            this.store.run('UPDATE conversation_state SET direction=?,human_used=?,data=? WHERE conversation=?', revision, actor || generated ? v.humanLastUsed : Date.now(), JSON.stringify({ ...JSON.parse(state.data), ...(generated ? {} : { effectHold: true }) }), v.conversationId);
            if (!actor && !generated)
                for (const target of relevantCoordinators(this.store, v.conversationId, affectedWork ? JSON.parse(affectedWork.data).invocation?.assignmentId ?? JSON.parse(affectedWork.data).assignmentId ?? null : null))
                    writeNotice(this.store, target, { kind: 'owner-direction-changed', eventKey: `direction:${v.conversationId}:${revision}`, conversationId: v.conversationId, inputId, sourceId, revision, affectedWorkId: affectedWork?.id ?? null, classification: 'unknown', effectsHeld: true });
            const receipt: InputReceipt = { inputId, conversationId: v.conversationId, generation: v.generation, sourceId, state: 'QUEUED', directionRevision: revision };
            if (accept?.(receipt) !== undefined)
                throw Error('Synchronous owner input transition required');
            return receipt;
        });
        this.noticeCommitted(receipt.conversationId);
        this.emit({ conversationId: receipt.conversationId, generation: receipt.generation, type: 'input-queued', data: receipt });
        return receipt;
    }
    /** Caller holds the store transaction. Handled failure is not successful delivery. */
    settleManualInput(runId: string): boolean {
        const run = this.store.one('SELECT * FROM runs WHERE id=?', runId);
        if (!run || run.phase !== 'SETTLED' || run.reservation !== 'consumed')
            return false;
        let proof: any;
        try {
            proof = JSON.parse(run.data);
        }
        catch {
            return false;
        }
        if (!proof || typeof proof !== 'object')
            return false;
        const declared = proof.manualAction, action = declared?.kind ?? proof.nativeManualAttempted;
        if (proof.kind !== 'ordinary-conversation' || proof.outcome !== 'unavailable' || !['removed', 'not-allocated', 'unbound'].includes(proof.cleanup) || !['compact', 'navigate-tree'].includes(action) || typeof proof.initialInputId !== 'string' || (proof.nativeManualAttempted !== undefined && proof.nativeManualAttempted !== action))
            return false;
        const input = this.store.one('SELECT i.*,s.conversation AS source_conversation,s.origin AS source_origin,s.raw AS source_raw FROM conversation_inputs i JOIN sources s ON s.id=i.source WHERE i.id=?', proof.initialInputId);
        if (!input || input.state !== 'INITIAL_RESERVED' || input.mode !== 'manual' || input.work !== run.work || input.conversation !== proof.conversation || input.source_conversation !== input.conversation)
            return false;
        let data: any, origin: any;
        try {
            data = JSON.parse(input.data);
            origin = JSON.parse(input.source_origin);
        }
        catch {
            return false;
        }
        if (!data || !origin || typeof data !== 'object' || typeof origin !== 'object')
            return false;
        const raw = JSON.stringify(data.manual);
        if (!data.manual || data.manual.kind !== action || (declared !== undefined && JSON.stringify(declared) !== raw) || origin.kind !== 'owner-native-history-action' || origin.action !== data.manual.kind || raw !== input.text || raw !== input.source_raw || raw !== proof.raw || this.store.all("SELECT id FROM runs WHERE json_extract(data,'$.initialInputId')=?", input.id).length !== 1)
            return false;
        this.store.run('UPDATE conversation_inputs SET state=?,data=? WHERE id=?', 'CONSUMED', JSON.stringify({ ...data, manualSettlement: { kind: 'handled-failed-attempt', runId, outcome: proof.outcome, cleanup: proof.cleanup } }), input.id);
        return true;
    }
    recover() {
        this.store.tx(() => {
            for (const row of this.store.all("SELECT DISTINCT r.id FROM conversation_inputs i JOIN runs r ON json_extract(r.data,'$.initialInputId')=i.id WHERE i.mode='manual' AND i.state='INITIAL_RESERVED' AND r.phase='SETTLED'"))
                this.settleManualInput(row.id);
        });
        for (const row of this.store.all('SELECT * FROM conversation_state')) {
            const data = JSON.parse(row.data);
            if (data.lifecycle?.deleted)
                continue;
            if (nativeInputRecoveryRequired(this.store, row.conversation)) {
                this.store.run('UPDATE conversation_state SET resource=? WHERE conversation=?', 'UNKNOWN', row.conversation);
                continue;
            }
            if (!data.runId)
                continue;
            const run = this.store.one('SELECT * FROM runs WHERE id=?', data.runId);
            if (!run)
                continue;
            const proof = JSON.parse(run.data);
            if (run.phase === 'UNKNOWN') {
                this.store.run('UPDATE conversation_state SET resource=? WHERE conversation=?', 'UNKNOWN', row.conversation);
                continue;
            }
            if (run.phase === 'INTERRUPTED') {
                this.store.run('UPDATE conversation_state SET resource=? WHERE conversation=?', data.continuationAuthorized ? 'WAITING' : 'IDLE', row.conversation);
                this.store.run("UPDATE conversation_inputs SET state='QUEUED' WHERE conversation=? AND state='NATIVE_PENDING'", row.conversation);
                if (proof.initialInputId && !proof.outcome)
                    this.store.run('UPDATE conversation_inputs SET state=? WHERE id=?', 'QUEUED', proof.initialInputId);
            }
        }
    }
    impacts(work: string) {
        return this.store.all("SELECT d.*,i.text,i.id AS input_id,i.source FROM conversation_directions d JOIN conversation_state s ON s.conversation=d.conversation JOIN conversation_inputs i ON i.id=json_extract(d.data,'$.inputId') WHERE json_extract(d.data,'$.affectedWorkId')=? ORDER BY d.rowid", work).map(row => ({ ...row, data: JSON.parse(row.data) }));
    }
    private clearedMatches(inputId: string, cleared: {
        steering: unknown[];
        followUp: unknown[];
    }) {
        const row = this.store.one('SELECT mode,conversation FROM conversation_inputs WHERE id=?', inputId), expected = row && this.queuedText.get(row.conversation);
        const count = row?.mode === 'follow-up' ? cleared.steering.length === 0 && cleared.followUp.length === 1 : row?.mode === 'steer' && cleared.steering.length === 1 && cleared.followUp.length === 0;
        return count && !!expected && expected.inputId === inputId && this.live.get(row.conversation) === expected.registration &&
            (row.mode === 'follow-up' ? cleared.followUp[0] : cleared.steering[0]) === expected.text;
    }
    assertInputReady(id: string) {
        if (this.routing.get(id)?.phase === 'delivering')
            throw new Error('Native input delivery is settling; retry with the retained draft');
    }
    quiesceNative(identity: NativeIdentity) {
        this.assertInputReady(identity.conversationId);
        const attempt = this.routing.get(identity.conversationId);
        if (attempt)
            attempt.settling = true;
        if (!this.matches(identity))
            throw new Error('Stale native queue owner');
        if (!this.clearPending(identity))
            throw new Error('NATIVE_INPUT_RECOVERY_REQUIRED: native queue disposition is uncertain; inspect retained conversation/run/input evidence; automatic reconciliation is unavailable');
        this.store.run('UPDATE conversation_state SET resource=? WHERE conversation=?', 'SETTLING', identity.conversationId);
    }
    async queue(options: InputOptions, actor?: NativeIdentity, trustedAdmission?: () => void, captured?: ContextReceipt): Promise<InputReceipt> {
        const receipt = this.enqueue(options, actor, trustedAdmission, captured);
        await this.route(receipt.conversationId);
        return receipt;
    }
    private async route(id: string) {
        try {
            this.admit(id);
        }
        catch {
            return;
        } // Defer without consuming the queued input.
        assertConversationExecutable(this.store, id);
        const registration = this.live.get(id);
        if (!registration || !this.initialObserved.has(id) || this.nativePending.has(id) || this.routing.has(id) || this.inspect(id).state !== 'RUNNING')
            return;
        const input = this.store.one("SELECT * FROM conversation_inputs WHERE conversation=? AND state='QUEUED' AND mode IN ('steer','follow-up') ORDER BY rowid LIMIT 1", id);
        if (!input)
            return;
        let finish!: () => void;
        const done = new Promise<void>(resolve => { finish = resolve; }), attempt = { inputId: input.id, registration, phase: 'preparing' as 'preparing' | 'delivering', settling: false, done, sdkTail: undefined as Promise<unknown> | undefined };
        this.routing.set(id, attempt);
        try {
            const prepared = await prepareCapturedInput(this.store, this.stateRoot!, input.id, { identity: registration.identity, kind: 'live' });
            const text = prepared.text;
            this.admit(id);
            assertConversationExecutable(this.store, id);
            const current = this.store.one('SELECT * FROM conversation_inputs WHERE id=?', input.id), view = this.inspect(id);
            if (current?.state === 'QUEUED' && (current.generation !== input.generation || input.generation !== view.generation))
                throw new Error('Queued input generation changed; explicit reconciliation required');
            if (attempt.settling || this.routing.get(id) !== attempt || this.live.get(id) !== registration || !this.matches(registration.identity) ||
                view.state !== 'RUNNING' || view.generation !== input.generation || view.workId !== registration.identity.workId ||
                current?.state !== 'QUEUED' || current.source !== input.source || current.text !== input.text || current.data !== input.data)
                return;
            assertCapturedInputRun(this.store, input.id, registration.identity, 'live', prepared.comparison);
            const run = this.store.one('SELECT data FROM runs WHERE id=?', registration.identity.runId);
            if (!run)
                throw new Error('Native input run identity unavailable');
            const runData = JSON.parse(run.data), context = JSON.parse(input.data).context;
            this.store.run('UPDATE runs SET data=? WHERE id=?', JSON.stringify({ ...runData, routedInputs: [...(runData.routedInputs ?? []), { inputId: input.id, sourceId: input.source,
                        generation: input.generation, ...(context ? { context } : {}), ...(prepared.comparison ? { comparison: prepared.comparison } : {}) }] }), registration.identity.runId);
            attempt.phase = 'delivering';
            this.nativePending.set(id, input.id);
            this.queuedText.set(id, { inputId: input.id, registration, text });
            this.store.run('UPDATE conversation_inputs SET state=? WHERE id=?', 'NATIVE_PENDING', input.id);
            attempt.sdkTail = input.mode === 'follow-up' ? registration.session.followUp(text) : registration.session.steer(text);
            const disposition = await attempt.sdkTail;
            if (disposition !== 'queued')
                throw new Error('Native input was not queued');
        }
        catch (error) {
            const current = this.store.one('SELECT state,data FROM conversation_inputs WHERE id=?', input.id);
            if (this.routing.get(id) === attempt && this.live.get(id) === registration && current && ['QUEUED', 'NATIVE_PENDING', 'CONSUMED'].includes(current.state)) {
                const delivered = attempt.phase === 'delivering';
                if (delivered && this.nativePending.get(id) === input.id) {
                    const cleared = registration.session.clearQueue();
                    this.nativePending.delete(id);
                    this.queuedText.delete(id);
                    this.store.run('UPDATE conversation_state SET resource=? WHERE conversation=?', 'UNKNOWN', id);
                    this.store.run('UPDATE conversation_inputs SET state=?,data=? WHERE id=?', 'RECONCILIATION_REQUIRED', JSON.stringify({ ...JSON.parse(current.data), routeError: String(error), clearReceipt: cleared }), input.id);
                }
                else
                    this.store.run('UPDATE conversation_inputs SET data=? WHERE id=?', JSON.stringify({ ...JSON.parse(current.data), routeError: String(error) }), input.id);
            }
        }
        finally {
            if (this.routing.get(id) === attempt)
                this.routing.delete(id);
            try {
                if (attempt.settling && this.live.get(id) === registration)
                    this.clearPending(registration.identity);
            }
            finally {
                finish();
                const current = this.store.one('SELECT state FROM conversation_inputs WHERE id=?', input.id);
                const resource = this.store.one('SELECT resource FROM conversation_state WHERE conversation=?', id);
                if (!attempt.settling && current && current.state !== 'QUEUED' && !this.nativePending.has(id) &&
                    this.live.get(id) === registration && resource?.resource === 'RUNNING')
                    queueMicrotask(() => { void this.route(id).catch(() => { }); });
            }
        }
    }
    private clearPending(identity: NativeIdentity) {
        const pending = this.nativePending.get(identity.conversationId), registration = this.live.get(identity.conversationId);
        if (!registration || !this.matches(identity))
            return true;
        const row = pending ? this.store.one('SELECT state,data FROM conversation_inputs WHERE id=?', pending) : null;
        let cleared: ReturnType<NativeRegistration['session']['clearQueue']>;
        try {
            cleared = registration.session.clearQueue();
        }
        catch {
            // No returned receipt establishes which native messages were cleared.
            // Physical cleanup cannot turn this input into safely replayable work.
            if (pending && row?.state === 'NATIVE_PENDING')
                this.store.run('UPDATE conversation_inputs SET state=? WHERE id=?', 'RECONCILIATION_REQUIRED', pending);
            const state = this.store.one('SELECT data FROM conversation_state WHERE conversation=?', identity.conversationId), data = JSON.parse(state.data);
            const nativeInputRecovery = { format: 'gitjig-native-input-recovery-1', runId: identity.runId, generation: identity.generation, reason: 'queue-clear-failed', ...(pending ? { inputId: pending } : {}) };
            this.store.run('UPDATE conversation_state SET resource=?,data=? WHERE conversation=?', 'UNKNOWN', JSON.stringify({ ...data, ...(Object.hasOwn(data, 'nativeInputRecovery') ? {} : { nativeInputRecovery }) }), identity.conversationId);
            this.nativePending.delete(identity.conversationId);
            this.queuedText.delete(identity.conversationId);
            throw Error('NATIVE_INPUT_RECOVERY_REQUIRED: native queue clear failed; disposition is unknown and automatic reconciliation is unavailable');
        }
        const exact = pending ? row?.state === 'NATIVE_PENDING' && this.clearedMatches(pending, cleared) : cleared.steering.length === 0 && cleared.followUp.length === 0;
        if (pending && row?.state === 'NATIVE_PENDING')
            this.store.run('UPDATE conversation_inputs SET state=?,data=? WHERE id=?', exact ? 'QUEUED' : 'RECONCILIATION_REQUIRED', JSON.stringify({ ...JSON.parse(row.data), clearReceipt: { steering: cleared.steering.length, followUp: cleared.followUp.length } }), pending);
        if (!exact) {
            const state = this.store.one('SELECT data FROM conversation_state WHERE conversation=?', identity.conversationId), data = JSON.parse(state.data);
            const nativeInputRecovery = { format: 'gitjig-native-input-recovery-1', runId: identity.runId, generation: identity.generation,
                reason: 'queue-disposition-uncertain', ...(pending ? { inputId: pending } : {}), clearCounts: { steering: cleared.steering.length, followUp: cleared.followUp.length } };
            this.store.run('UPDATE conversation_state SET resource=?,data=? WHERE conversation=?', 'UNKNOWN', JSON.stringify({ ...data, ...(Object.hasOwn(data, 'nativeInputRecovery') ? {} : { nativeInputRecovery }) }), identity.conversationId);
        }
        this.nativePending.delete(identity.conversationId);
        this.queuedText.delete(identity.conversationId);
        return exact && !nativeInputRecoveryRequired(this.store, identity.conversationId);
    }
    async drainNativeInputs(identity?: NativeIdentity) {
        if (identity) {
            const attempt = this.routing.get(identity.conversationId);
            if (attempt && attempt.registration.identity.runId === identity.runId && attempt.registration.identity.generation === identity.generation) {
                attempt.settling = true;
                await attempt.done;
            }
            this.clearPending(identity);
        }
        else {
            for (const attempt of this.routing.values())
                attempt.settling = true;
            await Promise.all([...this.routing.values()].map(attempt => attempt.done));
            for (const registration of this.live.values())
                this.clearPending(registration.identity);
        }
    }
    private nativeBoundary(identity: NativeIdentity) {
        const id = identity.conversationId;
        if (!this.matches(identity))
            return;
        if (!this.initialObserved.has(id)) {
            this.initialObserved.add(id);
            this.store.run('UPDATE conversation_inputs SET state=? WHERE id=?', 'CONSUMED', identity.initialInputId);
        }
        else {
            const pending = this.nativePending.get(id);
            if (!pending) {
                this.store.run('UPDATE conversation_state SET resource=? WHERE conversation=?', 'UNKNOWN', id);
                return;
            }
            const row = this.store.one('SELECT state FROM conversation_inputs WHERE id=?', pending);
            if (row?.state !== 'NATIVE_PENDING') {
                this.store.run('UPDATE conversation_state SET resource=? WHERE conversation=?', 'UNKNOWN', id);
                return;
            }
            this.nativePending.delete(id);
            this.queuedText.delete(id);
            this.store.run('UPDATE conversation_inputs SET state=? WHERE id=?', 'CONSUMED', pending);
            this.inputConsumed(identity);
        }
        void this.route(id);
    }
    private noticeTail: Promise<void> = Promise.resolve();
    private noticeQueued = new Map<string, string>();
    private noticeQueuedBytes = new Map<string, number>();
    private noticeCommitted(cid: string) {
        this.emit({ conversationId: cid, generation: this.inspect(cid).generation, type: 'coordination-notice' });
        void this.deliverNotices().catch(() => { /* Outbox remains pending; awaited admission/drain reports failure. */ });
    }
    /** No turn, owner input, acknowledgement, or authority is created by context delivery. */
    deliverNotices(cid?: string): Promise<void> {
        const prior = this.noticeTail;
        const job = prior.catch(() => { }).then(async () => {
            for (const [target, registration] of [...this.live]) {
                if (cid && target !== cid)
                    continue;
                const state = JSON.parse(this.store.one('SELECT data FROM conversation_state WHERE conversation=?', target).data);
                let cursor = state.noticeDeliveryCursor ?? 0;
                if (!Number.isSafeInteger(cursor) || cursor < 0)
                    throw Error('Notice delivery cursor unavailable');
                let rows = this.store.all("SELECT rowid AS noticeRow,* FROM conversation_notifications WHERE target=? AND state='PENDING' AND rowid>? ORDER BY rowid LIMIT 65", target, cursor);
                if (!rows.length && cursor) {
                    cursor = 0;
                    rows = this.store.all("SELECT rowid AS noticeRow,* FROM conversation_notifications WHERE target=? AND state='PENDING' AND rowid>? ORDER BY rowid LIMIT 65", target, cursor);
                }
                let total = 0, visited = 0, byteLimitHit = false, deferred = false;
                const key = registration.identity.runId + ':' + registration.identity.generation;
                try {
                    for (const row of rows.slice(0, 64)) {
                        if (!this.matches(registration.identity))
                            break;
                        let advance = true;
                        try {
                            const data = JSON.parse(row.data);
                            if (!['result-ready', 'parent-changed', 'owner-direction-changed'].includes(data.kind))
                                continue; // Legacy result notices remain inspectable.
                            const entries = registration.sessionManager.getEntries();
                            const matches = entries.filter(e => e.type === 'custom_message' && e.customType === 'gitjig.coordination-notice' && (e.details as any)?.noticeId === row.id);
                            if (matches.length > 1)
                                throw Error('Duplicate native notice identity; retain pending observation');
                            const actual = matches[0];
                            if (actual) {
                                const { delivery: _delivery, ...immutable } = data;
                                if (actual.type !== 'custom_message' || (actual.details as any)?.eventKey !== data.eventKey || actual.content !== JSON.stringify({ noticeId: row.id, ...immutable }))
                                    throw Error('Native notice content binding unavailable');
                                if (data.delivery) {
                                    if (data.delivery.entryId !== actual.id || data.delivery.sessionId !== registration.sessionManager.getSessionId())
                                        throw Error('Recorded native notice receipt identity mismatch; retain original evidence');
                                    this.noticeQueued.delete(row.id);
                                    this.noticeQueuedBytes.delete(row.id);
                                    continue;
                                }
                                let checkpoint;
                                try {
                                    checkpoint = await nativeCheckpoint(registration.sessionManager.getSessionFile()!);
                                }
                                catch (error) {
                                    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                                        deferred = true;
                                        continue;
                                    }
                                    throw error;
                                }
                                if (!this.matches(registration.identity))
                                    break;
                                const current = this.store.one('SELECT data FROM conversation_notifications WHERE id=?', row.id);
                                const fresh = JSON.parse(current.data);
                                this.store.run('UPDATE conversation_notifications SET data=? WHERE id=?', JSON.stringify({ ...fresh, delivery: { sessionId: registration.sessionManager.getSessionId(), entryId: actual.id, checkpoint } }), row.id);
                                this.noticeQueued.delete(row.id);
                                this.noticeQueuedBytes.delete(row.id);
                                continue;
                            }
                            if (data.delivery)
                                throw Error('Recorded native notice entry unavailable; retain exact history before delivery');
                            if (this.noticeQueued.get(row.id) === key) {
                                deferred = true;
                                continue;
                            }
                            if ([...this.noticeQueued.values()].filter(value => value === key).length >= 64) {
                                deferred = true;
                                continue;
                            }
                            const { delivery: _delivery, ...notice } = data;
                            const content = JSON.stringify({ noticeId: row.id, ...notice });
                            const bytes = Buffer.byteLength(content);
                            const queuedBytes = [...this.noticeQueued].filter(([, value]) => value === key).reduce((sum, [id]) => sum + (this.noticeQueuedBytes.get(id) ?? 0), 0);
                            if (queuedBytes + bytes > 128 * 1024) {
                                deferred = true;
                                byteLimitHit = true;
                                continue;
                            }
                            total += bytes;
                            if (total > 128 * 1024) {
                                byteLimitHit = true;
                                advance = false;
                                break;
                            }
                            await registration.session.sendCustomMessage({ customType: 'gitjig.coordination-notice', content, display: true, details: { noticeId: row.id, eventKey: data.eventKey } }, { triggerTurn: false });
                            this.noticeQueued.set(row.id, key);
                            this.noticeQueuedBytes.set(row.id, bytes);
                            deferred = true;
                        }
                        catch (error) {
                            advance = false;
                            throw error;
                        }
                        finally {
                            if (advance) {
                                cursor = row.noticeRow;
                                visited++;
                            }
                        }
                    }
                }
                finally {
                    // Keep a durable bounded round-robin position independently of ACK.
                    // A missing/mismatched receipt does not advance past the fault.
                    const status = { cursor, visited, morePending: deferred || rows.length > 64 || visited < Math.min(rows.length, 64), queuedCount: [...this.noticeQueued.values()].filter(value => value === key).length, byteLimitHit };
                    this.store.run("UPDATE conversation_state SET data=json_set(data,'$.noticeDeliveryCursor',?,'$.noticeDeliveryStatus',json(?)) WHERE conversation=?", cursor, JSON.stringify(status), target);
                }
            }
        });
        this.noticeTail = job;
        return job;
    }
    async drainNotices() { let tail; do {
        tail = this.noticeTail;
        await tail;
    } while (tail !== this.noticeTail); }
    resultsCommitted(cid: string) { this.noticeCommitted(cid); }
    subscribe(listener: (event: InteractionEvent) => void) {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }
    /** Presentation refresh after a native boundary consumed a durable input; no state change. */
    inputConsumed(identity: {
        conversationId: string;
        generation: number;
    }) {
        this.emit({ conversationId: identity.conversationId, generation: identity.generation, type: 'input-consumed' });
    }
    private emit(event: InteractionEvent) {
        for (const listener of this.listeners) {
            try {
                listener(event);
            }
            catch {
            }
        }
    }
    getHandle(id: string) {
        return this.live.get(id) ?? null;
    }
    private matches(identity: NativeIdentity) {
        const current = this.live.get(identity.conversationId);
        return current && current.identity.runId === identity.runId && current.identity.generation === identity.generation;
    }
    lifecycle: NativeLifecycle = { ready: registration => {
            this.assertOpen();
            const { identity } = registration;
            assertConversationExecutable(this.store, identity.conversationId);
            this.ensure(identity.conversationId);
            if (this.live.has(identity.conversationId))
                throw new Error('Conversation already has an admitted native handle');
            this.live.set(identity.conversationId, registration);
            this.initialObserved.delete(identity.conversationId);
            this.nativeUnsub.set(identity.conversationId, registration.session.subscribe(event => {
                if (event.type === 'message_end' && event.message.role === 'user')
                    this.nativeBoundary(identity);
                if (event.type === 'message_end' || event.type === 'turn_end')
                    void this.deliverNotices(identity.conversationId).catch(() => { });
            }));
            this.store.run('UPDATE conversations SET generation=?,history=?,state=? WHERE id=?', identity.generation, registration.sessionManager.getSessionFile() ?? null, 'RUNNING', identity.conversationId);
            this.store.run('UPDATE conversation_state SET native_id=?,work=?,resource=? WHERE conversation=?', registration.sessionManager.getSessionId(), identity.workId, 'RUNNING', identity.conversationId);
            this.emit({ conversationId: identity.conversationId, generation: identity.generation, type: 'native-ready' });
        }, settling: identity => {
            if (!this.matches(identity))
                return;
            const attempt = this.routing.get(identity.conversationId);
            if (attempt)
                attempt.settling = true;
            else
                this.clearPending(identity);
            this.store.run('UPDATE conversation_state SET resource=? WHERE conversation=?', nativeInputRecoveryRequired(this.store, identity.conversationId) ? 'UNKNOWN' : 'SETTLING', identity.conversationId);
            this.emit({ conversationId: identity.conversationId, generation: identity.generation, type: 'native-settling' });
        }, released: identity => {
            if (!this.matches(identity))
                return;
            if (this.routing.has(identity.conversationId)) {
                this.store.run('UPDATE conversation_state SET resource=? WHERE conversation=?', 'UNKNOWN', identity.conversationId);
                throw new Error('Native input producer still active; join it before releasing the original registration');
            }
            this.nativeUnsub.get(identity.conversationId)?.();
            this.nativeUnsub.delete(identity.conversationId);
            this.initialObserved.delete(identity.conversationId);
            this.live.delete(identity.conversationId);
            const noticeKey = identity.runId + ':' + identity.generation;
            for (const [id, key] of this.noticeQueued)
                if (key === noticeKey) {
                    this.noticeQueued.delete(id);
                    this.noticeQueuedBytes.delete(id);
                }
            this.store.run('UPDATE conversation_state SET resource=? WHERE conversation=?', nativeInputRecoveryRequired(this.store, identity.conversationId) ? 'UNKNOWN' : 'SETTLING', identity.conversationId);
            this.emit({ conversationId: identity.conversationId, generation: identity.generation, type: 'native-released' });
        } };
}
