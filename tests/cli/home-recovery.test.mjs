import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {openController} from '../../dist/controller/index.js';
const execute=promisify(execFile);

test('source entry explains refused homes and preserves foreign contents; dedicated-home recovery works',{timeout:15000},async t=>{
    const root=await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/home-recovery-')));let passed=false;
    t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained home recovery '+root);});
    const invoke=async home=>{try{return await execute(process.execPath,['--import','./tests/cli/account-ui-no-network.mjs','dist/cli/entry.js','project','list','--home',home],{timeout:4000,env:{...process.env,TMPDIR:root}});}catch(e){assert.equal(e.code,2);return e;}};
    for(const name of ['empty-artifacts','foreign-contents']){
        const home=path.join(root,name);await fs.mkdir(home,{mode:0o700});
        if(name==='empty-artifacts')await fs.mkdir(path.join(home,'artifacts'),{mode:0o700});else await fs.writeFile(path.join(home,'important.txt'),'PRESERVE');
        const result=await invoke(home),failure=JSON.parse(result.stderr.trim().split('\n').at(-1));
        assert.equal(failure.error,'FOREIGN_HOME');assert.ok(failure.message.includes(home));assert.match(failure.recovery,/gitjig conversation ui --home/);
        await assert.rejects(fs.stat(path.join(home,'controller.json')),e=>e.code==='ENOENT');
        assert.deepEqual(await fs.readdir(home),[name==='empty-artifacts'?'artifacts':'important.txt']);
        if(name==='foreign-contents')assert.equal(await fs.readFile(path.join(home,'important.txt'),'utf8'),'PRESERVE');
    }
    const home=path.join(root,'fresh'),healthy=await invoke(home);assert.deepEqual(JSON.parse(healthy.stdout),[]);
    const alias=path.join(root,'alias');await fs.symlink(root,alias);
    const aliased=await invoke(path.join(alias,'fresh')),failure=JSON.parse(aliased.stderr.trim().split('\n').at(-1));
    assert.equal(failure.error,'UNOWNED_STATE');assert.ok(failure.recovery.includes(home));
    const leaf=path.join(root,'leaf');await fs.symlink(home,leaf);
    assert.equal(JSON.parse((await invoke(leaf)).stderr.trim().split('\n').at(-1)).error,'UNOWNED_STATE');
    const owner=await openController({installationHome:home});try{const failure=JSON.parse((await invoke(home)).stderr.trim().split('\n').at(-1));assert.equal(failure.error,'OWNER_BUSY');assert.ok(failure.message.includes(home));assert.ok(failure.recovery.includes(home));}finally{await owner.close();}
    const invalid=path.join(root,'invalid-marker');await fs.mkdir(invalid,{mode:0o700});const marker=path.join(invalid,'controller.json');await fs.writeFile(marker,'{\"format\":\"foreign\"}',{mode:0o600});
    const refused=JSON.parse((await invoke(invalid)).stderr.trim().split('\n').at(-1));assert.equal(refused.error,'FOREIGN_HOME');assert.ok(refused.message.includes(invalid));assert.match(refused.recovery,/without overwriting/);assert.equal(await fs.readFile(marker,'utf8'),'{\"format\":\"foreign\"}');
    passed=true;
});
