import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
const execute=promisify(execFile);

test('packed runtime helper and original prepared editor resolve entirely inside the shipped payload',{timeout:60000},async t=>{
    const source=await fs.realpath('.'),root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-preparation-package-')));
    assert.ok(!root.startsWith(source+path.sep),'Package consumer must not resolve dependencies through checkout ancestry');
    let passed=false;
    t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained preparation package '+root);});
    const owner=path.join(root,'owner');await fs.mkdir(owner,{mode:0o700});
    const env={...process.env,HOME:owner,TMPDIR:root,NODE_OPTIONS:'',NODE_PATH:'',npm_config_offline:'true',npm_config_cache:path.join(root,'npm-cache'),npm_config_userconfig:path.join(root,'empty-npmrc')};
    const npm=await fs.realpath(path.join(path.dirname(process.execPath),'npm'));
    const packed=await execute(process.execPath,[npm,'pack','--ignore-scripts','--quiet','--pack-destination',root],{cwd:source,env,timeout:45000,maxBuffer:2**20});
    assert.equal(packed.stdout.trim(),'gitjig-0.0.0.tgz');
    const extracted=path.join(root,'payload');await fs.mkdir(extracted);await execute('/usr/bin/tar',['-xf',path.join(root,packed.stdout.trim()),'-C',extracted],{timeout:10000});
    const payload=path.join(extracted,'package');
    for(const name of ['setup.mjs','Dockerfile','Dockerfile.dockerignore','io-helper.mjs'])assert.deepEqual(await fs.readFile(path.join(payload,'runtime',name)),await fs.readFile(path.join(source,'runtime',name)));
    const probe=path.join(payload,'resolve-sdk.mjs');
    await fs.writeFile(probe,"console.log(import.meta.resolve('@earendil-works/pi-coding-agent'));\n");
    const resolved=(await execute(process.execPath,[probe],{env,timeout:5000})).stdout.trim();
    assert.ok(resolved.startsWith(pathToFileURL(path.join(payload,'node_modules')+path.sep).href));
    const helper=path.resolve(path.dirname(path.join(payload,'dist/cli/entry.js')),'../../runtime/setup.mjs');
    assert.equal(helper,path.join(payload,'runtime/setup.mjs'));
    assert.match((await execute(process.execPath,[helper,'--help'],{env,timeout:5000})).stdout,/Interactive existing-Docker\/Colima preparation/);
    const {openController}=await import(pathToFileURL(path.join(payload,'dist/controller/index.js')).href);
    const {ApplicationStartup}=await import(pathToFileURL(path.join(payload,'dist/app/startup.js')).href);
    const home=path.join(root,'app'),config=path.join(root,'docker'),receipt=path.join(root,'receipt'),binary=path.join(root,'docker-client'),image='sha256:'+'c'.repeat(64);
    await fs.mkdir(config,{mode:0o700});
    await fs.writeFile(binary,'#!'+process.execPath+'\n'+`import fs from 'node:fs';const args=process.argv.slice(2),context=args.at(-1);fs.writeFileSync(${JSON.stringify(receipt)},JSON.stringify({args,files:fs.readdirSync(context)}));fs.writeFileSync(args[args.indexOf('--iidfile')+1],${JSON.stringify(image)});`,{mode:0o700});
    const c=await openController({installationHome:home});
    try {
        const startup=ApplicationStartup.open(c),edit=await startup.prepareRuntimeEdit();
        const built=await edit.buildImage({dockerBinary:binary,dockerConfigDirectory:config,dockerContext:'owned'},()=>{},new AbortController().signal,()=>{});
        assert.equal(built.image,image);assert.equal((await startup.inspect()).saved,null);
        await edit.save(built);assert.equal((await startup.inspect()).saved.runtime.image,image);
        const call=JSON.parse(await fs.readFile(receipt));assert.deepEqual(call.files.sort(),['Dockerfile','Dockerfile.dockerignore','io-helper.mjs']);
        assert.deepEqual(call.args.slice(0,5),['--config',config,'--context','owned','build']);await assert.rejects(fs.access(call.args.at(-1)));
        for(const table of ['works','runs','conversation_inputs'])assert.equal(c.store.one('SELECT COUNT(*) AS n FROM '+table).n,0);
    } finally {await c.close();}
    passed=true;
});
