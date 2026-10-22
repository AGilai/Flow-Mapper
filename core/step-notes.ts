// What a resource step says about details it did not read or filled by a rule, as fields of its trace message:
// `unknown` (`unresolved` what=detail, #45) and `assumed` (#47). Pure.

import { assumedField } from './assumed.ts';
import { accessOf } from './access.ts';
import type { Resource, Step } from './types.ts';

/** A resource step's `unresolved` what=detail entries (details.keyTemplate, details.dbIndex, details.ttlSeconds) as `unknown` on its message. */
export const unknownOn = (st: Step) => {
  const u = (st.unresolved ?? []).filter((x) => x.what === 'detail' && x.detail?.trim()).map((x) => ({ field: x.detail!.trim().replace(/^details\./, ''), reason: x.reason }));
  return u.length ? { unknown: u } : {};
};

/** A resource step's `assumed` entries (#47): details it filled by a rule, as `assumed` on its message (field without `details.`). */
export const assumedOn = (st: Step) => {
  const a = (st.assumed ?? []).filter((x) => assumedField(x)).map((x) => ({ field: assumedField(x).replace(/^details\./, ''), value: x.value, basis: x.basis, reason: x.reason }));
  return a.length ? { assumed: a } : {};
};
import type { GraphIndex } from './graph-index.ts';
import { resourceOwner } from './resource-owner.ts';

/** A resource step's driver and access (0.27.1), as `storeKind` and `access` on its message: the flow drawing's line weight and head wording. */
/** 0.30.1: and `owner`, the component that declares the store (resource-owner.ts), for the flow view's subsystem band. */
export const storeOn = (st: Step, r?: Resource, g?: GraphIndex) => ({ storeKind: r?.kind, access: accessOf(st), owner: r && g ? resourceOwner(g, r.bindKey) ?? r.service : undefined });
