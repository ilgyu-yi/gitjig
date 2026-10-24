import test from 'node:test';
import {runRecovery} from './publication-recovery-fixture.mjs';
test('owner input during exact WAIT continuation history await wins without duplicate paid admission or losing the pending finding',{timeout:20000},()=>runRecovery({ownerRace:true}));
