import test from 'node:test';
import assert from 'node:assert/strict';
import {assessedLineCount,sourceScopeVersion} from '../../dist/workflow/source-scope.js';
import {validateBundle,promptExposures,exposureIssues,hashText} from '../../dist/workflow/exposure.js';
import {roleFraming} from '../../dist/workflow/role-framing.js';
import {historicalRoleInputBody,roleInputPrefix} from '../../dist/workflow/role-input.js';
const physical={sourceScopeInput:{version:2}};
const source=content=>({id:'base:mode.cjs',version:'B1',side:'base',path:'mode.cjs',content,sha256:hashText(content),exposeInPrompt:true});
const scope=(endLine,startLine=1)=>({sourceId:'base:mode.cjs',startLine,endLine});
const bundle=(content,endLine,context=physical)=>({requirements:[],contracts:'Complete source assessment required.',context,sources:[source(content)],requiredScope:[scope(endLine)]});

test('physical assessment excludes only the terminal fragment, preserving real blank lines and empty sentinel',()=>{
 for(const [text,expected] of [['a\nb\nc\nd\n',4],['a\nb\nc\nd',4],['a\r\nb\r\n',2],['a\n\n',2],['\n',1],['',1],['a\rb',1]]){
  assert.equal(assessedLineCount(text,physical),expected,JSON.stringify(text));
  assert.equal(assessedLineCount(text,{}),text.split('\n').length);
 }
 for(const value of [null,undefined,[],1,{version:1},{version:3},{version:2,other:true}])
  assert.throws(()=>sourceScopeVersion({sourceScopeInput:value}),/Unsupported source scope/);
});
test('complete physical assessment succeeds without changing lossless bytes or historical required coverage',()=>{
 const b=bundle('a\nb\nc\nd\n',4);validateBundle(b);
 const receipts=promptExposures('L',b);assert.equal(receipts[0].endLine,5);assert.equal(receipts[0].rangeSha256,hashText(b.sources[0].content));
 assert.deepEqual(exposureIssues([scope(4)],b.requiredScope,b,receipts),[]);
 assert.match(exposureIssues([scope(3)],b.requiredScope,b,receipts).join(),/MISSING_REQUIRED_SCOPE/);
 assert.match(exposureIssues([scope(5)],b.requiredScope,b,receipts).join(),/UNEXPOSED_SCOPE/);
 assert.match(exposureIssues([scope(4)],b.requiredScope,b,[]).join(),/UNEXPOSED_SCOPE/);
 assert.match(exposureIssues([scope(4)],b.requiredScope,b,receipts.map(r=>({...r,version:'other'}))).join(),/UNEXPOSED_SCOPE/);
 const old=bundle(b.sources[0].content,5,{});validateBundle(old);
 assert.match(exposureIssues([scope(4)],old.requiredScope,old,receipts).join(),/MISSING_REQUIRED_SCOPE/);
 assert.throws(()=>validateBundle(bundle(b.sources[0].content,5)),/Required scope/);
 const blank=bundle('a\n\n',2);assert.match(exposureIssues([scope(1)],blank.requiredScope,blank,promptExposures('L',blank)).join(),/MISSING_REQUIRED_SCOPE/);
});
test('physical framing declares distinct assessment and byte-framing counts; historical recognition binds its policy',()=>{
 const b=bundle('a\nb\nc\nd\n',4),frame=roleFraming('reviewer',b);
 const body=JSON.parse(historicalRoleInputBody(frame.prompt,'reviewer'));
 assert.equal(body.sources[0].assessedLineCount,4);assert.equal(body.sources[0].lineCount,5);
 assert.ok(frame.prompt.includes('\na\nb\nc\nd\n\nEND SOURCE\n'));
 const old=bundle(b.sources[0].content,5,{}),oldFrame=roleFraming('reviewer',old);
 assert.equal(Object.hasOwn(JSON.parse(historicalRoleInputBody(oldFrame.prompt,'reviewer')).sources[0],'assessedLineCount'),false);
 assert.equal(historicalRoleInputBody(frame.prompt.replace(roleInputPrefix('reviewer',physical),roleInputPrefix('reviewer')),'reviewer'),null);
 assert.equal(historicalRoleInputBody(oldFrame.prompt.replace(roleInputPrefix('reviewer'),roleInputPrefix('reviewer',physical)),'reviewer'),null);
});
