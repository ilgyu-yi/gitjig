import test from 'node:test';import assert from 'node:assert/strict';
import {showExactInspection, showExactReview} from '../../dist/ui/exact-review.js';
import {uiText} from '../../dist/ui/i18n.js';
for(const locale of ['en','ko'])test(locale+' exact review localizes every page while retaining the complete literal operands',async()=>{
 const value={workId:'ORIGINAL_작업',path:'/literal/한국어/source',reason:'Original owner text '+('x🌱\n'.repeat(20000))},pages=[];let guards=0;
 const reviewed=await showExactReview({show:async(title,text,primary)=>{pages.push({title,text,label:primary.label});await primary.run();}},'Original exact scope',value,()=>guards++,'No execution',locale);
 assert.equal(reviewed,true);assert.equal(pages.at(-1).label,uiText(locale,'review.confirm'));
 assert.ok(pages.length>1);assert.equal(guards,pages.length);assert.deepEqual(JSON.parse(pages.map(p=>p.text).join('')),value);
 for(const [i,page]of pages.entries())assert.equal(page.title,uiText(locale,'review.pageTitle',{title:'Original exact scope',page:i+1,pages:pages.length,suffix:'No execution'}));
});
test('exact review refuses a changed owner after a page before exposing a later page',async()=>{
 let shown=0,current=true;await assert.rejects(showExactReview({show:async()=>{shown++;current=false;}},'Original scope',{reason:'x'.repeat(70000)},()=>{if(!current)throw Error('Original review changed');},'No execution','ko'),/Original review changed/);assert.equal(shown,1);
});
test('closing a middle review page and closing a read-only inspection cannot advance',async()=>{
 const payload={value:'x'.repeat(90000)};
 let reviewed=0,inspected=0;
 const decision=await showExactReview({show:async(_title,_text,primary)=>{if(++reviewed===1)await primary.run();}},'Review',payload,()=>{},'Review only');
 assert.equal(decision,false);assert.equal(reviewed,2);
 const value=await showExactInspection({show:async()=>{inspected++;}},'Inspection',payload,()=>{},'Read only');
 assert.equal(value,undefined);assert.equal(inspected,1);
});

for(const path of ['escape','changed proof','changed source']) test('asynchronous proof checks only named advancement · '+path,async()=>{
 const calls=[];
 let current=true;
 const host={show:async(_title,_text,primary)=>{
  calls.push('page');
  if(path!=='escape')await primary.run();
 }};
 const review=showExactReview(host,'Review',{value:'x'.repeat(40000)},()=>{
  calls.push('source');
  if(!current)throw Error('Review source changed');
 },'Review only','en',{next:'Next',finish:'Confirm',mayAdvance:async()=>{
  calls.push('proof');
  await Promise.resolve();
  current=path!=='changed source';
  return path!=='changed proof';
 }});
 if(path==='changed source')await assert.rejects(review,/Review source changed/);
 else assert.equal(await review,false);
 assert.deepEqual(calls,path==='escape'?['page','source']:['page','source','proof','source']);
});
