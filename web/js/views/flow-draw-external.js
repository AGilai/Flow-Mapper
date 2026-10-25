// External services (#87) on a lane head: a modifier class (dashed grey box, muted fill: css/external.css) and the "external" tag
// under the head. Kept apart from flow-draw-heads.js on purpose; the head code only calls these two helpers.

import { s } from '../dom.js';
import { INT_H } from './flow-draw-layout.js';

/** The modifier class for a head: ' ext' on an external service lifeline, else ''. */
export const externalCls = (c) => (c.kind === 'service' && c.external ? ' ext' : '');

/** The tag under an external service head (real text: read after the name as "<name>, external"); null otherwise. */
export function externalTag(c, boxW, boxH) {
  if (!externalCls(c)) return null;
  const w = 'external'.length * 6.2 + 14;
  return s('g', { class: 'ext-pill', transform: `translate(${boxW / 2 - w / 2},${boxH + 3})` },
    s('rect', { width: w, height: INT_H, rx: INT_H / 2 }), s('text', { x: w / 2, y: INT_H - 4, 'text-anchor': 'middle' }, 'external'),
    s('title', {}, `${c.label}: an external (third-party) service. Its internals are not mapped.`));
}
