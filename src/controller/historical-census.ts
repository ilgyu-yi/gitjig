const fields = ['occurrenceIds', 'findingBodySuppliedIds', 'findingBodyOmittedIds'] as const;
const guidance = ' censusEncoding.version=1 uses a local occurrenceIdDictionary. Each historical INITIAL-view *Indexes vector gives explicit zero-based dictionary positions, preserving order and body-exposure membership. Without that declaration, *Ids vectors contain literal IDs. No range, equivalence, current census, comprehension or new inputScope receipt is inferred.';
const sourceGuidance = ' When censusEncoding.sourceSets is present, each sourceSetIndex selects that exact complete ordered sources array, also zero-based. Otherwise sources remains literal.';

/** Presentation only: canonical witnesses and persisted receipts remain untouched. */
export function projectHistoricalCensus<T extends {
    semantics: string;
    producers: { initialView: Record<string, unknown> }[];
}>(canonical: T) {
    const originalBytes = Buffer.byteLength(JSON.stringify(canonical), 'utf8');
    if (originalBytes > 2 * 1024 * 1024)
        throw new Error('Historical planning evidence unavailable: complete projection exceeds existing2MiB role bound; no data clipped');
    if (Object.hasOwn(canonical, 'censusEncoding'))
        throw new Error('Historical census projection requires canonical input');
    const dictionary: string[] = [], positions = new Map<string, number>();
    const producers = canonical.producers.map(producer => {
        const initialView = { ...producer.initialView };
        for (const field of fields) {
            const indexed = field.replace('Ids', 'Indexes'), ids = initialView[field];
            if (Object.hasOwn(initialView, indexed) || !Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !id.length))
                throw new Error('Historical census projection requires canonical ID vectors');
            initialView[indexed] = ids.map((id: string) => {
                if (!positions.has(id)) {
                    positions.set(id, dictionary.length);
                    dictionary.push(id);
                }
                return positions.get(id)!;
            });
            delete initialView[field];
        }
        return { ...producer, initialView };
    });
    const indexed = { ...canonical, semantics: canonical.semantics + guidance,
        censusEncoding: { version: 1, indexBase: 0, occurrenceIdDictionary: dictionary }, producers };
    const sourceSets: unknown[][] = [], sourcePositions = new Map<string, number>();
    const sharedSources = producers.map(producer => {
        const initialView = { ...producer.initialView }, sources = initialView.sources;
        if (!Array.isArray(sources) || Object.hasOwn(initialView, 'sourceSetIndex'))
            throw new Error('Historical census projection requires canonical source arrays');
        const key = JSON.stringify(sources);
        if (!sourcePositions.has(key)) {
            sourcePositions.set(key, sourceSets.length);
            sourceSets.push(sources);
        }
        initialView.sourceSetIndex = sourcePositions.get(key)!;
        delete initialView.sources;
        return { ...producer, initialView };
    });
    const combined = { ...indexed, semantics: indexed.semantics + sourceGuidance,
        censusEncoding: { ...indexed.censusEncoding, sourceSets }, producers: sharedSources };
    const indexedBytes = Buffer.byteLength(JSON.stringify(indexed), 'utf8');
    const selected = Buffer.byteLength(JSON.stringify(combined), 'utf8') < indexedBytes ? combined : indexed;
    return Buffer.byteLength(JSON.stringify(selected), 'utf8') < originalBytes ? selected : canonical;
}
