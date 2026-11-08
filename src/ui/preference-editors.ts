interface EditorHost {
    choose(title: string, rows: string[]): Promise<string | undefined>;
    input(title: string, value: string): Promise<string | undefined>;
    assertCurrent(): void;
}
const levels = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
/** Stage exact ordered Pi strings; use the original resolver at the later save boundary. */
export async function editModelScope(host: EditorHost, initial: readonly string[], catalogue: readonly string[], override: boolean): Promise<string[] | undefined> {
    const staged = [...initial];
    while (true) {
        const labels = staged.map((pattern, index) => `Remove ${index + 1} · ${pattern}`), add = 'Add catalogue model', pattern = 'Add Pi pattern', save = 'Save application cycling pool';
        const selected = await host.choose(`Application model scope · ${staged.length ? staged.length + ' ordered patterns' : 'empty pool; no cycling models'}${override ? ' · approved project override remains effective' : ''}`, [...labels, add, pattern, save, 'Cancel']);
        host.assertCurrent();
        if (!selected || selected === 'Cancel')
            return;
        if (selected === save)
            return staged;
        const index = labels.indexOf(selected);
        if (index >= 0) {
            staged.splice(index, 1);
            continue;
        }
        let value: string | undefined;
        if (selected === add) {
            value = await host.choose('Add a model to the cycling pool · catalogue is not availability', [...catalogue, 'Cancel']);
            host.assertCurrent();
            if (value === 'Cancel')
                value = undefined;
            if (value && !catalogue.includes(value))
                throw Error('Choose an actual catalogue model');
        }
        else if (selected === pattern) {
            value = await host.input('Pi model pattern · provider/model[:thinking] or wildcard', '');
            host.assertCurrent();
        }
        else
            throw Error('Unknown scope edit');
        if (value === undefined)
            continue;
        const invalid = !value || value.length > 1024 || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(value);
        if (invalid || staged.length >= 500) {
            await host.choose(invalid ? 'Pattern not added · enter a nonempty single-line Pi pattern of at most 1024 characters' : 'Pattern not added · model scope is limited to 500 patterns; remove one first', ['Back to staged edits']);
            host.assertCurrent();
            continue;
        }
        staged.push(value);
    }
}
export async function editModelThinking(host: EditorHost, initial: Readonly<Record<string, string>>, catalogue: readonly string[], override: boolean): Promise<Record<string, string> | undefined> {
    const staged = { ...initial };
    while (true) {
        const entries = Object.entries(staged), labels = entries.map(([model, level]) => `${model} · requested ${level}`);
        const selected = await host.choose(`Application per-model thinking${override ? ' · approved project override remains effective' : ''}`, [...labels, 'Add catalogue model', 'Save application thinking preferences', 'Cancel']);
        host.assertCurrent();
        if (!selected || selected === 'Cancel')
            return;
        if (selected === 'Save application thinking preferences')
            return staged;
        let model = entries[labels.indexOf(selected)]?.[0];
        if (selected === 'Add catalogue model') {
            model = await host.choose('Per-model thinking · choose catalogue reference', [...catalogue, 'Cancel']);
            host.assertCurrent();
            if (model === 'Cancel')
                model = undefined;
            if (model && !catalogue.includes(model))
                throw Error('Choose an actual catalogue model');
        }
        if (!model) {
            if (selected === 'Add catalogue model')
                continue;
            throw Error('Unknown thinking preference');
        }
        const level = await host.choose(`${model} · requested thinking; Pi clamps at execution`, ['Reset application override', ...levels, 'Cancel']);
        host.assertCurrent();
        if (!level || level === 'Cancel')
            continue;
        if (level === 'Reset application override')
            delete staged[model];
        else if (levels.includes(level))
            staged[model] = level;
        else
            throw Error('Choose a supported requested thinking level');
    }
}
