import type { Tool } from '@earendil-works/pi-ai';
type ObjectSchema = Record<string, any>;
const unavailable = (): never => { throw new Error('BRIDGE_HOST_PROVIDER_SCHEMA_UNSUPPORTED'); };
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const object = (value: unknown): value is ObjectSchema => !!value && typeof value === 'object' && !Array.isArray(value);
const forbiddenContext = new Set(['$ref', '$dynamicRef', '$recursiveRef', '$id', '$anchor', '$dynamicAnchor', '$recursiveAnchor', '$defs', 'definitions', '$schema']);
/** Metadata-only finite two-closed-object/presence-pair lowering. Never changes Pi's registry schema. */
export function hostedProviderParameters(parameters: Tool['parameters']): Tool['parameters'] {
  if (!object(parameters)) return unavailable();
  if (!['anyOf', 'oneOf', 'allOf'].some(key => own(parameters, key))) return parameters;
  let count = 0;
  const clone = (value: any, depth = 0): any => {
    if (++count > 4096 || depth > 32) return unavailable();
    if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : unavailable();
    if (Array.isArray(value)) {
      if (value.length > 256) return unavailable();
      return Array.from({ length: value.length }, (_, index) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !own(descriptor, 'value')) return unavailable();
        return clone(descriptor.value, depth + 1);
      });
    }
    if (!object(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return unavailable();
    const result = Object.create(null);
    for (const key of Object.keys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !own(descriptor, 'value') || forbiddenContext.has(key)) return unavailable();
      Object.defineProperty(result, key, { value: clone(descriptor.value, depth + 1), enumerable: true, writable: true, configurable: true });
    }
    return result;
  };
  const root = clone(parameters) as ObjectSchema;
  if (Buffer.byteLength(JSON.stringify(root)) > 128 * 1024 || root.type !== 'object' ||
      Object.keys(root).some(key => !['type', 'anyOf', 'title', 'description', '$comment'].includes(key)) ||
      ['title', 'description', '$comment'].some(key => own(root, key) && typeof root[key] !== 'string') ||
      !Array.isArray(root.anyOf) || root.anyOf.length !== 2) return unavailable();
  const branches = root.anyOf as ObjectSchema[];
  for (const branch of branches) {
    if (!object(branch) || branch.type !== 'object' || branch.additionalProperties !== false ||
        Object.keys(branch).some(key => !['type', 'properties', 'required', 'additionalProperties'].includes(key)) ||
        !object(branch.properties) || !Array.isArray(branch.required) ||
        branch.required.some((key: unknown) => typeof key !== 'string' || !own(branch.properties, key)) ||
        new Set(branch.required).size !== branch.required.length || Object.keys(branch.properties).length > 64) return unavailable();
  }
  const [small, large] = [...branches].sort((a, b) => Object.keys(a.properties).length - Object.keys(b.properties).length);
  const shared = Object.keys(small.properties), largeKeys = Object.keys(large.properties);
  if (shared.length >= largeKeys.length || shared.some(key => !own(large.properties, key) ||
      JSON.stringify(small.properties[key]) !== JSON.stringify(large.properties[key]))) return unavailable();
  const added = largeKeys.filter(key => !own(small.properties, key));
  if (added.length !== 2 || added.some(key => !large.required.includes(key)) ||
      JSON.stringify([...small.required].sort()) !== JSON.stringify(large.required.filter((key: string) => own(small.properties, key)).sort())) return unavailable();
  const result: ObjectSchema = Object.create(null);
  for (const key of Object.keys(root).filter(key => key !== 'anyOf'))
    Object.defineProperty(result, key, { value: root[key], enumerable: true, writable: true, configurable: true });
  Object.defineProperties(result, {
    properties: { value: large.properties, enumerable: true },
    required: { value: [...small.required], enumerable: true },
    additionalProperties: { value: false, enumerable: true },
    dependentRequired: { value: Object.fromEntries(added.map(key => [key, added.filter(other => other !== key)])), enumerable: true },
  });
  return result as unknown as Tool['parameters'];
}
