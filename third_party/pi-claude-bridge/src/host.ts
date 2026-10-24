import type { Query, CanUseTool } from '@anthropic-ai/claude-agent-sdk';
import type { PromptStream } from './prompt-stream.js';
import type { QueryContext } from './query-state.js';
import type { Tool } from '@earendil-works/pi-ai';
import { MCP_SERVER_NAME, MCP_TOOL_PREFIX } from './skills.js';
import type { McpResult } from './extract-tool-results.js';
/** Declared host098 patch. Public full-extension host boundary, not model data. */
import type { SDKMessage, Settings, SettingSource, SpawnedProcess, SpawnOptions } from '@anthropic-ai/claude-agent-sdk';
export interface NativeSettlement {
  cleanup: 'confirmed' | 'failed' | 'unknown';
  exited: boolean;
  pipesClosed: boolean;
  scopeJoined: boolean;
}
export interface OwnedNativeLaunch {
  process: SpawnedProcess;
  settled: Promise<NativeSettlement>;
}
export interface BridgeHostOptions {
  cwd: string;
  pathToClaudeCodeExecutable: string;
  env: Readonly<Record<string, string | undefined>>;
  settingSources: readonly SettingSource[];
  settings: Settings;
  assertNativeLaunch?: () => void;
  spawnNative(input: { ownerSessionId: string; purpose: 'provider' | 'summary'; options: SpawnOptions }): OwnedNativeLaunch;
  observeNative(input: { ownerSessionId: string; purpose: 'provider' | 'summary'; message: SDKMessage }): void;
}
export interface BridgeCloseResult { cleanup: 'confirmed' | 'unknown'; queryCount: number }
class SessionOwner {
  closed = false;
  lastCloseCleanup?: 'confirmed' | 'unknown';
  queries = new Set<HostedQuery>();
  constructor(readonly id: string, readonly host: BridgeHost) {}
  query(tools: readonly Tool[] = [], purpose: 'provider' | 'summary' = 'provider'): HostedQuery {
    if (this.closed || this.host.closed) throw new Error('BRIDGE_HOST_OWNER_CLOSED');
    const query = new HostedQuery(this, tools, purpose); this.queries.add(query); return query;
  }
  async close(): Promise<BridgeCloseResult> {
    this.closed = true;
    const queries = [...this.queries];
    const result = await Promise.allSettled(queries.map(query => query.close()));
    this.lastCloseCleanup = result.every(item => item.status === 'fulfilled') ? 'confirmed' : 'unknown';
    return { cleanup: this.lastCloseCleanup, queryCount: queries.length };
  }
}
export class HostedQuery {
  private admitted = false;
  private admissionResolve!: () => void;
  private admissionReject!: (reason: Error) => void;
  readonly admission: Promise<void>;
  private launches: OwnedNativeLaunch[] = [];
  private birthAttempts = 0;
  private preflightRejected = false;
  private consumer?: Promise<unknown>;
  private cancel?: () => void;
  private closing = false;
  private finishPromise?: Promise<void>;
  private confirmed = false;
  readonly expectedTools: readonly Readonly<{ name: string; description: string; parameters: unknown }>[];
  constructor(private readonly owner: SessionOwner, tools: readonly Tool[] = [], readonly purpose: 'provider' | 'summary' = 'provider') {
    const captured = structuredClone(tools.map(tool => ({ name: tool.name, description: tool.description, parameters: tool.parameters })));
    if (new Set(captured.map(tool => tool.name)).size !== captured.length || captured.some(tool => typeof tool.name !== 'string' || !tool.name || typeof tool.description !== 'string' || !tool.parameters || typeof tool.parameters !== 'object')) throw new Error('BRIDGE_HOST_TOOL_PROFILE_UNAVAILABLE');
    const freeze = (value: any): any => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
    this.expectedTools = freeze(captured);
    this.admission = new Promise((resolve, reject) => { this.admissionResolve = resolve; this.admissionReject = reject; });
    void this.admission.catch(() => {});
  }
  assertActive(sessionId: string | null | undefined) {
    if (!this.admitted || this.closing || this.finishPromise || this.owner.closed || this.owner.host.closed || this.owner.id !== sessionId || this.owner.host.sessions.get(this.owner.id) !== this.owner || !this.owner.queries.has(this)) throw new Error("BRIDGE_HOST_MCP_OWNER_INACTIVE");
  }
  options() {
    const config = this.owner.host.options;
    return {
      permissionMode: 'default' as const,
      canUseTool: (async (toolName, input, options) => {
        const deny = () => ({ behavior: 'deny' as const, message: 'BRIDGE_HOST_TOOL_PERMISSION_UNAVAILABLE', toolUseID: options?.toolUseID });
        try {
          await this.admission; this.assertActive(this.owner.id);
          if (!options || options.signal?.aborted || typeof options.toolUseID !== 'string' || !options.toolUseID ||
              options.matchedAskRule !== undefined || (options as typeof options & { requiresUserInteraction?: boolean }).requiresUserInteraction === true || options.agentID !== undefined ||
              !this.expectedTools.some(tool => toolName === `${MCP_TOOL_PREFIX}${tool.name}`) ||
              options.mcpServer !== undefined && (options.mcpServer?.source !== 'sdk' || options.mcpServer?.name !== MCP_SERVER_NAME)) return deny();
          // No persistent permission rule. This callback alone cannot execute:
          // exact native tools/call still must rendezvous with its proposal.
          return { behavior: 'allow', updatedInput: structuredClone(input), toolUseID: options.toolUseID };
        } catch { return deny(); }
      }) satisfies CanUseTool,
      cwd: config.cwd,
      pathToClaudeCodeExecutable: config.pathToClaudeCodeExecutable,
      env: { ...config.env, ENABLE_CLAUDEAI_MCP_SERVERS: '0', DISABLE_AUTO_COMPACT: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' },
      settingSources: [...config.settingSources],
      settings: structuredClone(config.settings),
      spawnClaudeCodeProcess: (options: SpawnOptions): SpawnedProcess => {
        if (this.closing || this.finishPromise || this.owner.closed || this.owner.host.closed) throw new Error('BRIDGE_HOST_SPAWN_CLOSED');
        try {
          const checked: unknown = config.assertNativeLaunch?.();
          if (checked !== undefined) {
            // An async assertion cannot authorize birth. Observe its eventual
            // rejection without treating it as a completed synchronous check.
            void Promise.resolve(checked).catch(() => {});
            throw new Error('BRIDGE_HOST_NATIVE_PREFLIGHT_MUST_BE_SYNCHRONOUS');
          }
        } catch (error) {
          this.closing = true;
          this.preflightRejected = true;
          this.admissionReject(error instanceof Error ? error : new Error(String(error)));
          throw error;
        }
        this.birthAttempts++;
        const launch = config.spawnNative({ ownerSessionId: this.owner.id, purpose: this.purpose, options });
        if (!launch?.process || !launch.settled || typeof launch.settled.then !== 'function') throw new Error('BRIDGE_HOST_NATIVE_OWNER_UNAVAILABLE');
        void launch.settled.catch(() => {});
        this.launches.push(launch); return launch.process;
      },
    };
  }
  observe(message: SDKMessage) {
    if (this.closing) throw new Error('BRIDGE_HOST_QUERY_CLOSED');
    if (message.type === 'system' && message.subtype === 'permission_denied' ||
        message.type === 'result' && Array.isArray(message.permission_denials) && message.permission_denials.length) {
      throw new Error('BRIDGE_HOST_NATIVE_TOOL_PERMISSION_DENIED');
    }
    if (message.type === 'system' && message.subtype === 'init') {
      const expectedNames = this.expectedTools.map(tool => `${MCP_TOOL_PREFIX}${tool.name}`).sort();
      const actualNames = Array.isArray(message.tools) ? [...message.tools].sort() : null;
      const expectedServers = this.expectedTools.length ? [{ name: MCP_SERVER_NAME, status: 'connected' }] : [];
      const actualServers = Array.isArray(message.mcp_servers) ? message.mcp_servers.map(server => ({ name: server.name, status: server.status })) : null;
      const plugins = message.plugins, policyPlugin = Array.isArray(plugins) && plugins.length === 1 ? plugins[0] : undefined;
      // The pinned native can require its bundled security policy. This is not
      // permission to load a user/project plugin or additional tool surface.
      const supportedPlugins = Array.isArray(plugins) && (plugins.length === 0 || policyPlugin &&
        typeof policyPlugin === 'object' && !Array.isArray(policyPlugin) &&
        policyPlugin.name === 'cc-plugin-sec-default' && policyPlugin.path === 'builtin');
      const mismatch = this.admitted ? 'duplicate-init' : JSON.stringify(actualNames) !== JSON.stringify(expectedNames) ? 'tools' :
        JSON.stringify(actualServers) !== JSON.stringify(expectedServers) ? 'MCP-servers' :
        !supportedPlugins ? 'plugins' : null;
      if (mismatch) {
        const failure = new Error('BRIDGE_HOST_NATIVE_PROFILE_MISMATCH: ' + mismatch);
        this.admissionReject(failure);
        throw failure;
      }
      this.owner.host.options.observeNative({ ownerSessionId: this.owner.id, purpose: this.purpose, message });
      this.admitted = true; this.admissionResolve();
    } else if (['assistant', 'stream_event', 'result'].includes(message.type) && !this.admitted) {
      throw new Error('BRIDGE_HOST_STARTUP_NOT_ADMITTED');
    } else {
      this.owner.host.options.observeNative({ ownerSessionId: this.owner.id, purpose: this.purpose, message });
    }
  }
  bindConsumer(consumer: Promise<unknown>, cancel: () => void) {
    this.consumer = consumer; this.cancel = cancel;
    void consumer.catch(() => {});
    if (this.closing) cancel();
  }
  finishNative(): Promise<void> {
    this.finishPromise ??= (async () => {
      this.admissionReject(new Error('BRIDGE_HOST_QUERY_FINISHED'));
      const results = await Promise.all(this.launches.map(launch => launch.settled));
      if (results.some(result => result.cleanup !== 'confirmed' || !result.exited || !result.pipesClosed || !result.scopeJoined)) throw new Error('BRIDGE_HOST_NATIVE_CLEANUP_UNKNOWN');
      if (this.birthAttempts !== this.launches.length) throw new Error('BRIDGE_HOST_NATIVE_CLEANUP_UNKNOWN');
      if (!this.launches.length && !this.preflightRejected) throw new Error('BRIDGE_HOST_NATIVE_LAUNCH_ABSENT');
      this.confirmed = true;
    })();
    return this.finishPromise;
  }
  async close() {
    this.closing = true;
    this.admissionReject(new Error('BRIDGE_HOST_OWNER_CLOSED'));
    this.cancel?.();
    if (this.consumer) await this.consumer.catch(() => {});
    await this.finishNative();
    this.owner.queries.delete(this);
  }
  release() { if (this.confirmed) this.owner.queries.delete(this); }
}
export class BridgeHost {
  readonly sessions = new Map<string, SessionOwner>();
  readonly options: BridgeHostOptions;
  private summaryScopes = new Map<string, { closed: boolean; signal: AbortSignal; admit: () => Promise<void>; pending: Set<Promise<HostedQuery>>; queries: Set<HostedQuery>; close?: () => Promise<void> }>();
  closed = false;
  openSummaryOperation(id: string, signal: AbortSignal, admit: () => Promise<void>) {
    const owner = this.sessions.get(id);
    if (!owner || owner.closed || this.closed || this.summaryScopes.has(id)) throw new Error('BRIDGE_HOST_SUMMARY_SCOPE_UNAVAILABLE');
    signal.throwIfAborted();
    const scope: {closed: boolean; signal: AbortSignal; admit: () => Promise<void>; pending: Set<Promise<HostedQuery>>; queries: Set<HostedQuery>; close?: () => Promise<void>} = { closed: false, signal, admit, pending: new Set<Promise<HostedQuery>>(), queries: new Set<HostedQuery>() };
    this.summaryScopes.set(id, scope);
    let closing: Promise<void> | undefined;
    const close = () => closing ??= (async () => {
      scope.closed = true;
      await Promise.allSettled([...scope.pending]);
      const results = await Promise.allSettled([...scope.queries].map(query => query.close()));
      if (this.summaryScopes.get(id) === scope) this.summaryScopes.delete(id);
      if (results.some(x => x.status === 'rejected')) throw new Error('BRIDGE_HOST_NATIVE_CLEANUP_UNKNOWN');
    })();
    scope.close = close; return {close};
  }
  summary(id: string | null | undefined, signal?: AbortSignal): Promise<{query: HostedQuery; signal: AbortSignal}> {
    const owner = id && this.sessions.get(id), scope = id && this.summaryScopes.get(id);
    if (!owner || owner.closed || this.closed || !scope || scope.closed) throw new Error('BRIDGE_HOST_SUMMARY_SCOPE_UNAVAILABLE');
    const combined = signal ? AbortSignal.any([scope.signal, signal]) : scope.signal;
    const task = (async () => {
      combined.throwIfAborted();
      await scope.admit();
      combined.throwIfAborted();
      if (scope.closed || owner.closed || this.closed || this.summaryScopes.get(id!) !== scope || this.sessions.get(id!) !== owner) throw new Error('BRIDGE_HOST_SUMMARY_SCOPE_UNAVAILABLE');
      const query = owner.query([], 'summary'); scope.queries.add(query); return query;
    })();
    scope.pending.add(task); void task.then(() => scope.pending.delete(task), () => scope.pending.delete(task));
    return task.then(query => ({query, signal: combined}));
  }
  constructor(options: BridgeHostOptions) {
    if (!options || !options.cwd?.startsWith('/') || typeof options.pathToClaudeCodeExecutable !== 'string' || !options.pathToClaudeCodeExecutable.startsWith('/') ||
        options.assertNativeLaunch !== undefined && typeof options.assertNativeLaunch !== 'function' ||
        typeof options.spawnNative !== 'function' || typeof options.observeNative !== 'function') throw new Error('BRIDGE_HOST_OPTIONS_UNAVAILABLE');
    const disabled = ['agents-md@builtin', 'bento-slides@bento', 'drop@drop', 'plugin-authoring@builtin'];
    const settings = options.settings;
    if (!Array.isArray(options.settingSources) || options.settingSources.length || !settings || settings.disableAllHooks !== true || settings.autoMemoryEnabled !== false || settings.syncClaudeAiSkills !== false || settings.syncClaudeAiPlugins !== false || Object.keys(settings.enabledPlugins ?? {}).length !== disabled.length || disabled.some(name => settings.enabledPlugins?.[name] !== false) || Object.keys(settings).some(name => !['disableAllHooks', 'autoMemoryEnabled', 'syncClaudeAiSkills', 'syncClaudeAiPlugins', 'enabledPlugins'].includes(name))) throw new Error('BRIDGE_HOST_POLICY_UNAVAILABLE');
    this.options = Object.freeze({ ...options, env: Object.freeze({ ...options.env }), settings: structuredClone(options.settings), settingSources: Object.freeze([...options.settingSources]) });
  }
  bind(id: string) {
    if (this.closed || typeof id !== 'string' || !id || id.length > 200) throw new Error('BRIDGE_HOST_SESSION_UNAVAILABLE');
    const previous = this.sessions.get(id);
    if (previous?.closed && (previous.lastCloseCleanup !== 'confirmed' || previous.queries.size)) throw new Error('BRIDGE_HOST_SESSION_CLEANUP_UNKNOWN');
    if (previous && !previous.closed && previous.queries.size) throw new Error('BRIDGE_HOST_SESSION_BUSY');
    if (!previous || previous.closed) this.sessions.set(id, new SessionOwner(id, this));
  }
  query(id: string | null | undefined, tools: readonly Tool[] = []) {
    const owner = id && this.sessions.get(id);
    if (!owner) throw new Error('BRIDGE_HOST_SESSION_UNREGISTERED');
    return owner.query(tools);
  }
  async closeSession(id: string): Promise<BridgeCloseResult> {
    const owner = this.sessions.get(id);
    if (!owner) return { cleanup: 'confirmed', queryCount: 0 };
    owner.closed = true;
    let summaryUnknown = false;
    try { await this.summaryScopes.get(id)?.close?.(); } catch { summaryUnknown = true; }
    const result = await owner.close();
    if (summaryUnknown) owner.lastCloseCleanup = 'unknown';
    return summaryUnknown ? { ...result, cleanup: 'unknown' as const } : result;
  }
  async close(): Promise<BridgeCloseResult> {
    this.closed = true;
    const results = await Promise.all([...this.sessions.keys()].map(id => this.closeSession(id)));
    return { cleanup: results.every(result => result.cleanup === 'confirmed') ? 'confirmed' : 'unknown', queryCount: results.reduce((n, result) => n + result.queryCount, 0) };
  }
}

/** Same fixed tools/call handler used by the original full bridge MCP builder. */
export function createMcpResultHandler(queryCtx: QueryContext, capturedHostQuery: HostedQuery | undefined, toolName: string, log: (...args: unknown[]) => void = () => {}) {
  return async (toolCallId: string, input: Record<string, unknown> = {}): Promise<McpResult> => {
    if (capturedHostQuery) {
      await capturedHostQuery.admission;
      capturedHostQuery.assertActive(queryCtx.piSessionId);
      if (queryCtx.hostQuery !== capturedHostQuery) throw new Error('BRIDGE_HOST_MCP_CONTEXT_REPLACED');
    }
    if (capturedHostQuery) {
      if (!capturedHostQuery.expectedTools.some(tool => tool.name === toolName) || queryCtx.pendingToolCalls.has(toolCallId) || queryCtx.pendingResults.has(toolCallId))
        throw queryCtx.failNativeTool(Error('BRIDGE_HOST_TOOL_INVOCATION_DUPLICATE'));
      const pending = new Promise<McpResult>(resolve => queryCtx.pendingToolCalls.set(toolCallId, { toolName, resolve }));
      try { queryCtx.reserveNativeTool(toolCallId, toolName, input); }
      catch (error) { queryCtx.pendingToolCalls.delete(toolCallId); throw error; }
      return pending;
    }
    // No await after the identity check and before the map lookup/reservation.
    if (queryCtx.pendingResults.has(toolCallId)) {
      const result = queryCtx.pendingResults.get(toolCallId)!;
      queryCtx.pendingResults.delete(toolCallId);
      log(`mcp handler: ${toolName} [${toolCallId}] → resolved from queue (${queryCtx.pendingResults.size} remaining)`);
      return result;
    }
    const pending = new Promise<McpResult>((resolve) => {
      queryCtx.pendingToolCalls.set(toolCallId, { toolName, resolve });
    });
    log(`mcp handler: ${toolName} [${toolCallId}] → waiting`);
    return pending;
  };
}

/** Close only captured native/prompt handles; never drain a replacement context. */
export function cancelCapturedQuery(queryCtx: QueryContext, capturedHostQuery: HostedQuery | undefined, promptStream: PromptStream, sdkQuery: Pick<Query, 'interrupt' | 'close'>) {
  promptStream.fail(new Error('Operation aborted'));
  if (!capturedHostQuery || queryCtx.hostQuery === capturedHostQuery) queryCtx.releasePendingToolCalls('Operation aborted');
  void sdkQuery.interrupt().catch(() => {});
  try { sdkQuery.close(); } catch {}
}
