import test from 'node:test';
import {reviewInputBoundary} from './review-input-runtime-fixture.mjs';

test('explicit older review body3 retains captured schema, source and settled-history interpretation',{timeout:60000},async()=>{
 await reviewInputBoundary('settled-capture',{bodyVersion:3});
});
