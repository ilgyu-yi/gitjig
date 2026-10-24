import { CustomEditor, getSelectListTheme } from '@earendil-works/pi-coding-agent';
import { KeybindingsManager, TUI_KEYBINDINGS, setKeybindings, getKeybindings, type KeybindingDefinitions, type KeybindingsConfig, type TUI, type SlashCommand } from '@earendil-works/pi-tui';
export const nativeHostDefinitions: KeybindingDefinitions = { ...TUI_KEYBINDINGS,
    'app.interrupt': { defaultKeys: 'escape', description: 'Interrupt this response (fixed)' },
    'app.exit': { defaultKeys: 'ctrl+d', description: 'Leave with an empty editor (fixed)' },
    'app.tools.expand': { defaultKeys: 'ctrl+o', description: 'Expand tool results (fixed)' },
    'app.clipboard.pasteImage': { defaultKeys: [], description: 'Image input unavailable in this profile' },
};
/** Public facade for CustomEditor's type-only, nominal SDK keybinding class. */
class NativeHostBindings extends KeybindingsManager {
    constructor(config: KeybindingsConfig) { super(nativeHostDefinitions, config); }
    reload(): void { /* The host validates and commits app-owned reloads atomically. */ }
    getEffectiveConfig() { return this.getResolvedBindings(); }
}
export function createNativeEditorFactory(config: KeybindingsConfig = {}) {
    const publicBindings = new NativeHostBindings(config);
    setKeybindings(publicBindings);
    const bindings = publicBindings as unknown as ConstructorParameters<typeof CustomEditor>[2];
    return Object.assign((tui: TUI): CustomEditor => new CustomEditor(tui, { borderColor: text => text, selectList: getSelectListTheme() }, bindings), { bindings });
}
/** Let original completion choose a bare slash command, then let the host admit it.
 * Native submit stays disabled: it trims/clears before our draft/admission boundary. */
export function prepareHostEditorSubmit(editor: CustomEditor, data: string, commands: readonly Pick<SlashCommand, 'name'>[]): boolean {
    if (!editor.isShowingAutocomplete())
        return true;
    const text = editor.getExpandedText(), cursor = editor.getCursor();
    const command = !text.includes('\n') && /^\/[^\s/]*$/u.test(text.trimStart()) && cursor.line === 0 && cursor.col === text.length;
    if (!editor.disableSubmit)
        throw new Error('Host editor submission requires preserved native draft');
    editor.handleInput(data);
    return command && !editor.isShowingAutocomplete() && commands.some(entry => '/' + entry.name === editor.getExpandedText().trim());
}

/** Reflect the live public binding, including application reloads. */
export function submitKeyLabel(): string {
    return getKeybindings().getKeys('tui.input.submit').map(key => key === 'enter' ? 'Enter' : key).join('/');
}
