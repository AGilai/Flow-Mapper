// The DTO form's content box, pure: JSON with an inline error, and whether it is a JSON Schema (then its field table shows).

/** Parse the content box (pure): the value, or an error with its field. */
export function parseContent(text) {
  try { return JSON.parse(text); } catch (e) { throw Object.assign(new Error(`Not valid JSON: ${e.message}`), { field: 'content' }); }
}
export const looksLikeSchema = (v) => !!v && typeof v === 'object' && !Array.isArray(v) && !!(v.properties || v.type) && typeof v.type !== 'object';
