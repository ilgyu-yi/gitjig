import assert from 'node:assert/strict';

// Independent consumer of the documented wire representation, not a production receipt reader.
export function readHistoricalProducers(value) {
 const names=['occurrence','findingBodySupplied','findingBodyOmitted'];
 const encoding=value.censusEncoding;
 if(encoding){
  assert.deepEqual(Object.keys(encoding).sort(),Object.hasOwn(encoding,'sourceSets')?['indexBase','occurrenceIdDictionary','sourceSets','version']:['indexBase','occurrenceIdDictionary','version']);
  assert.equal(encoding.version,1);assert.equal(encoding.indexBase,0);
  assert.ok(Array.isArray(encoding.occurrenceIdDictionary));
  assert.equal(new Set(encoding.occurrenceIdDictionary).size,encoding.occurrenceIdDictionary.length);
  assert.ok(encoding.occurrenceIdDictionary.every(id=>typeof id==='string'&&id.length));
  if(Object.hasOwn(encoding,'sourceSets')){assert.ok(Array.isArray(encoding.sourceSets));assert.ok(encoding.sourceSets.every(Array.isArray));assert.equal(new Set(encoding.sourceSets.map(set=>JSON.stringify(set))).size,encoding.sourceSets.length);}
 }
 return value.producers.map(producer=>{
  const view=structuredClone(producer.initialView);
  for(const name of names){
   const ids=name+'Ids',indexes=name+'Indexes';
   if(!encoding){assert.equal(Object.hasOwn(view,indexes),false);assert.ok(Array.isArray(view[ids]));continue;}
   assert.equal(Object.hasOwn(view,ids),false);assert.ok(Array.isArray(view[indexes]));
   view[ids]=view[indexes].map(index=>{assert.ok(Number.isSafeInteger(index)&&index>=0&&index<encoding.occurrenceIdDictionary.length);return encoding.occurrenceIdDictionary[index];});
   delete view[indexes];
  }
  if(encoding&&Object.hasOwn(encoding,'sourceSets')){
   assert.equal(Object.hasOwn(view,'sources'),false);assert.ok(Number.isSafeInteger(view.sourceSetIndex)&&view.sourceSetIndex>=0&&view.sourceSetIndex<encoding.sourceSets.length);
   view.sources=structuredClone(encoding.sourceSets[view.sourceSetIndex]);delete view.sourceSetIndex;
  }else{assert.equal(Object.hasOwn(view,'sourceSetIndex'),false);assert.ok(Array.isArray(view.sources));}
  return {...producer,initialView:view};
 });
}
