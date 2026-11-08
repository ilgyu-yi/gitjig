import { truncateToWidth } from '@earendil-works/pi-tui';
import type { Controller } from '../controller/controller.js';
import { plainTerminalText } from './chrome.js';
import { chooseUiItem, type UiChoice, type UiChoiceHost } from './choices.js';
import { translator, type UiLocale } from './i18n.js';
import type { RecoveryNavigation } from './recovery-navigation.js';

interface Host extends UiChoiceHost, RecoveryNavigation {
    locale?: UiLocale;
    guard(): void;
}

function preview(text: string, width: number) {
    const singleLine = plainTerminalText(text).replace(/\p{Bidi_Control}/gu, '').replace(/\s+/gu, ' ').trim();
    return plainTerminalText(truncateToWidth(singleLine, width, '…'));
}

export function mergeWorkPicker(host: Host, controller: Controller, targetId: string, title: 'merge.work.prepare' | 'merge.work.delegate') {
    const t = translator(host.locale ?? 'en');
    const newer: (string | undefined)[] = [];
    let before: string | undefined;
    return async () => {
        while (true) {
            host.guard();
            const page = controller.listMergeDelegationWorks(targetId, { limit: 25, ...before ? { before } : {} });
            const items: UiChoice[] = page.works.map(work => ({
                value: 'work:' + work.workId,
                label: [preview(work.request ?? '', 56), t(work.eligible ? 'merge.work.owner' : 'merge.work.held'),
                    preview(work.recordedPhase, 32), work.workId].filter(Boolean).join(' · '),
            }));
            if (!page.works.length && !before && host.navigate)
                items.push({ value: 'start', label: t('merge.work.start') });
            if (page.nextCursor)
                items.push({ value: 'older', label: t('merge.work.older') });
            if (newer.length)
                items.push({ value: 'newer', label: t('merge.work.newer') });
            items.push({ value: 'refresh', label: t('merge.work.refresh') }, { value: 'back', label: t('merge.record.back') });
            const choice = await chooseUiItem(host, t(title), items);
            host.guard();
            switch (choice) {
                case undefined:
                case 'back':
                    return;
                case 'start':
                    return host.navigate?.('/change start');
                case 'older':
                    newer.push(before);
                    before = page.nextCursor!;
                    continue;
                case 'newer':
                    before = newer.pop();
                    continue;
                case 'refresh':
                    continue;
                default:
                    return page.works.find(work => choice === 'work:' + work.workId)!;
            }
        }
    };
}
