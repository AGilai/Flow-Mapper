// The step markers of the Loader's rule change (0.38.1, #82 comment 225) as lines of text, for the Mermaid export (pure). The page's tag, tooltip
// and run grouping are web/js/views/flow-markers-pure.js.

import type { CanFail, OnlyWhen } from './step-marks.ts';

/** `can fail: <error> (when <when>); ...` */
export const canFailLine = (l: CanFail[]): string => `can fail: ${l.map((c) => c.error + (c.when ? ` (when ${c.when})` : '')).join('; ')}`;
export const onlyWhenLine = (o: OnlyWhen): string => `only when ${o.guard}`;
