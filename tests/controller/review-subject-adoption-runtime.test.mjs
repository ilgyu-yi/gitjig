import test from 'node:test';
import {reviewInputBoundary} from './review-input-runtime-fixture.mjs';
test('prospective review subject actions reach actual checked and reviewed adoption',{timeout:60000},()=>reviewInputBoundary('adoption',{subjectActions:true}));
