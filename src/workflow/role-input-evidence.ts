import { captureDispositionHistoryManifest, type DispositionHistoryManifest } from './disposition-history.js';
import { historicalPlanManifest, type HistoricalPlanManifest } from './historical-plans.js';

export type RoleInputEvidenceManifest = DispositionHistoryManifest | HistoricalPlanManifest;
export interface RoleInputEvidenceSnapshot { manifest: RoleInputEvidenceManifest; contents: string; }
/** These two finite input formats share the existing registered Read surface. */
export function roleInputEvidenceManifests(context: Record<string, unknown>): RoleInputEvidenceManifest[] {
    const manifests: RoleInputEvidenceManifest[] = [];
    if (Object.hasOwn(context, 'dispositionHistory')) {
        const manifest = captureDispositionHistoryManifest(context.dispositionHistory);
        const declaration = context.dispositionHistoryInput as { version?: unknown; id?: unknown } | undefined;
        if (!declaration || declaration.version !== 1 || declaration.id !== manifest.id) throw Error('Original disposition history receiver changed');
        manifests.push(manifest);
    }
    const plans = historicalPlanManifest(context);
    if (plans) manifests.push(plans);
    const first = manifests[0];
    if (first && manifests.some(manifest => manifest.stage !== context.stage || manifest.workId !== first.workId || manifest.epoch !== first.epoch))
        throw Error('Original role evidence scope changed');
    return manifests;
}
