// A DesignEdit (what an edit form sends) as the ops that make it. Pure: REST, MCP and the preview all call this with the rows of the
// draft's overlay. Throws EditError {code, message, field?}.

import type { DraftOpInput } from './draft-ops.ts';
import { callOps, deleteCallOps } from './edit-calls.ts';
import { componentOps, deleteOps, dtoOps, endpointOps, flowOps } from './edit-forms.ts';
import { functionOps } from './edit-links.ts';
import { EditError, indexRows, type DesignEdit } from './edit-kit.ts';
import type { ItemRow } from './item-rows.ts';

export type { DesignEdit, EndpointEdit } from './edit-kit.ts';
export { EditError } from './edit-kit.ts';

export function designEditOps(edit: DesignEdit, rows: ItemRow[]): DraftOpInput[] {
  const x = indexRows(rows);
  switch (edit?.kind) {
    case 'component': return componentOps(edit, x);
    case 'endpoint': return endpointOps(edit, x);
    case 'call': return callOps(edit, x);
    case 'delete-call': return deleteCallOps(edit, x);
    case 'flow': return flowOps(edit, x);
    case 'function': return functionOps(edit, x);
    case 'dto': case 'event-dto': return dtoOps(edit, x);
    case 'delete': return deleteOps(edit, rows, x);
    default: throw new EditError('INVALID', `edit.kind must be one of component, endpoint, function, call, delete-call, flow, dto, event-dto, delete`, 'kind');
  }
}

/** What an edit could not do, said in words (not an error). */
export function editWarnings(edit: DesignEdit): string[] {
  return edit?.kind === 'call' && edit.description ? ['the description of one call is not stored (callee descriptions are a separate store): ignored'] : [];
}
