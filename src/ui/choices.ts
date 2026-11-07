export interface UiChoice<Value extends string = string> {
    readonly value: Value;
    readonly label: string;
}
export interface UiChoiceHost<Value extends string = string> {
    chooseItems?(title: string, items: readonly UiChoice<Value>[]): Promise<string | undefined>;
    choose(title: string, labels: string[]): Promise<string | undefined>;
}
/** Adapt legacy display-label callbacks without letting them invent or confuse action values. */
export async function chooseUiItem<Value extends string>(host: UiChoiceHost<Value>, title: string, items: readonly UiChoice<Value>[]): Promise<Value | undefined> {
    const choices = items.map(item => ({ ...item }));
    const values = choices.map(item => item.value);
    if (new Set(values).size !== choices.length)
        throw Error('Duplicate UI choice value');
    if (host.chooseItems) {
        const value = await host.chooseItems(title, choices);
        if (value === undefined)
            return undefined;
        const selected = values.find(candidate => candidate === value);
        if (selected === undefined)
            throw Error('Unknown UI choice value');
        return selected;
    }
    const label = await host.choose(title, choices.map(item => item.label));
    if (label === undefined)
        return undefined;
    const matches = choices.filter(item => item.label === label);
    if (!matches.length)
        throw Error('Unknown UI choice label');
    if (matches.length !== 1)
        throw Error('Ambiguous UI choice label; use stable choice values');
    return matches[0]!.value;
}
