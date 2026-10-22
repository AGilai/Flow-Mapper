// Who is acting: the user this browser is signed in as (users/directory.js), else 'anonymous'.

import { myName } from '../users/directory.js';

export const me = () => myName() || 'anonymous';

/** "A", "A and B", "A, B and C". */
export const names = (list) => (list.length < 2 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`);

/** The delta of a draft as the bar shows it: "+4 −0 ~1". */
export const deltaText = (c) => `+${c.added} −${c.removed} ~${c.changed}`;
