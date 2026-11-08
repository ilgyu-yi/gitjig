import { boundLauncher, quoteShellOperand } from './bound-launcher.js';

/** Display only. Control-bearing paths require the owner to supply the operand. */
export function resetRecoveryCommand(home: string, action: 'recover' | 'backup-recover'): string {
    if (/[\x00-\x1f\x7f-\x9f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/u.test(home))
        return `gitjig reset ${action} with --home set to the original application home`;
    const launcher = boundLauncher(home);
    return `${launcher ? quoteShellOperand(launcher) : 'gitjig'} reset ${action} --home ${quoteShellOperand(home)}`;
}
