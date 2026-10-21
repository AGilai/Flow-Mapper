// The Links group of an edit form (#54): one main link and a repeatable list of sub links, each { label, url } (http(s) only; an empty label
// sends the URL's host). Shown only when the server is 0.25.1 or later (null removes, absent keeps, an object replaces) (it has `links`); older servers would drop the field silently.

import { h } from '../../dom.js';
import { state } from '../../state.js';
import { input } from './form-kit.js';

/** Is the running server at least `min` ("0.25.1")? An unknown version reads as no. */
export function atLeast(min, version = state.version) {
  const a = String(version ?? '').split('.').map(Number), b = min.split('.').map(Number);
  if (a.length < 3 || a.some(Number.isNaN)) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
}
export const hasLinks = () => atLeast('0.25.1');

const host = (url) => { try { return new URL(url).host; } catch { return url; } };

/** A { label, url } from the two fields; a bare URL gets its host as the label. Throws { field, message } for a non-http(s) URL. */
export function toLink(label, url, field) {
  const u = url.trim();
  if (!u) return null;
  if (!/^https?:\/\/\S+$/i.test(u)) throw Object.assign(new Error('A link starts with http:// or https://'), { field });
  return { label: label.trim() || host(u), url: u };
}

/** linksFields(fields, links) -> { get() -> links | undefined } ; registers rows `links.main` and `links.sub` on `fields` (nothing when the server has no links). */
export function linksFields(fields, links = {}) {
  if (!hasLinks()) return { get: () => undefined };
  const had = !!(links?.main || links?.sub?.length);
  const mLabel = input(links.main?.label ?? '', { placeholder: 'Label (optional)' }), mUrl = input(links.main?.url ?? '', { placeholder: 'https://…', mono: true });
  fields.field('links.main', 'Main link', h('div.f-sublinks', h('div.row', { style: { gridTemplateColumns: '1fr 1.6fr' } }, mLabel, mUrl)), 'Shown next to the title.');
  const rows = h('div.f-sublinks'), subs = [];
  const add = (l = {}) => {
    const lab = input(l.label ?? '', { placeholder: 'Label' }), url = input(l.url ?? '', { placeholder: 'https://…', mono: true });
    const rm = h('button.btn.ghost.sm', { type: 'button', 'aria-label': 'Remove this link', on: { click: () => { subs.splice(subs.findIndex((s) => s.row === row), 1); row.remove(); } } }, '×');
    const row = h('div.row', lab, url, rm);
    subs.push({ row, lab, url }); rows.append(row);
  };
  (links.sub ?? []).forEach(add);
  fields.field('links.sub', 'More links', h('div.f-sublinks', rows, h('button.pill-add', { type: 'button', on: { click: () => add() } }, '+ Add link')), 'Small chips under the title (at most 20).');
  return {
    get() {
      const main = toLink(mLabel.value, mUrl.value, 'links.main'), sub = subs.map((s) => toLink(s.lab.value, s.url.value, 'links.sub')).filter(Boolean);
      if (!main && !sub.length) return had ? null : undefined; // emptied: null removes them; never set: absent keeps the stored value
      return { ...(main ? { main } : {}), ...(sub.length ? { sub } : {}) };
    },
  };
}
