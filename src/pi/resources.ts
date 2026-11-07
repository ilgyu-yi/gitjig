import {createExtensionRuntime, createSyntheticSourceInfo, type Extension, type LoadExtensionsResult, type ResourceLoader} from '@earendil-works/pi-coding-agent';

/** Trusted declarations only. No extension initializer, file discovery or provider queue. */
export function inlineExtension(name: string, handlers: Extension['handlers']): Extension {
    const path = `<inline:gitjig-${name}>`;
    return {
        path, resolvedPath: path, sourceInfo: createSyntheticSourceInfo(path, {source: 'inline'}), handlers,
        tools: new Map(), messageRenderers: new Map(), entryRenderers: new Map(),
        commands: new Map(), flags: new Map(), shortcuts: new Map(),
    };
}

export function createOwnedResources(extensions: Extension[], systemPrompt: string): {
    resourceLoader: ResourceLoader;
    close(): void;
} {
    let closed = false;
    const create = (): LoadExtensionsResult => ({extensions, errors: [], runtime: createExtensionRuntime()});
    let loaded = create();
    const resourceLoader: ResourceLoader = {
        getExtensions: () => loaded,
        getSkills: () => ({skills: [], diagnostics: []}), getPrompts: () => ({prompts: [], diagnostics: []}),
        getThemes: () => ({themes: [], diagnostics: []}), getAgentsFiles: () => ({agentsFiles: []}),
        getSystemPrompt: () => systemPrompt, getSystemPromptSource: () => undefined,
        getAppendSystemPrompt: () => [], getAppendSystemPromptSources: () => [],
        extendResources() {throw new Error('Ambient resource extension is disabled in this profile');},
        async reload() {
            if (closed) throw new Error('Owned Pi resources are closed');
            loaded.runtime.invalidate();
            loaded = create();
        },
    };
    return {resourceLoader, close() {
        if (closed) return;
        closed = true;
        loaded.runtime.invalidate();
    }};
}
