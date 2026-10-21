// The small pure rules of the comments UI (0.27.0), apart from the DOM so a node test can load them.

/** "just now", "12 min ago", "3 h ago", "yesterday", "5 days ago", then the date. */
export function relTime(iso, now = Date.now()) {
  const s = (now - Date.parse(iso)) / 1000;
  if (!Number.isFinite(s)) return '';
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  if (d === 1) return 'yesterday';
  return d < 14 ? `${d} days ago` : new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** The full date, for a tooltip. */
export const fullDate = (iso) => { try { return new Date(iso).toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' }); } catch { return iso; } };

/** "Asaf G." -> "AG", "dana" -> "D", "" -> "?". */
export const initials = (n) => String(n ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => [...w][0].toUpperCase()).join('') || '?';

/** What a person types as an address becomes an http(s) one: "wiki.example/x" gets https://; anything with another scheme stays (and is refused by safeHref). */
export const addressOf = (t) => { const s = String(t).trim(); return /^[a-z][a-z0-9+.-]*:/i.test(s) || s.startsWith('//') ? s : /^[^\s/]+\.[^\s/]+/.test(s) ? `https://${s}` : s; };

/** Plain paragraphs to HTML: blank lines separate paragraphs, single newlines are line breaks (the caller escapes: it passes its own `esc`). */
export const textToHtml = (t, esc) => String(t).replace(/\r\n?/g, '\n').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');

/** Whether the Comments section starts open once its thread is loaded: an empty one starts collapsed to its header, unless a comment is attached to the step the viewer arrived on (a step deep-link); otherwise the remembered state. */
export const startsOpen = ({ count, remembered, stepKey = null, comments = [] }) => (!count ? false : remembered || (stepKey != null && comments.some((c) => c.step === stepKey || c.replies?.some((r) => r.step === stepKey))));
