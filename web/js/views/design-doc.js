// The Design doc page (Unreleased, frame 28d): the environment's document as a page "like Confluence". Reader view with a sticky "On this page" outline,
// View | Edit switches to the editor (the rich-text editor of Notes, with the "/" menu), History opens the versions. "Dock beside work" puts the same
// document in the right column of Flows and System map (notes/dock.js) and goes back to those pages.

import { h } from '../dom.js';
import { state } from '../state.js';
import { go } from '../router.js';
import { icon } from '../icons.js';
import { createDesignDoc } from '../notes/design-doc.js';
import { setDocked } from '../notes/dock-state.js';

export async function render({ main }) {
  const doc = createDesignDoc({ env: state.env }), c = doc.controls;
  const pillSlot = h('span.dd-pill'), below = h('div.dd-below');
  const dock = h('button.btn.sm', { type: 'button', 'data-qa': 'dd-dock', title: 'Show the document beside the flows, in the right column', on: { click: () => { setDocked(state.env, true); go('/flows'); } } }, icon('book'), ' Dock beside work');
  const bar = h('div.dd-bar', h('h1', icon('book'), 'Design doc'), c.history, dock, c.meta, h('span.dd-sp'), c.tools, c.seg, pillSlot);
  main.append(h('div.content.flush', h('div.dd-page', bar, below, h('div.dd-body', { 'data-qa': 'dd-body' }, doc.el))));
  return { designHost: { pill: pillSlot, mode: h('span'), below }, dispose: () => doc.dispose() };
}
