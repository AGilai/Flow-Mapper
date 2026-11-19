// The View menu's rules, pure (frame 28): which options differ from their defaults (the count on the button) and the stored choices of the
// caption bar, the Read / Write legend and "Hide text". Storage is wrapped in try/catch; without it the defaults apply. No DOM.

import { readKey, writeKey, SIZE_DEFAULT } from './flow-info-pure.js';
import { BAR_DEFAULT } from './step-details-pure.js';

/** The call notes bar and the legend are on unless the viewer turned them off (`flow-mapper.flow-caption2`, `flow-mapper.flow-legend`: '0' = off). The bar's key was renamed from `flow-caption` in Unreleased so a bar hidden with the old × comes back once. */
export const captionOn = (st) => readKey('flow-caption2', st) !== '0';
export const captionSave = (on, st) => writeKey('flow-caption2', on ? '1' : '0', st);
export const legendOn = (st) => readKey('flow-legend', st) !== '0';
/** #135: "Show coverage warnings" (the open-ends chips of the Flows list and the trace header) is on unless the viewer turned it off (`flow-mapper.coverage-warn`: '0' = off). */
export const coverageOn = (st) => readKey('coverage-warn', st) !== '0';
export const coverageSave = (on, st) => writeKey('coverage-warn', on ? '1' : '0', st);
export const legendSave = (on, st) => writeKey('flow-legend', on ? '1' : '0', st);

/**
 * The options that differ from their default, as a list of names (its length is the count on the View button).
 * o: { bands (null when the environment has no subsystems), stores, frontier, merge, squeeze, order, hints, hintsDefault, depth, sb, sd, sdDefault, size, hideText, caption, legend, coverage }.
 */
export function nonDefault(o) {
  const out = [];
  if (o.bands === false) out.push('Group by subsystem');
  if (o.stores === false) out.push('Data stores');
  if (o.frontier === true) out.push('Frontier');
  if (o.merge === false) out.push('One arrow per target');
  if (o.order === 'calls') out.push('Order');
  if (o.colour === 'component') out.push('Colour by'); // frame 31: Domain is the default when the environment has groups
  if (o.squeeze === false) out.push('Squeeze');
  if (!!o.hints !== !!o.hintsDefault) out.push('Transport hints');
  if (o.depth && o.depth !== 'all') out.push('Depth');
  if ((o.sb ?? BAR_DEFAULT) !== BAR_DEFAULT || (o.sd ?? o.sdDefault) !== o.sdDefault) out.push('Step details');
  if ((o.size ?? SIZE_DEFAULT) !== SIZE_DEFAULT) out.push('Text size');
  if (o.hideText) out.push('Hide text');
  if (o.caption === false) out.push('Call notes');
  if (o.legend === false) out.push('Legend');
  if (o.coverage === false) out.push('Coverage warnings');
  return out;
}
