// After a draft edit or an import: forget the marks and draw the page again (one marks request, the open traces trace again). Never on a step walk.

import { invalidateMarks } from './marks-store.js';
import { setDesign } from '../state.js';

export function afterEdit() {
  invalidateMarks();
  setDesign({});
}
