import { readNativeObservation } from '../execution/native-observation.js';
/** Git-specific diagnostics retained over the shared bounded native read. */
export function readLocalGitProcess(file: string, args: string[], options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    signal: AbortSignal;
}): Promise<Buffer> {
    return readNativeObservation(file, args, { ...options, kind: 'Git' });
}
