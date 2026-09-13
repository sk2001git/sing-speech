/**
 * Fold the wire's key/value list back into a record.
 *
 * Neither provider can be trusted to express an open-ended map in a structured-output
 * schema — Gemini rejects `additionalProperties` outright — so slots travel as an array
 * of `{key, value}`. This is the only place that knows about that. Both the Gemini
 * provider and the relayed realtime understanding pass through it before validation.
 */
export function foldSlots(raw: unknown): unknown {
	if (typeof raw !== 'object' || raw === null) return raw;
	const obj = raw as Record<string, unknown>;
	if (!Array.isArray(obj.slots)) return obj;

	const slots: Record<string, string> = {};
	for (const entry of obj.slots) {
		if (entry && typeof entry === 'object' && 'key' in entry && 'value' in entry) {
			const { key, value } = entry as { key: unknown; value: unknown };
			if (typeof key === 'string' && typeof value === 'string') slots[key] = value;
		}
	}
	return { ...obj, slots };
}
