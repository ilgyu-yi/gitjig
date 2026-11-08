import test from 'node:test';
import {reviewInputBoundary} from './review-input-runtime-fixture.mjs';

test('settled review cannot apply judgment after its captured criteria change', {timeout:60000},
    () => reviewInputBoundary('settled-criteria'));
