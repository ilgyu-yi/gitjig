import { validateLocalConventions, type LocalConventions } from '../app/local-conventions.js';
interface Forms {
    choose(title: string, labels: string[]): Promise<string | undefined>;
    input(title: string, value: string): Promise<string | undefined>;
    guard(): void;
    notice(text: string): void;
}
const fields = [['protectedBranches', 'Protected branch names'], ['branchPrefixes', 'Allowed branch prefixes'], ['commitTypes', 'Allowed commit types'], ['subjectMaxLength', 'Maximum subject code points'], ['requireBody', 'Require message body']] as const;
/** Pure staged values. Only the caller's explicit Save writes revision-bound configuration. */
export async function editLocalConventions(forms: Forms, initial: LocalConventions, revision: number) {
    const staged = structuredClone(initial);
    while (true) {
        forms.guard();
        const labels = fields.map(([key, label]) => label + ' · ' + JSON.stringify(staged[key])), choice = await forms.choose('Local conventions · staged only · revision ' + revision, [...labels, 'Save staged conventions', 'Cancel editing']);
        forms.guard();
        if (!choice || choice === 'Cancel editing')
            return;
        if (choice === 'Save staged conventions')
            return validateLocalConventions(staged);
        const entry = fields[labels.indexOf(choice)];
        if (!entry)
            throw Error('Local convention selection changed');
        const [key, label] = entry;
        if (key === 'requireBody') {
            const selected = await forms.choose(label, ['true', 'false', 'Keep current']);
            forms.guard();
            if (selected === 'true' || selected === 'false')
                staged[key] = selected === 'true';
            else if (selected && selected !== 'Keep current')
                throw Error('Unknown boolean choice');
            continue;
        }
        if (key === 'subjectMaxLength') {
            const value = await forms.input(label + ' · whole number 1..256', String(staged[key]));
            forms.guard();
            if (value === undefined)
                continue;
            if (!/^[1-9][0-9]{0,2}$/u.test(value) || Number(value) > 256) {
                forms.notice('Use a whole number from 1 to 256. Staged values are retained.');
                continue;
            }
            staged[key] = Number(value);
            continue;
        }
        const list = [...staged[key]];
        while (true) {
            const rows = list.map((value, index) => 'Remove ' + index + ' · ' + value), picked = await forms.choose(label + ' · exact literals · empty means no restriction', [...rows, 'Add literal', 'Use staged list', 'Cancel list']);
            forms.guard();
            if (!picked || picked === 'Cancel list')
                break;
            if (picked === 'Use staged list') {
                staged[key] = list;
                break;
            }
            if (picked === 'Add literal') {
                const value = await forms.input(label + ' · one literal · no JSON or wildcards', '');
                forms.guard();
                if (value === undefined)
                    continue;
                try {
                    validateLocalConventions({ ...staged, [key]: [...list, value] });
                    list.push(value);
                }
                catch (error) {
                    forms.notice((error instanceof Error ? error.message : 'Invalid literal') + '. Staged list is retained.');
                }
            }
            else {
                const index = rows.indexOf(picked);
                if (index < 0)
                    throw Error('Local list selection changed');
                list.splice(index, 1);
            }
        }
    }
}
