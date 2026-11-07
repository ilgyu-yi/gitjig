import { createHash } from 'node:crypto';
import type { SimpleStreamOptions } from '@earendil-works/pi-ai';

/** Explicit hosted, fresh-query format intent; never ambient provider settings. */
export const structuredOutputMetadataKey = 'gitjig.structured-output/v1';
export interface StructuredOutputRequest {
  version: 1;
  requestId: string;
  binding: Record<string, string>;
  schema: Record<string, unknown>;
  maxNativeTurns: number;
}
export interface CapturedStructuredOutput {
  readonly request: StructuredOutputRequest;
  readonly requestDigest: string;
  readonly schemaDigest: string;
}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
/** Reject lossy or non-JSON inputs instead of silently dropping schema keywords. */
function json(value: unknown, depth = 0): void {
  if (depth > 64) throw Error('BRIDGE_STRUCTURED_SCHEMA_UNAVAILABLE');
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return;
  if (!value || typeof value !== 'object' || !Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    throw Error('BRIDGE_STRUCTURED_SCHEMA_UNAVAILABLE');
  for (const item of Array.isArray(value) ? value.values() : Object.values(value)) json(item, depth + 1);
}
export function captureStructuredOutput(options: SimpleStreamOptions | undefined, hosted: boolean): CapturedStructuredOutput | undefined {
  if (!options?.metadata || !Object.hasOwn(options.metadata, structuredOutputMetadataKey)) return undefined;
  if (!hosted || options.cacheRetention === 'none' || !options.sessionId || typeof options.onProviderStreamEvent !== 'function')
    throw Error('BRIDGE_STRUCTURED_ROUTE_UNAVAILABLE');
  const raw = options.metadata[structuredOutputMetadataKey];
  json(raw);
  if (Buffer.byteLength(JSON.stringify(raw)) > 256 * 1024) throw Error('BRIDGE_STRUCTURED_SCHEMA_UNAVAILABLE');
  const request = structuredClone(raw) as StructuredOutputRequest;
  if (!request || typeof request !== 'object' || Array.isArray(request) || Object.keys(request).sort().join(',') !== 'binding,maxNativeTurns,requestId,schema,version' ||
      request.version !== 1 || typeof request.requestId !== 'string' || !request.requestId || Buffer.byteLength(request.requestId) > 200 ||
      !Number.isSafeInteger(request.maxNativeTurns) || request.maxNativeTurns < 1 || request.maxNativeTurns > 100 ||
      !request.binding || typeof request.binding !== 'object' || Array.isArray(request.binding) || Object.keys(request.binding).length < 1 || Object.keys(request.binding).length > 16 ||
      Object.entries(request.binding).some(([key, value]) => !/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key) || typeof value !== 'string' || !value || Buffer.byteLength(value) > 1024) ||
      !request.schema || typeof request.schema !== 'object' || Array.isArray(request.schema) || request.schema.type !== 'object')
    throw Error('BRIDGE_STRUCTURED_REQUEST_UNAVAILABLE');
  return freeze({ request, requestDigest: digest(request), schemaDigest: digest(request.schema) });
}
export function assertSameStructuredOutput(actual: CapturedStructuredOutput | undefined, expected: CapturedStructuredOutput | undefined): void {
  if (actual?.requestDigest !== expected?.requestDigest) throw Error('BRIDGE_STRUCTURED_CONTINUATION_MISMATCH');
}
