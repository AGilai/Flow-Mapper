// Who is acting. There is no login: the name is whatever this browser remembers (localStorage 'fm:author'), else 'anonymous'.

export const me = () => { try { return localStorage.getItem('fm:author') || 'anonymous'; } catch { return 'anonymous'; } };

/** "A", "A and B", "A, B and C". */
export const names = (list) => (list.length < 2 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`);

/** The delta of a draft as the bar shows it: "+4 −0 ~1". */
export const deltaText = (c) => `+${c.added} −${c.removed} ~${c.changed}`;
