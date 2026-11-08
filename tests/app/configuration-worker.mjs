import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { openController } from '../../dist/controller/index.js';
import { ApplicationSettings, resolveApplicationHome } from '../../dist/app/settings.js';
const root = process.argv[2], execute = promisify(execFile);
const home = path.join(root, 'app'), project = path.join(root, 'project');
const stock = process.env.PI_CODING_AGENT_DIR;
await fs.mkdir(stock, { recursive: true, mode: 0o700 });
await fs.mkdir(path.join(project, '.pi'), { recursive: true });
await fs.mkdir(path.join(project, '.gitjig'), { mode: 0o755 });
const stockFiles = [path.join(stock, 'settings.json'), path.join(stock, 'auth.json'), path.join(stock, 'models.json'), path.join(project, '.pi/settings.json')];
for (const file of stockFiles) await fs.writeFile(file, JSON.stringify({ defaultProvider: 'stock-secret-provider', defaultModel: 'wrong-model', defaultTools: ['wrong-tool'] }), { mode: 0o600 });
const before = await Promise.all(stockFiles.map(file => fs.readFile(file, 'utf8')));
await fs.writeFile(path.join(project, '.gitjig/settings.json'), JSON.stringify({ defaultModel: 'project-model', theme: 'light', packages: ['must-not-run'] }));
assert.equal(resolveApplicationHome(undefined, { GITJIG_HOME: home, PI_CODING_AGENT_DIR: stock }), home);
assert.equal(resolveApplicationHome(home, { GITJIG_HOME: stock }), home);
assert.notEqual(resolveApplicationHome(undefined, { PI_CODING_AGENT_DIR: stock }), stock);
assert.throws(() => resolveApplicationHome('relative'), /absolute/);
const controller = await openController({ installationHome: home });
let app, manager;
try {
    app = ApplicationSettings.open(controller);
    assert.equal(await fs.readFile(path.join(home, 'controller.json'), 'utf8'), JSON.stringify({ format: 'gitjig-controller-1' }));
    await controller.registerProject({ id: 'p', sourceRoot: project });
    manager = app.manager('p');
    assert.equal(manager.getDefaultModel(), undefined);
    assert.equal(app.inspect('p').projectApproved, false);
    manager.setDefaultModelAndProvider('fixture-provider', 'global-model');
    manager.setEnabledModels(['fixture-provider/*']);
    manager.setDefaultThinkingLevel('high');
    await app.flush(manager);
    assert.equal((await fs.stat(path.join(home, 'config/settings.json'))).mode & 0o777, 0o600);
    assert.equal(app.inspect('p').effective.defaultModel, 'global-model');
    app.approveProject('p');
    const approved = app.inspect('p');
    assert.equal(approved.effective.defaultModel, 'project-model');
    assert.equal(approved.effective.defaultProvider, 'fixture-provider');
    assert.equal(approved.effective.theme, 'light');
    assert.equal(approved.sources.defaultModel, 'project');
    assert.ok(approved.diagnostics.some(d => d.field === 'packages' && /not applied/.test(d.reason)));
    assert.equal(approved.effective.packages, undefined);
    const second = await execute(process.execPath, ['--input-type=module', '-e', `
      import {openController} from './dist/controller/index.js';
      import {ApplicationSettings} from './dist/app/settings.js';
      try { const c=await openController({installationHome:process.argv[1]});ApplicationSettings.open(c);await c.close();process.exitCode=9; }
      catch(e){ if(e.code!=='OWNER_BUSY')throw e;console.log('refused-before-config'); }
    `, home], { env: process.env, timeout: 5000 });
    assert.equal(second.stdout.trim(), 'refused-before-config');
    assert.equal(app.inspect().effective.defaultModel, 'global-model');
    assert.deepEqual(await Promise.all(stockFiles.map(file => fs.readFile(file, 'utf8'))), before);
    // Do not silently accept invalid native values or resource/authority preferences.
    const file = path.join(home, 'config/settings.json');
    const saved = JSON.parse(await fs.readFile(file, 'utf8'));
    await fs.writeFile(file, JSON.stringify({ ...saved, defaultThinkingLevel: 'impossible', extensions: ['evil'], auth: 'must-not-print' }), { mode: 0o600 });
    const invalid = app.inspect();
    assert.equal(invalid.effective.defaultThinkingLevel, undefined);
    assert.equal(invalid.effective.extensions, undefined);
    assert.equal(invalid.diagnostics.filter(d => ['extensions', 'auth', 'defaultThinkingLevel'].includes(d.field)).length, 3);
    assert.ok(!JSON.stringify(invalid).includes('must-not-print'));
    manager = app.manager(); manager.setTheme('dark'); await app.flush(manager);
    assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).extensions[0], 'evil');
    await fs.writeFile(file, JSON.stringify(saved), { mode: 0o600 });
    // Original Pi deletion semantics must survive both a new manager and restart.
    const removalRaw = { ...saved, unknownPreference: 'retained-unapplied' };
    await fs.writeFile(file, JSON.stringify(removalRaw), { mode: 0o600 });
    const removal = app.manager();
    removal.setModelThinkingLevel('fixture', 'model', 'high'); await app.flush(removal);
    assert.equal(app.manager().getModelThinkingLevel('fixture', 'model'), 'high');
    removal.removeModelThinkingLevel('fixture', 'model'); await app.flush(removal);
    assert.equal(removal.getModelThinkingLevel('fixture', 'model'), undefined);
    assert.equal(app.manager().getModelThinkingLevel('fixture', 'model'), undefined);
    const removed = JSON.parse(await fs.readFile(file, 'utf8'));
    assert.equal(removed.modelThinkingLevels, undefined);
    assert.equal(removed.unknownPreference, 'retained-unapplied');
    assert.equal(removed.defaultModel, 'global-model');
    // Aggregate UTF-8/formatting bounds apply before a command can change any
    // native map entry. Preserve unapplied data and the exact previous file.
    const almostFull = { ...removed, filler: 'x'.repeat(127000) };
    await fs.writeFile(file, JSON.stringify(almostFull), { mode: 0o600 });
    const beforeOversize = await fs.readFile(file, 'utf8');
    const bigMap = Object.fromEntries(Array.from({ length: 6 }, (_, i) => ['fixture/' + i + 'x'.repeat(1000), 'high']));
    await assert.rejects(app.setPreference('modelThinkingLevels', bigMap), /128KiB/);
    assert.equal(await fs.readFile(file, 'utf8'), beforeOversize);
    assert.equal(app.manager().getDefaultModel(), 'global-model');
    assert.equal(app.manager().getModelThinkingLevel('fixture', 'model'), undefined);
    await fs.writeFile(file, JSON.stringify(removed), { mode: 0o600 });
    await app.setPreference('modelThinkingLevels', { 'fixture/model': 'low' });
    assert.equal(app.manager().getModelThinkingLevel('fixture', 'model'), 'low');
    await app.setPreference('modelThinkingLevels', {});
    assert.equal(app.manager().getModelThinkingLevel('fixture', 'model'), undefined);
    const beforeDirect = await fs.readFile(file, 'utf8');
    const direct = app.manager();
    direct.setEnabledModels(Array.from({ length: 130 }, (_, i) => String(i).padStart(4, '0') + 'x'.repeat(1020)));
    await assert.rejects(app.flush(direct), /could not be saved/);
    assert.equal(await fs.readFile(file, 'utf8'), beforeDirect);
} finally { await controller.close(); }
assert.throws(() => app.inspect(), /Controller closed/);
manager.setDefaultModel('after-close');
await assert.rejects(app.flush(manager), /Controller closed/);
// Changing stock Pi state after setup must not influence reopened gitjig state.
for (const file of stockFiles) await fs.writeFile(file, '{"defaultModel":"another-wrong-model"}', { mode: 0o600 });
const reopened = await openController({ installationHome: home });
try {
    const next = ApplicationSettings.open(reopened);
    assert.equal(next.inspect().effective.defaultModel, 'global-model');
    assert.equal(next.manager().getModelThinkingLevel('fixture', 'model'), undefined);
    assert.equal(JSON.parse(await fs.readFile(path.join(home, 'config/settings.json'), 'utf8')).unknownPreference, 'retained-unapplied');
    assert.equal(next.inspect('p').effective.defaultModel, 'project-model');
    // Linked settings cannot become an accidental writable external source.
    const file = path.join(home, 'config/settings.json');
    await fs.unlink(file); await fs.symlink(stockFiles[0], file);
    const linked = next.inspect();
    assert.equal(linked.effective.defaultModel, undefined);
    assert.ok(linked.diagnostics.some(d => /unavailable/.test(d.reason)));
    assert.equal(await fs.readFile(stockFiles[0], 'utf8'), '{"defaultModel":"another-wrong-model"}');
} finally { await reopened.close(); }
console.log(JSON.stringify({ phase: 'configuration', outcome: 'passed', serviceCalls: 0 }));
