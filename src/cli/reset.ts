import { createInterface } from 'node:readline/promises';
import path from 'node:path';
import { prepareApplicationReset, applyApplicationReset, ResetRecoveryRequired, type ResetScope, type ResetDisposition } from '../app/reset.js';
import { listResetBackups, deleteResetBackup } from '../app/reset-backups.js';
import { resolveUiLanguage, translator, type UiLocale } from '../ui/i18n.js';
import { quoteText } from '../ui/inspection-text.js';
import { restartCommand } from '../ui/startup-guidance.js';

type MaintenanceRequest = { action: 'reset'; scope: ResetScope; disposition?: ResetDisposition | undefined } | { action: 'backups' };

export async function interactiveMaintenance(home: string, request: MaintenanceRequest,
    locale: UiLocale = resolveUiLanguage(null).locale,
    session?: { conversation: string; continuation: readonly string[] }): Promise<number> {
    const t = translator(locale);
    try {
        if (request.action === 'backups') {
            await interactiveResetBackups(home, locale);
        } else {
            const applied = await interactiveReset(home, request.scope, locale, request.disposition);
            if (applied && request.scope === 'all') session = undefined;
        }
    }
    catch (error) {
        if (!(error instanceof ResetRecoveryRequired)) throw error;
        console.error(t(error.action === 'recover' ? 'reset.interrupted' : 'reset.backupDeletionInterrupted'));
        console.error(quoteText(error.message));
        console.error(t('reset.recoveryCommand'));
        console.error(error.recovery);
        return 2;
    }
    console.log(t('reset.reopen'));
    console.log(restartCommand(home, session?.conversation, undefined, undefined, session?.continuation));
    return 0;
}

async function interactiveReset(home: string, scope: ResetScope, locale: UiLocale, selectedDisposition?: ResetDisposition): Promise<boolean> {
    if (!process.stdin.isTTY || !process.stdout.isTTY)
        throw Error('Interactive reset requires a terminal; use reset preview and reset apply --confirm PREVIEW_FINGERPRINT');
    const ko = locale === 'ko';
    const t = translator(locale);
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
                return false;
            }
        }
        console.log(ko ? '초기화 대상과 실행 정리 상태를 확인하고 있습니다…' : 'Inspecting reset targets and execution cleanup…');
        const preview = await prepareApplicationReset(home, scope, disposition);
        const selected = t('reset.previewHome', {home:quoteText(preview.home), scope:t(scope === 'all' ? 'reset.all' : 'reset.settings')});
        if (!preview.paths.length) {
            console.log(selected);
            console.log(t('reset.noTargets'));
            return false;
        }
        console.log(disposition === 'backup'
            ? ko ? '초기화 대상 검토 · 원본은 비공개 백업에 보존됩니다' : 'Review reset · original data is retained in a private backup'
            : ko ? '초기화 대상 검토 · 백업 없이 영구 삭제하며 되돌릴 수 없습니다' : 'Review reset · permanent deletion without a retained backup; cannot be undone');
        console.log(selected);
        console.log(t('reset.previewRoots'));
        for (const relative of preview.paths)
            console.log('  ' + quoteText(path.join(preview.home, relative)));
        console.log(t(disposition === 'backup' ? 'reset.backupPolicy' : 'reset.deletePolicy'));
        if (preview.backupDirectory) console.log(t('reset.previewBackup', {directory:quoteText(preview.backupDirectory)}));
        console.log(t('reset.previewPreserved'));
        const word = disposition === 'backup' ? 'RESET' : 'DELETE';
        const answer = await terminal.question(ko ? `위 대상의 ${disposition === 'backup' ? '백업 후 초기화' : '영구 삭제'}를 확인하려면 ${word}를 입력하세요. 그 외 입력은 취소합니다: ` : `Type ${word} to confirm ${disposition === 'backup' ? 'these reset targets with a private backup' : 'permanent deletion of these targets without a backup'}. Any other response cancels: `);
        if (answer !== word) {
            console.log(ko ? '초기화를 취소했습니다' : 'Reset cancelled');
            return false;
        }
        console.log(t(disposition === 'backup' ? 'reset.applyingBackup' : 'reset.applyingDelete'));
        const result = await applyApplicationReset(home, scope, preview.fingerprint, disposition);
        console.log(JSON.stringify(result, null, 2));
        console.log(!result.reset ? t('reset.noTargets') : result.backup ? t('reset.completeBackup', {path: quoteText(result.backup)}) : t('reset.completeDelete'));
        return result.reset;
    }
    finally {
        terminal.close();
    }
}

async function interactiveResetBackups(home: string, locale: UiLocale) {
    const t = translator(locale);
    const { backups, held, pendingDeletion, backupDirectory } = await listResetBackups(home, { includeReceiptTime: true });
    console.log(t('reset.backupsHeading', { path: quoteText(backupDirectory) }));
    for (const backup of held)
        console.log(t('reset.backupHeld', { id: backup.backupId, reason: quoteText(backup.reason) }));
    if (pendingDeletion) {
        console.log(t('reset.backupPending', { command: pendingDeletion.recovery }));
        return;
    }
    if (!backups.length) {
        console.log(t('reset.backupsEmpty'));
        return;
    }
    const ordered = backups.toSorted((a, b) => (b.receiptModifiedAt ?? '').localeCompare(a.receiptModifiedAt ?? ''));
    const describe = (backup: typeof backups[number]) => t('reset.backupSummary', {
        id:backup.backupId, scope:t(backup.scope === 'all' ? 'reset.all' : 'reset.settings'),
        date:backup.receiptModifiedAt ?? t('reset.backupDateUnavailable'),
    });
    for (const [index, backup] of ordered.entries())
        console.log(`${index + 1}. ${describe(backup)}`);
    const terminal = createInterface({ input: process.stdin, output: process.stdout });
    try {
        const selection = (await terminal.question(t('reset.backupSelect'))).trim();
        const backup = /^[1-9][0-9]*$/u.test(selection) ? ordered[Number(selection) - 1] : undefined;
        if (backup) {
            console.log(t('reset.backupDeleteReview', { path: quoteText(path.join(backupDirectory, backup.backupId)) }));
            console.log(describe(backup));
            for (const item of backup.paths)
                console.log(quoteText(item));
            if (await terminal.question(t('reset.backupDeleteConfirm')) === 'DELETE') {
                console.log(t('reset.applyingBackupDeletion', { id: backup.backupId }));
                await deleteResetBackup(home, backup.backupId, backup.fingerprint);
                console.log(t('reset.backupDeleted', { id: backup.backupId }));
                return;
            }
        }
        console.log(t('reset.backupCancel'));
    }
    finally {
        terminal.close();
    }
}
