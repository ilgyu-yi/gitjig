import { createInterface } from 'node:readline/promises';
import { prepareApplicationReset, applyApplicationReset, type ResetScope, type ResetDisposition } from '../app/reset.js';
export async function interactiveReset(home: string, scope: ResetScope, locale: 'en' | 'ko' = 'en', selectedDisposition?: ResetDisposition) {
    if (!process.stdin.isTTY || !process.stdout.isTTY)
        throw Error('Interactive reset requires a terminal; use reset preview and reset apply --confirm PREVIEW_FINGERPRINT');
    const ko = locale === 'ko';
    const terminal = createInterface({ input: process.stdin, output: process.stdout });
    try {
        let disposition = selectedDisposition;
        if (!disposition) {
            const answer = (await terminal.question(ko
                ? '초기화 데이터 처리: backup은 비공개 백업 보존, delete는 백업 없이 영구 삭제합니다. [backup/delete/cancel] (기본 backup): '
                : 'Reset data policy: backup keeps a private backup; delete permanently deletes without a backup. [backup/delete/cancel] (default backup): ')).trim().toLowerCase();
            if (answer === '' || answer === 'backup') disposition = 'backup';
            else if (answer === 'delete') disposition = 'delete';
            else {
                console.log(ko ? '초기화를 취소했습니다' : 'Reset cancelled');
                return;
            }
        }
        console.log(ko ? '초기화 대상과 실행 정리 상태를 확인하고 있습니다…' : 'Inspecting reset targets and execution cleanup…');
        const preview = await prepareApplicationReset(home, scope, disposition);
        console.log(disposition === 'backup'
            ? ko ? '초기화 대상 검토 · 원본은 비공개 백업에 보존됩니다' : 'Review reset · original data is retained in a private backup'
            : ko ? '초기화 대상 검토 · 백업 없이 영구 삭제하며 되돌릴 수 없습니다' : 'Review reset · permanent deletion without a retained backup; cannot be undone');
        console.log(JSON.stringify(preview, null, 2));
        const word = disposition === 'backup' ? 'RESET' : 'DELETE';
        const answer = await terminal.question(ko ? `위 대상의 ${disposition === 'backup' ? '백업 후 초기화' : '영구 삭제'}를 확인하려면 ${word}를 입력하세요. 그 외 입력은 취소합니다: ` : `Type ${word} to confirm ${disposition === 'backup' ? 'these reset targets with a private backup' : 'permanent deletion of these targets without a backup'}. Any other response cancels: `);
        if (answer !== word) {
            console.log(ko ? '초기화를 취소했습니다' : 'Reset cancelled');
            return;
        }
        console.log(JSON.stringify(await applyApplicationReset(home, scope, preview.fingerprint, disposition), null, 2));
    }
    finally {
        terminal.close();
    }
}
