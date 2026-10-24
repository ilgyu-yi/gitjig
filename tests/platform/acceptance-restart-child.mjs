// Owned local fixture only: deliberately killed after known retained creation reopen.
import {createOwnedAcceptanceSetup} from '../../dist/platform/hosted-context.js';
const setup = await createOwnedAcceptanceSetup({ origin: process.argv[2], journalRoot: process.argv[3], token: 'fixture-literal-original' });
const context = await setup.reopen();
process.on('message', () => {});
process.send({ kind: 'known-created-reopened', repositoryId: context.target.repositoryId, counters: setup.inspect().counters });
// IPC keeps this exact owned process alive until the parent supplies SIGKILL.
