import { historicalProvenanceManifest, type HistoricalProvenanceManifest } from './historical-provenance.js';
import { captureDispositionHistoryManifest, type DispositionHistoryManifest } from './disposition-history.js';
import { historicalPlanManifest, type HistoricalPlanManifest } from './historical-plans.js';
import { workflowCriteriaManifest, type CriteriaDeliveryManifest } from './criteria-delivery.js';

export type RoleInputEvidenceManifest = DispositionHistoryManifest | HistoricalPlanManifest | HistoricalProvenanceManifest | CriteriaDeliveryManifest;
export interface RoleInputEvidenceSnapshot { manifest: RoleInputEvidenceManifest; contents: string; }
/** Finite input formats share the existing registered Read surface. */
export function roleInputEvidenceManifests(context: Record<string, unknown>): RoleInputEvidenceManifest[] {
    const manifests: RoleInputEvidenceManifest[] = [];
    if (Object.hasOwn(context, 'dispositionHistory')) {
        const manifest = captureDispositionHistoryManifest(context.dispositionHistory);
        const declaration = context.dispositionHistoryInput as { version?: unknown; id?: unknown } | undefined;
        if (!declaration || declaration.version !== manifest.version || declaration.id !== manifest.id || manifest.version === 2 && Object.keys(declaration).sort().join(',') !== 'id,version') throw Error('Original disposition history receiver changed');
        manifests.push(manifest);
    }
    const plans = historicalPlanManifest(context);
    if (plans) manifests.push(plans);
    const provenance = historicalProvenanceManifest(context);
    if (provenance) manifests.push(provenance);
    const criteria = workflowCriteriaManifest(context);
    if (criteria) manifests.push(criteria);
    const first = manifests[0];
    if (first && manifests.some(manifest => manifest.stage !== context.stage || manifest.role !== first.role || manifest.workId !== first.workId || manifest.epoch !== first.epoch))
        throw Error('Original role evidence scope changed');
    return manifests;
}
