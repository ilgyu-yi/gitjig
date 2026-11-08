import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {SessionManager} from '@earendil-works/pi-coding-agent';

// Original SDK file semantics only: these messages are fixture data, not model
// turns, controller receipts, successful work, or evidence of review standing.
const root=fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(),'gitjig-native-fork-')));
fs.chmodSync(root,0o700);
const directory=name=>{const result=path.join(root,name);fs.mkdirSync(result,{mode:0o700});return result;};
const cwd=directory('work'),sourceDir=directory('source'),destinationDir=directory('destination');
const message=text=>({role:'user',content:[{type:'text',text}],timestamp:Date.now()});
const texts=manager=>manager.getBranch().filter(e=>e.type==='message').map(e=>e.message.content.map(c=>c.text??'').join(''));

test('detached native path forks persist identity and labels without altering source or copying abandoned branches',()=>{
  const source=SessionManager.create(cwd,sourceDir);
  const first=source.appendMessage(message('root'));
  source.appendLabelChange(first,'root bookmark');
  const abandoned=source.appendMessage(message('abandoned'));
  source.branch(first);
  const current=source.appendMessage(message('current'));
  const sourceFile=source.getSessionFile(),sourceId=source.getSessionId();
  const sourceBytes=fs.readFileSync(sourceFile);
  assert.equal(SessionManager.open(sourceFile,sourceDir,cwd).getLeafId(),current);

  // branch() changes only the in-memory leaf until a further entry is appended.
  const transient=SessionManager.open(sourceFile,destinationDir,cwd);
  transient.branch(first);
  assert.equal(transient.getLeafId(),first);
  assert.equal(SessionManager.open(sourceFile,sourceDir,cwd).getLeafId(),current);
  assert.deepEqual(fs.readFileSync(sourceFile),sourceBytes);

  const outputs=[];
  for(const [selection,expected] of [[first,['root']],[current,['root','current']]]){
    const detached=SessionManager.open(sourceFile,destinationDir,cwd);
    const output=detached.createBranchedSession(selection);
    assert.equal(path.dirname(output),destinationDir);
    assert.notEqual(detached.getSessionId(),sourceId);
    assert.equal(detached.getSessionFile(),output);
    assert.equal(detached.getHeader().parentSession,sourceFile);
    assert.equal(detached.getHeader().cwd,cwd);
    const reopened=SessionManager.open(output,destinationDir,cwd);
    assert.equal(reopened.getSessionId(),detached.getSessionId());
    assert.equal(reopened.getLabel(first),'root bookmark');
    assert.equal(reopened.getEntry(abandoned),undefined);
    assert.deepEqual(texts(reopened),expected);
    const entries=reopened.getEntries(),ids=new Set(entries.map(e=>e.id));
    for(const entry of entries)assert.ok(entry.parentId===null||ids.has(entry.parentId));
    reopened.appendMessage(message(`destination ${selection}`));
    assert.deepEqual(texts(SessionManager.open(output,destinationDir,cwd)),[...expected,`destination ${selection}`]);
    outputs.push({file:output,id:detached.getSessionId()});
    assert.deepEqual(fs.readFileSync(sourceFile),sourceBytes);
    assert.equal(source.getLeafId(),current);
    assert.equal(source.getSessionId(),sourceId);
  }
  assert.notEqual(outputs[0].id,outputs[1].id);
  const destinationBytes=outputs.map(o=>fs.readFileSync(o.file));
  source.appendMessage(message('later source'));
  for(const [index,output] of outputs.entries())assert.deepEqual(fs.readFileSync(output.file),destinationBytes[index]);
  assert.deepEqual(texts(SessionManager.open(sourceFile,sourceDir,cwd)),['root','current','later source']);
});

test('setup-only selected path defers the destination file rather than inventing conversation content',()=>{
  const source=SessionManager.create(cwd,sourceDir);
  const setup=source.appendModelChange('fixture','not-executed');
  source.appendMessage(message('actual source file flush'));
  const sourceFile=source.getSessionFile(),bytes=fs.readFileSync(sourceFile);
  const detached=SessionManager.open(sourceFile,destinationDir,cwd);
  const output=detached.createBranchedSession(setup);
  assert.ok(output);
  assert.equal(fs.existsSync(output),false);
  assert.deepEqual(texts(detached),[]);
  assert.equal(detached.getHeader().parentSession,sourceFile);
  assert.deepEqual(fs.readFileSync(sourceFile),bytes);
});

test.after(()=>{
  fs.rmSync(root,{recursive:true,force:true});
  console.log(JSON.stringify({nativeForkFixture:true,syntheticDispatches:0,externalCalls:0,fixtureFilesRemoved:!fs.existsSync(root)}));
});
