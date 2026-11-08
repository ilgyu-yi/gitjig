import { uiText, type UiLocale } from './i18n.js';
import { matchesCommandLetter, matchesHostKey } from './command-input.js';
import { chrome } from './chrome.js';
import { getSelectListTheme } from '@earendil-works/pi-coding-agent';
import { Container, SelectList, Text, matchesKey, getKeybindings, isKeyRelease, isKeyRepeat } from '@earendil-works/pi-tui';
import { commandDiscoveryKey, commandKeyLabel, commandMenuHelpKey, commandMenuLetters, defaultCommandKey, type CommandKey, type ConversationCommand } from './command-key.js';
/** Single-key commands are accepted only inside this explicit modal menu. */
export class CommandMenu extends Container {
    private readonly hint: Text;
    private readonly list: SelectList;
    constructor(private readonly choose: (key: ConversationCommand) => void, private readonly cancel: () => void, private readonly commandKey: CommandKey = defaultCommandKey, private readonly locale: UiLocale = 'en') {
        super();
        const bindings = getKeybindings();
        this.hint = new Text(chrome('secondary', uiText(locale, 'command.hint', { up: bindings.getKeys('tui.select.up').join('/'), down: bindings.getKeys('tui.select.down').join('/'), confirm: bindings.getKeys('tui.select.confirm').join('/'), key: commandKeyLabel(commandKey) })), 0, 0);
        this.addChild(new Text(chrome('active', uiText(locale, 'command.title', { key: commandKeyLabel(commandKey) })), 0, 0));
        this.list = new SelectList(commandMenuLetters.map(key => ({ value: key, label: `${key} ${uiText(locale, `command.${key}`)}` })), 4, getSelectListTheme());
        this.list.onSelect = item => choose(item.value as ConversationCommand);
        this.list.onCancel = cancel;
        this.addChild(this.list);
        this.addChild(this.hint);
    }
    handleInput(data: string): void {
        if (isKeyRelease(data)) return;
        const repeat = isKeyRepeat(data);
        if (!repeat) {
            if (matchesHostKey(data, this.commandKey) || matchesKey(data, 'escape')) {
                this.cancel();
                return;
            }
            if (matchesKey(data, commandDiscoveryKey)) {
                this.choose(commandDiscoveryKey);
                return;
            }
            const command = commandMenuLetters.find(key => matchesCommandLetter(data, key));
            if (command) {
                this.choose(command);
                return;
            }
            if (matchesKey(data, commandMenuHelpKey)) {
                this.hint.setText(chrome('secondary', uiText(this.locale, 'command.help', { key: commandKeyLabel(this.commandKey) })));
                return;
            }
        }
        const bindings = getKeybindings();
        if (bindings.matches(data, 'tui.select.pageUp') || bindings.matches(data, 'tui.select.pageDown')) {
            const selected = this.list.getSelectedItem();
            if (selected)
                this.list.setSelectedIndex(commandMenuLetters.findIndex(key => key === selected.value) + (bindings.matches(data, 'tui.select.pageUp') ? -4 : 4));
            return;
        }
        const selectionKeys = repeat ? ['tui.select.up', 'tui.select.down'] as const :
            ['tui.select.up', 'tui.select.down', 'tui.select.confirm', 'tui.select.cancel'] as const;
        if (selectionKeys.some(key => bindings.matches(data, key))) {
            this.list.handleInput(data);
            return;
        }
        if (!repeat)
            this.hint.setText(chrome('attention', uiText(this.locale, 'command.unknown')));
    }
}
