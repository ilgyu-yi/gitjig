import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile);
for(const profile of [{fault:false},{fault:true},{fault:false,stalePicker:true},{fault:false,fastSwitch:true},{fault:false,menuPointer:true}])test('actual direct hierarchy navigation '+(profile.menuPointer?'menu pointer input ownership':profile.fastSwitch?'immediate input after navigation':profile.stalePicker?'stale child picker refusal':profile.fault?'persistence refusal/recovery':'relationships and native input ownership'),{timeout:20000},async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/ui-hierarchy-'))),home=path.join(root,'home');await fs.mkdir(home,{mode:0o700});
 const cfg={home,...profile,control:path.join(root,'control.json'),receipt:path.join(root,'receipt.json'),finish:path.join(root,'finish'),recover:path.join(root,'recover'),reparent:path.join(root,'reparent'),artifacts:path.join(home,'artifacts'),output:path.join(root,'terminal.bin')};
 const child=path.join(root,'child.json'),driver=path.join(root,'driver.json');await fs.writeFile(child,JSON.stringify(cfg));await fs.writeFile(driver,JSON.stringify({...cfg,command:[process.execPath,path.resolve('tests/ui/hierarchy-pty-child.mjs'),child]}));
 try{const actual=JSON.parse((await execute('python3',[path.resolve('tests/ui/hierarchy-pty.py'),driver],{timeout:16000,maxBuffer:2**20})).stdout),receipt=JSON.parse(await fs.readFile(cfg.receipt,'utf8'));await fs.writeFile(path.join(root,'actual.json'),JSON.stringify({actual,receipt},null,2));t.diagnostic(JSON.stringify({actual,receipt,fixture:root}));assert.equal(actual.exitCode,0);assert.equal(actual.terminalRestored,true);assert.equal(receipt.providerCalls,0);assert.equal(receipt.normalUiReturn,true);
 if(profile.menuPointer){assert.ok(actual.checks.includes('menu-release-filter-and-redraw'));assert.ok(actual.checks.includes('menu-pointer-input-ownership'));assert.equal(receipt.drafts[receipt.root],'ROOT_DRAFT');}
 else if(profile.fastSwitch){assert.ok(actual.checks.includes('immediate-input-target-aligned'));assert.equal(receipt.drafts[receipt.b],'B_DRAFT');assert.equal(receipt.drafts[receipt.grand],'GRAND_DRAFTBURST_ACK');}
 else if(profile.stalePicker){assert.ok(actual.checks.includes('ancestor-context-refused'));assert.ok(actual.checks.includes('stale-picker-refused'));assert.ok(actual.checks.includes('fresh-child-after-refusal'));assert.equal(receipt.drafts[receipt.root],'ROOT_DRAFTSTALE_ACK');}
 else if(profile.fault){assert.ok(actual.checks.includes('save-refused'));assert.ok(actual.checks.includes('exact-text-recovered'));assert.equal(receipt.drafts[receipt.b],'B_DRAFTUNSAVED');}
 else for(const name of ['expanded-footer-keeps-context-and-model','toolbar-preserved-on-boundary','notice-cleared-on-edit','notice-cleared-on-menu','notice-cleared-on-navigation','root-boundary','multiple-child-picker','remembered-child','one-level-grandchild','release-repeat-no-extra-step','leaf-boundary','stale-child-ignored','split-current-target','native-search-owns-input','native-autocomplete-owns-input'])assert.ok(actual.checks.includes(name),name);
 }catch(error){t.diagnostic('Retained hierarchy fixture '+root);throw error;}
});
