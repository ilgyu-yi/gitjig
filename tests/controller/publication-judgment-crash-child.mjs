import {runRecovery} from './publication-recovery-fixture.mjs';
await runRecovery({origin:process.argv[2],marker:process.argv[3]});
