import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

/** Actual copied product/controller and owned rule assets; no model or engine. */
export async function criteriaWorld(t) {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gitjig-criteria-ui-'))), payload = path.join(root, 'payload');
    await fs.mkdir(payload); await fs.cp('dist', path.join(payload, 'dist'), { recursive: true });
    await fs.copyFile('package.json', path.join(payload, 'package.json'));
    await fs.symlink(path.resolve('node_modules'), path.join(payload, 'node_modules'));
    await fs.symlink(path.resolve('runtime'), path.join(payload, 'runtime'));
    for (const name of ['MISSION.md', 'PRINCIPLES.md', 'DESIGN.md', 'CONTRACTS.md']) await fs.copyFile(name, path.join(payload, name));
    const { openController } = await import(pathToFileURL(path.join(payload, 'dist/controller/index.js')).href);
    const c = await openController({ installationHome: path.join(root, 'home') }), source = path.join(root, 'project');
    await fs.mkdir(source); await fs.writeFile(path.join(source, 'file.txt'), 'Original owner bytes');
    await c.registerProject({ id: 'P', sourceRoot: source });
    const work = await c.beginChange({ projectId: 'P', request: 'Preserve original project purpose and owner task requirements' });
    const target = c.createConversation().conversationId;
    const goal = c.createGoal({ conversationId: target, objective: 'Preserve original goal purpose', criteria: ['Keep owner completion criteria unchanged'], turnLimit: 3 });
    let passed = false;
    t.after(async () => { await c.close(); if (passed) await fs.rm(root, { recursive: true, force: true }); else t.diagnostic('Retained criteria fixture ' + root); });
    return { root, payload, c, workId: work.workId, target, goalId: goal.goalId,
        async change(name = 'DESIGN.md', suffix = '\nOwned fixture clarification of selected workflow rules.\n') {
            const file = path.join(payload, name);
            if (name === 'DESIGN.md') {
                const before = await fs.readFile(file, 'utf8'), after = before.replace(/^(## D10\.[^\n]*\n)/mu, '$1' + suffix);
                if (after === before) throw new Error('Fixture requires actual D10 section');
                await fs.writeFile(file, after);
            } else await fs.appendFile(file, suffix);
        },
        snapshot() { return c.inspectChangeCriteriaRefresh(work.workId); },
        ledger() { return Object.fromEntries(['works', 'change_state', 'change_versions', 'sources', 'budgets', 'runs', 'goals', 'obligations'].map(table => [table, c.store.all('SELECT * FROM ' + table + ' ORDER BY rowid')])); },
        pass() { passed = true; } };
}
