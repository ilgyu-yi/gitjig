import test from 'node:test';
import {reviewInputBoundary} from './review-input-runtime-fixture.mjs';
test('prospective subject capture drift after diagnosis prevents review effects',{timeout:60000},()=>reviewInputBoundary('settled-capture',{subjectActions:true}));
