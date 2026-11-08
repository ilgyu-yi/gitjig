import test from 'node:test';
import {reviewInputBoundary} from './review-input-runtime-fixture.mjs';
test('prospective subject view drift at capacity stops before review model entry',{timeout:60000},()=>reviewInputBoundary('capacity-metadata',{subjectActions:true}));
