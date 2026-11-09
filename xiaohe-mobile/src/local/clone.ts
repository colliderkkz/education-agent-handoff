/** Workspace data is JSON-only. Avoid depending on structuredClone in Hermes. */
export function cloneData<T>(value: T): T {
  if (value === undefined || value === null) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}
