import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {validateStartupConfiguration} from '../../dist/app/startup.js';
async function fixture(t){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-native-account-home-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 for(const name of ['host','agent','agent/home','native-home/.claude','native-home/project','app'])await fs.mkdir(path.join(root,name),{recursive:true,mode:0o700});
 const home=path.join(root,'native-home');await fs.chmod(home,0o755);await fs.writeFile(path.join(home,'.claude.json'),'PRIVATE_NATIVE_METADATA_NOT_PARSED',{mode:0o600});await fs.writeFile(path.join(home,'.claude/token'),'PRIVATE_NATIVE_ACCOUNT_NOT_READ',{mode:0o600});
 await fs.writeFile(path.join(root,'agent/claude-bridge.json'),'{"askClaude":{"enabled":false},"provider":{"strictMcpConfig":true,"autoMemoryEnabled":false}}',{mode:0o600});
 const executable=path.join(root,'native-shim');await fs.writeFile(executable,'#!/bin/sh\nexit 99\n',{mode:0o700});
 const bridge={profile:{kind:'installed-claude-bridge',cwd:path.join(root,'host'),agentDir:path.join(root,'agent'),executable:{file:executable,sha256:createHash('sha256').update(await fs.readFile(executable)).digest('hex')}},nativeAccountDirectory:path.join(home,'.claude'),nativeAccountHome:home};
 return {root,home,bridge,validate:(value=bridge,projects=[path.join(home,'project')])=>validateStartupConfiguration({version:1,bridge:value},projects,path.join(root,'app'))};
}
test('startup preserves an explicit default-home native route without excluding projects elsewhere under that home',async t=>{
 const f=await fixture(t),before=await fs.readFile(path.join(f.home,'.claude.json')),account=await fs.readFile(path.join(f.home,'.claude/token')),environment={HOME:process.env.HOME,CLAUDE_CONFIG_DIR:process.env.CLAUDE_CONFIG_DIR};
 const valid=await f.validate();assert.deepEqual(valid.bridge,f.bridge);assert.equal(Object.isFrozen(valid.bridge),true);assert.deepEqual(await fs.readFile(path.join(f.home,'.claude.json')),before);assert.deepEqual(await fs.readFile(path.join(f.home,'.claude/token')),account);assert.deepEqual({HOME:process.env.HOME,CLAUDE_CONFIG_DIR:process.env.CLAUDE_CONFIG_DIR},environment);
 const {nativeAccountHome,...explicit}=f.bridge;assert.equal(Object.hasOwn((await f.validate(explicit)).bridge,'nativeAccountHome'),false);
 await assert.rejects(f.validate(f.bridge,[path.join(f.home,'.claude.json')]),/disjoint/);
});
test('startup refuses mismatched default-home directory, writable home and linked shared metadata',async t=>{
 const f=await fixture(t),other=path.join(f.root,'other-account');await fs.mkdir(other,{mode:0o700});await assert.rejects(f.validate({...f.bridge,nativeAccountDirectory:other}),/\.claude|match|directory/i);
 await fs.chmod(f.home,0o777);await assert.rejects(f.validate(),/home|owned|private|writ/i);await fs.chmod(f.home,0o755);
 const metadata=path.join(f.home,'.claude.json');await fs.rename(metadata,path.join(f.root,'original-native-metadata'));await fs.symlink(path.join(f.root,'original-native-metadata'),metadata);await assert.rejects(f.validate(),/metadata|settings|private|regular|link/i);assert.equal(await fs.readlink(metadata),path.join(f.root,'original-native-metadata'));
});
test('startup requires private single-link native metadata and protects its authority path even when absent',async t=>{
 const f=await fixture(t),metadata=path.join(f.home,'.claude.json'),alias=path.join(f.root,'metadata-hardlink');
 await fs.chmod(metadata,0o644);await assert.rejects(f.validate(),/owner-private regular file/);await fs.chmod(metadata,0o600);
 await fs.link(metadata,alias);await assert.rejects(f.validate(),/owner-private regular file/);await fs.unlink(alias);
 await fs.unlink(metadata);assert.equal((await f.validate()).bridge.nativeAccountHome,f.home);
 // The startup validator receives captured project roots; absence cannot drop this authority path.
 await assert.rejects(f.validate(f.bridge,[metadata]),/disjoint/);await assert.rejects(fs.lstat(metadata),{code:'ENOENT'});
});
