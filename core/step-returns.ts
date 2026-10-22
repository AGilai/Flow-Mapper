// What a call returns (0.33.2, #81): an optional step field `returns: {label, detail?}`. The label is drawn on the dashed return arrow (without it the arrow says "return"),
// the detail shows in the step panel and as the arrow's tooltip. Plain text only. Pure.

export const MAX_RETURN_LABEL = 80;
export const MAX_RETURN_DETAIL = 500;
export interface StepReturns { label: string; detail?: string }

/** The problem with a stored `returns` value, or null (undefined and null are fine: nothing returned is said). */
export function returnsProblem(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'object' || Array.isArray(v)) return 'returns is {label, detail?}';
  const { label, detail, ...rest } = v as Record<string, unknown>;
  if (Object.keys(rest).length) return `returns has no '${Object.keys(rest)[0]}' (it is {label, detail?})`;
  if (typeof label !== 'string' || !label.trim() || label.length > MAX_RETURN_LABEL) return `returns.label is 1 to ${MAX_RETURN_LABEL} characters`;
  if (/[\u0000-\u001f]/.test(label)) return 'returns.label is plain text on one line';
  if (detail !== undefined && (typeof detail !== 'string' || detail.length > MAX_RETURN_DETAIL)) return `returns.detail is plain text, up to ${MAX_RETURN_DETAIL} characters`;
  return null;
}

/** Stored form: trimmed label, detail only when it has text. */
export const cleanReturns = (v: StepReturns): StepReturns => ({ label: v.label.trim(), ...(typeof v.detail === 'string' && v.detail.trim() ? { detail: v.detail.trim() } : {}) });
