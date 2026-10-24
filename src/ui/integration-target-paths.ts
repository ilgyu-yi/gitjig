interface Host {
    guard(): void;
    choose(title: string, rows: string[]): Promise<string | undefined>;
    input(title: string, value: string): Promise<string | undefined>;
    show(title: string, text: string): Promise<void>;
}
/** Literal inventories shared by local and hosted receiver forms. No filesystem expansion. */
export async function editIntegrationPaths(host: Host, initial: readonly string[], title: string): Promise<string[]> {
    let paths = [...initial];
    while (true) {
        host.guard();
        const labels = paths.map((p, index) => `Path ${index + 1} · ${JSON.stringify(p)}`), action = await host.choose(title + ' · staged literal paths', ['Add literal path', ...labels, 'Done']);
        host.guard();
        if (!action || action === 'Done')
            return paths;
        let index = -1;
        if (action !== 'Add literal path') {
            index = labels.indexOf(action);
            if (index < 0)
                throw Error('Unknown staged path');
            const choice = await host.choose('Selected literal path', ['Edit literal path', 'Remove literal path', 'Back']);
            host.guard();
            if (!choice || choice === 'Back')
                continue;
            if (choice === 'Remove literal path') {
                paths = paths.filter((_, i) => i !== index);
                continue;
            }
            if (choice !== 'Edit literal path')
                throw Error('Unknown literal path action');
        }
        const value = await host.input('Literal relative path · one path, no globs expanded', index < 0 ? '' : paths[index]!);
        host.guard();
        if (value === undefined)
            continue;
        if (!value || value.length > 4096 || /[\x00-\x1f\x7f]/u.test(value) || value.startsWith('/') || value.includes('\\') || value.split('/').some(p => !p || p === '.' || p === '..' || p.toLowerCase() === '.git') || paths.some((p, i) => i !== index && p === value)) {
            await host.show('Path not staged', 'Enter one unique literal relative path without controls, traversal or .git components');
            host.guard();
            continue;
        }
        if (index < 0)
            paths.push(value);
        else
            paths[index] = value;
    }
}
