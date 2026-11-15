// A draft is private to its author until shared (accounts). The author gets one toggle in the draft bar: "Private to you" / "Shared with editors".

import { h } from '../dom.js';
import { api } from '../api.js';
import { state } from '../state.js';
import { account, isCognito } from '../account.js';
import { icon } from '../icons.js';

/** null unless the server has accounts and the draft is the signed-in user's. */
export function draftShare(draft) {
  if (!isCognito() || !draft.ownerId || draft.ownerId !== account.user?.id) return null;
  return h('button.btn.sm.ac-dshare', { type: 'button', 'data-qa': 'draft-share', 'aria-pressed': String(draft.shared), title: draft.shared ? "Shared: the environment's editors can see and edit this draft. Click to make it private again." : "Private to you. Click to share it with the environment's editors.",
    on: { click: async () => { try { await api.shareDraft(state.env, draft.slug, !draft.shared); } finally { dispatchEvent(new HashChangeEvent('hashchange')); } } } },
    icon(draft.shared ? 'people' : 'lock'), draft.shared ? 'Shared with editors' : 'Private to you');
}
