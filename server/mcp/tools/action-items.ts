// Action items under a flow for agents: read them, add one, change one. Annotations like comments: any environment, sealed ones included.
// MCP writes are stored with source 'ai' (the UI shows a "by AI" chip).

import { flowAnchor } from '../../../core/comments.ts';
import { listItems, addItem, updateItem } from '../../store/action-items.ts';
import { ASSISTANT } from '../../identity.ts';
import { type Tool, env, obj, envOf, draftArg } from './common.ts';

const status = { type: 'string', enum: ['open', 'progress', 'done', 'dropped'], description: 'open | progress | done | dropped' };
const ingress = { type: 'string', description: 'Ingress id of the flow entry' };

export const listActionItemsTool: Tool = {
  name: 'list_action_items',
  description: "The action items under a flow (service + ingress): number, owner, description, status (open | progress | done | dropped), due (YYYY-MM-DD or null), step key, the commentId it was made from, source (human | ai), who created and last changed it, and the events (created, closed, reopened, dropped). Open = open + progress. Read only.",
  inputSchema: obj({ env, service: { type: 'string' }, ingress, draft: draftArg }, ['service', 'ingress']),
  run: (c, a) => { const l = listItems(c.db, envOf(a), flowAnchor(a.service, a.ingress)); return { anchor: flowAnchor(a.service, a.ingress), open: l.items.filter((i) => i.status === 'open' || i.status === 'progress').length, count: l.items.length, ...l }; },
};

export const addActionItemTool: Tool = {
  name: 'add_action_item',
  description: "Add an action item under a flow. owner: who does it (1-80 characters). description: plain text, 1-2000 characters. status: default open. due: YYYY-MM-DD. step: a step key (#step:...) from the flow's trace. commentId: the comment it was made from (same flow). author: your name (recorded as the creator; default \"Assistant\"). owner and author are matched to users (created when new). Works in any environment. draft: an open draft, for a flow that exists only there.",
  inputSchema: obj({ env, service: { type: 'string' }, ingress, owner: { type: 'string' }, description: { type: 'string' }, status, due: { type: 'string' }, step: { type: 'string' }, commentId: { type: 'integer' }, author: { type: 'string' }, draft: draftArg }, ['service', 'ingress', 'owner', 'description']),
  run: (c, a) => { const e = envOf(a); return addItem(c.db, c.view(e, a.draft || null).g, e, { anchor: flowAnchor(a.service, a.ingress), owner: a.owner, description: a.description, status: a.status, due: a.due, step: a.step ?? null, commentId: a.commentId ?? null, actor: a.author ?? ASSISTANT, source: 'ai' }); },
};

export const updateActionItemTool: Tool = {
  name: 'update_action_item',
  description: "Change an action item by id (from list_action_items): owner, description, status, due (null clears), step (null clears). Anyone may change any field; author (default \"Assistant\") is recorded as the last editor. A status change across open/closed adds an event. There is no delete over MCP.",
  inputSchema: obj({ env, id: { type: 'integer' }, author: { type: 'string' }, owner: { type: 'string' }, description: { type: 'string' }, status, due: { type: ['string', 'null'] }, step: { type: ['string', 'null'] }, draft: draftArg }, ['id']),
  run: (c, a) => { const e = envOf(a); return updateItem(c.db, c.view(e, a.draft || null).g, e, a.id, { actor: a.author ?? ASSISTANT, owner: a.owner, description: a.description, status: a.status, due: a.due, step: a.step }); },
};
