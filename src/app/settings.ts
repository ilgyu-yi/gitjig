import { directory, readObject, writeObject, encodeObject } from './storage.js';
export { directory, readObject, writeObject, InvalidConfigurationJsonError } from './storage.js';
import { join } from 'node:path';
import { SettingsManager } from '@earendil-works/pi-coding-agent';
import type { Controller } from '../controller/controller.js';
export { resolveApplicationHome } from './home.js';
type JsonObject = Record<string, unknown>;
type Scope = 'global' | 'project';
export interface SettingsDiagnostic {
    scope: Scope;
    path: string;
    field?: string;
    reason: string;
}
export interface ApplicationSettingsView {
    home: string;
    directory: string;
    projectApproved: boolean;
    global: JsonObject;
    project: JsonObject;
    effective: JsonObject;
    sources: Record<string, string>;
    supportedPreferences: string[];
    diagnostics: SettingsDiagnostic[];
}
const object = (value: unknown): value is JsonObject => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 1024 && !/[\u0000-\u001f\u007f]/u.test(value);
const boolean = (value: unknown) => typeof value === 'boolean';
const oneOf = (...values: unknown[]) => (value: unknown) => values.includes(value);
const integer = (min: number, max: number) => (value: unknown) => Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max;
const thinking = oneOf('off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max');
const modelReference = (key: string) => text(key) && key.indexOf('/') > 0 && key.indexOf('/') < key.length - 1;
// Preferences supported by application composition are admitted to Pi's manager.
// Execution/delegation, resource paths and credential helpers are never preferences.
const fields: Record<string, (value: unknown) => boolean> = {
    defaultProvider: text, defaultModel: text, defaultThinkingLevel: thinking,
    modelThinkingLevels: value => object(value) && Object.entries(value).every(([key, level]) => modelReference(key) && thinking(level)),
    enabledModels: value => Array.isArray(value) && value.length <= 500 && value.every(text),
    theme: oneOf('dark', 'light', 'system'), hideThinkingBlock: boolean,
    steeringMode: oneOf('all', 'one-at-a-time'), followUpMode: oneOf('all', 'one-at-a-time'),
    autocompleteMaxVisible: integer(3, 20), editorPaddingX: integer(0, 3),
    fullscreenCopyOnSelect: boolean, fullscreenScrollbar: oneOf('auto', 'always', 'hidden'),
    fullscreenWheelScrollLines: value => value === 'auto' || integer(1, 100)(value),
};
/** Public Pi settings semantics, with gitjig storage and existing controller ownership. */
export class ApplicationSettings {
    readonly directory: string;
    private diagnostics: SettingsDiagnostic[] = [];
    private constructor(private readonly controller: Controller) {
        this.directory = join(controller.applicationHome(), 'config');
        directory(this.directory, true, true);
    }
    static open(controller: Controller): ApplicationSettings { return new ApplicationSettings(controller); }
    private assertOwner = () => { this.controller.applicationHome(); directory(this.directory, true); };
    private project(id: string): string {
        this.assertOwner();
        const project = this.controller.listProjects().find(project => project.id === id);
        if (!project)
            throw new Error('Select a registered gitjig project');
        directory(project.sourceRoot, false);
        return project.sourceRoot;
    }
    approveProject(id: string): void {
        const root = this.project(id), file = join(this.directory, 'project-approvals.json');
        const approvals = readObject(file, true);
        approvals[id] = root;
        writeObject(file, approvals, this.assertOwner);
    }
    private approved(id: string, root: string): boolean {
        return readObject(join(this.directory, 'project-approvals.json'), true)[id] === root;
    }
    private select(raw: JsonObject, scope: Scope, file: string): JsonObject {
        const result: JsonObject = {};
        for (const [key, value] of Object.entries(raw)) {
            if (key === '$schema')
                continue;
            if (!Object.hasOwn(fields, key))
                this.diagnostics.push({ scope, path: file, field: key, reason: 'Unsupported preference; not applied' });
            else if (!fields[key]!(value))
                this.diagnostics.push({ scope, path: file, field: key, reason: 'Invalid preference; repair this field' });
            else
                result[key] = value;
        }
        return result;
    }
    manager(projectId?: string, assertCurrent?: () => void): SettingsManager {
        this.assertOwner();
        const assertWrite = () => { this.assertOwner(); assertCurrent?.(); };
        const root = projectId === undefined ? undefined : this.project(projectId);
        const trusted = root !== undefined && this.approved(projectId!, root);
        return SettingsManager.fromStorage({ withLock: (scope, update) => {
                this.assertOwner();
                if (scope === 'project' && !trusted) {
                    if (update(undefined) !== undefined)
                        throw new Error('Approve gitjig project preferences before writing');
                    return;
                }
                if (root !== undefined)
                    this.project(projectId!);
                const folder = scope === 'global' ? this.directory : join(root!, '.gitjig');
                let exists = true;
                try {
                    directory(folder, scope === 'global');
                }
                catch (error) {
                    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
                        exists = false;
                    else
                        throw error;
                }
                const file = join(folder, 'settings.json'), raw = exists ? readObject(file, scope === 'global') : {};
                const selected = this.select(raw, scope, file);
                const next = update(Object.keys(selected).length ? JSON.stringify(selected) : undefined);
                if (next === undefined)
                    return;
                const parsed: unknown = JSON.parse(next);
                if (!object(parsed))
                    throw new Error('Invalid preference update');
                // Reject unsupported writes. Keep unknown on-disk fields for explicit repair.
                if (Object.entries(parsed).some(([key, value]) => !Object.hasOwn(fields, key) || !fields[key]!(value)))
                    throw new Error('Unsupported or invalid preference update');
                if (!exists)
                    directory(folder, scope === 'global', true);
                const unapplied = Object.fromEntries(Object.entries(raw).filter(([key, value]) => !Object.hasOwn(fields, key) || !fields[key]!(value)));
                // Pi returns the complete admitted state. Omission removes a valid
                // preference; only fields withheld from Pi survive independently.
                writeObject(file, { ...unapplied, ...parsed }, assertWrite);
            } }, { projectTrusted: trusted });
    }
    inspect(projectId?: string): ApplicationSettingsView {
        this.diagnostics = [];
        const manager = this.manager(projectId);
        const global = manager.getGlobalSettings(), project = manager.getProjectSettings(), effective = manager.getSettings();
        const sources = Object.fromEntries(Object.keys(effective).map(key => [key, Object.hasOwn(project, key) ? 'project' : 'application']));
        return { home: this.controller.applicationHome(), directory: this.directory,
            projectApproved: manager.isProjectTrusted(), global: { ...global }, project: { ...project }, effective: { ...effective }, sources,
            supportedPreferences: Object.keys(fields),
            diagnostics: [...this.diagnostics, ...manager.drainErrors().map(error => ({ scope: error.scope, path: error.path ?? this.directory, reason: 'Settings unavailable; repair the configured file' }))] };
    }
    /** Bind a form to exact owned preference bytes and approved project source. */
    prepareEdit(projectId?: string) {
        const take = () => {
            this.assertOwner();
            const root = projectId === undefined ? undefined : this.project(projectId);
            const bytes = (file: string, privateMode: boolean) => { let value = Buffer.alloc(0); readObject(file, privateMode, raw => { value = Buffer.from(raw); }); return value; };
            const global = bytes(join(this.directory, 'settings.json'), true), approvals = bytes(join(this.directory, 'project-approvals.json'), true);
            const trusted = root !== undefined && this.approved(projectId!, root);
            let project = Buffer.alloc(0), folderPresent = false;
            if (trusted) {
                try {
                    directory(join(root!, '.gitjig'), false);
                    folderPresent = true;
                }
                catch (error) {
                    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
                        throw error;
                }
                if (folderPresent)
                    project = bytes(join(root!, '.gitjig/settings.json'), false);
            }
            return { root, trusted, folderPresent, global, approvals, project };
        };
        const before = take(), assertCurrent = () => {
            const now = take();
            if (now.root !== before.root || now.trusted !== before.trusted || now.folderPresent !== before.folderPresent || !now.global.equals(before.global) || !now.approvals.equals(before.approvals) || !now.project.equals(before.project))
                throw Error('Preferences changed while editing; reopen the setting before saving');
        };
        const view = this.inspect(projectId);
        assertCurrent();
        return { view, assertCurrent };
    }
    async flush(manager: SettingsManager): Promise<void> {
        this.assertOwner();
        await manager.flush();
        this.assertOwner();
        if (manager.drainErrors().length)
            throw new Error('gitjig settings could not be saved; inspect and repair settings');
    }
    async setPreference(key: string, value: unknown, assertCurrent?: () => void): Promise<ApplicationSettingsView> {
        this.assertOwner();
        if (!Object.hasOwn(fields, key) || !fields[key]!(value))
            throw new Error('Unsupported preference or invalid value; inspect supported gitjig settings');
        const file = join(this.directory, 'settings.json'), raw = readObject(file, true);
        const candidate = { ...raw, [key]: value };
        if (key === 'modelThinkingLevels' && Object.keys(value as JsonObject).length === 0)
            delete candidate[key];
        // Account for existing/unapplied fields and actual UTF-8 formatting before
        // even beginning a multi-set operation. Refusal preserves the old file.
        encodeObject(candidate);
        const admitted = this.select(raw, 'global', file);
        // Original Pi setters compute semantics; stage all changes in memory so
        // a complete-map command has exactly one persistent commit.
        const manager = SettingsManager.inMemory(admitted);
        const setters: Record<string, keyof SettingsManager> = {
            defaultProvider: 'setDefaultProvider', defaultModel: 'setDefaultModel', defaultThinkingLevel: 'setDefaultThinkingLevel',
            enabledModels: 'setEnabledModels', theme: 'setTheme', hideThinkingBlock: 'setHideThinkingBlock',
            steeringMode: 'setSteeringMode', followUpMode: 'setFollowUpMode', autocompleteMaxVisible: 'setAutocompleteMaxVisible',
            editorPaddingX: 'setEditorPaddingX', fullscreenCopyOnSelect: 'setFullscreenCopyOnSelect',
            fullscreenScrollbar: 'setFullscreenScrollbar', fullscreenWheelScrollLines: 'setFullscreenWheelScrollLines',
        };
        if (key === 'modelThinkingLevels') {
            for (const existing of Object.keys(manager.getAllModelThinkingLevels())) {
                const slash = existing.indexOf('/');
                manager.removeModelThinkingLevel(existing.slice(0, slash), existing.slice(slash + 1));
            }
            for (const [model, level] of Object.entries(value as JsonObject)) {
                const slash = model.indexOf('/');
                if (slash <= 0 || slash === model.length - 1)
                    throw new Error('Per-model thinking requires provider/model keys');
                manager.setModelThinkingLevel(model.slice(0, slash), model.slice(slash + 1), level as Parameters<SettingsManager['setModelThinkingLevel']>[2]);
            }
        }
        else {
            const setter = manager[setters[key]!];
            if (typeof setter !== 'function')
                throw new Error('Pinned Pi preference setter is unavailable');
            Reflect.apply(setter, manager, [value]);
        }
        await this.flush(manager);
        const unapplied = Object.fromEntries(Object.entries(raw).filter(([name, item]) => name !== key && (!Object.hasOwn(fields, name) || !fields[name]!(item))));
        writeObject(file, { ...unapplied, ...manager.getGlobalSettings() }, () => { this.assertOwner(); assertCurrent?.(); });
        return this.inspect();
    }
}
