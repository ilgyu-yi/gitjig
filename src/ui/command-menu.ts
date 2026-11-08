import { uiText, type UiLocale } from './i18n.js';
import { matchesCommandLetter, matchesHostKey } from './command-input.js';
import { chrome } from './chrome.js';
import { getSelectListTheme } from '@earendil-works/pi-coding-agent';
import { Container, SelectList, Text, matchesKey, getKeybindings } from '@earendil-works/pi-tui';
import { commandKeyLabel, defaultCommandKey, type CommandKey } from './command-key.js';
export const conversationCommands = [
    ['c', 'Conversations: search the hierarchy'],
    ['j', 'Project: select or register'],
    ['p', 'Go to parent'],
    ['d', 'Choose a child'],
    ['s', 'Split: choose a conversation / close split'],
    ['w', 'Focus the other pane'],
    ['n', 'New conversation'],
    ['r', 'Task result: changes, checks and saved output'],
    ['h', 'History branches (files unchanged)'],
    ['m', 'Summarize this conversation'],
    ['l', 'Conversation lifecycle'],
    ['e', 'Error details and recovery'],
    ['t', 'Setup and next actions'],
    ['q', 'Leave Gitjig'],
] as const;
export type ConversationCommand = typeof conversationCommands[number][0] | '/';
/** Single-key commands are accepted only inside this explicit modal menu. */
export class CommandMenu extends Container {
    private readonly hint: Text;
    private readonly list: SelectList;
    constructor(private readonly choose: (key: ConversationCommand) => void, private readonly cancel: () => void, private readonly commandKey: CommandKey = defaultCommandKey, private readonly locale: UiLocale = 'en') {
        super();
        const bindings = getKeybindings();
        this.hint = new Text(chrome('secondary', uiText(locale, 'command.hint', { up: bindings.getKeys('tui.select.up').join('/'), down: bindings.getKeys('tui.select.down').join('/'), confirm: bindings.getKeys('tui.select.confirm').join('/'), key: commandKeyLabel(commandKey) })), 0, 0);
        this.addChild(new Text(chrome('active', uiText(locale, 'command.title', { key: commandKeyLabel(commandKey) })), 0, 0));
        this.list = new SelectList(conversationCommands.map(([key]) => ({ value: key, label: `${key} ${uiText(locale, `command.${key}`)}` })), 4, getSelectListTheme());
        this.list.onSelect = item => choose(item.value as ConversationCommand);
        this.list.onCancel = cancel;
        this.addChild(this.list);
        this.addChild(this.hint);
    }
    handleInput(data: string): void {
        if (matchesHostKey(data, this.commandKey) || matchesKey(data, 'escape')) {
            this.cancel();
            return;
        }
        if (data === '/') {
            this.choose('/');
            return;
        }
        const command = conversationCommands.find(([key]) => matchesCommandLetter(data, key));
        if (command) {
            this.choose(command[0]);
            return;
        }
        if (data === '?') {
            this.hint.setText(chrome('secondary', uiText(this.locale, 'command.help', { key: commandKeyLabel(this.commandKey) })));
            return;
        }
        const bindings = getKeybindings();
        if (bindings.matches(data, 'tui.select.pageUp') || bindings.matches(data, 'tui.select.pageDown')) {
            const selected = this.list.getSelectedItem();
            if (selected)
                this.list.setSelectedIndex(conversationCommands.findIndex(([key]) => key === selected.value) + (bindings.matches(data, 'tui.select.pageUp') ? -4 : 4));
            return;
        }
        if ((['tui.select.up', 'tui.select.down', 'tui.select.confirm', 'tui.select.cancel'] as const).some(key => bindings.matches(data, key))) {
            this.list.handleInput(data);
            return;
        }
        this.hint.setText(chrome('attention', uiText(this.locale, 'command.unknown')));
    }
}
