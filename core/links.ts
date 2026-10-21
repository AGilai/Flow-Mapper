// `links` (0.25.1, #54): where to read more about a component, endpoint, function or flow. {main?: {label, url}, sub?: [{label, url}]}.
// Manifests check them through the schema (`$defs/links`); flows and edit forms through `checkLinks`, the same rules.

export interface Link { label: string; url: string }
export interface Links { main?: Link; sub?: Link[] }
export const RUNTIMES = ['k8s-pod', 'k8s-deployment', 'k8s-daemonset', 'k8s-operator', 'k8s-job'] as const;

const URL_RE = /^https?:\/\/\S+$/;
const one = (l: unknown, at: string): string | null => {
  if (!l || typeof l !== 'object' || Array.isArray(l)) return `${at} must be {label, url}`;
  const { label, url, ...rest } = l as Record<string, unknown>;
  if (Object.keys(rest).length) return `${at} has unknown property '${Object.keys(rest)[0]}'`;
  if (typeof label !== 'string' || !label.trim()) return `${at}.label is required`;
  if (label.length > 120) return `${at}.label is at most 120 characters`;
  if (typeof url !== 'string' || !URL_RE.test(url)) return `${at}.url must be an http or https URL`;
  return null;
};

/** The first problem with a `links` value, or null. */
export function checkLinks(v: unknown, at = 'links'): string | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return `${at} must be {main?, sub?}`;
  const { main, sub, ...rest } = v as Record<string, unknown>;
  if (Object.keys(rest).length) return `${at} has unknown property '${Object.keys(rest)[0]}'`;
  if (main !== undefined) { const e = one(main, `${at}.main`); if (e) return e; }
  if (sub !== undefined) {
    if (!Array.isArray(sub)) return `${at}.sub must be a list`;
    if (sub.length > 20) return `${at}.sub has at most 20 links`;
    for (let i = 0; i < sub.length; i++) { const e = one(sub[i], `${at}.sub[${i}]`); if (e) return e; }
  }
  return null;
}

/** Trim labels; an empty `links` is no links (undefined). Call after `checkLinks`. */
export function cleanLinks(v: Links | null | undefined): Links | undefined {
  if (!v) return undefined;
  const t = (l: Link): Link => ({ label: l.label.trim(), url: l.url });
  const out: Links = { ...(v.main ? { main: t(v.main) } : {}), ...(v.sub?.length ? { sub: v.sub.map(t) } : {}) };
  return out.main || out.sub ? out : undefined;
}
