// #99: a socket push into a client app (an agent). The agent's code is not harvested, so the ingress has no handler and the trace ends at it.

import type { Egress, Ingress, Model } from './types.ts';

/** The shape alone (no model): a socket ingress with `entryPoint: false`, `details.direction: push` and no handler. */
export const pushShape = (i: Pick<Ingress, 'transport' | 'entryPoint' | 'details' | 'handler'>): boolean => i.transport === 'socket' && i.entryPoint === false && i.details?.direction === 'push' && !i.handler;

/** A socket ingress of a `client-app` service with `details.direction: "push"` (and `entryPoint: false`): a server push to a device, not a flow start. */
export const isClientPush = (model: Pick<Model, 'services'>, i: Ingress): boolean =>
  i.transport === 'socket' && i.entryPoint === false && i.details?.direction === 'push' && model.services.some((s) => s.name === i.service && s.kind === 'client-app');

/** The event names of a gap egress message: `events`, else `details.event`; every transport. */
export const eventNames = (e?: Pick<Egress, 'events' | 'details'>): string[] => {
  const own = e?.events?.length ? e.events : e?.details?.event ? [String(e.details.event)] : [];
  return [...new Set(own)];
};

/** The gap text with its event names in front (not repeated when the detail already starts with the first one). */
export function gapLabel(text: string, names: string[]): string {
  if (!names.length) return text;
  return text.startsWith(names[0]) ? text : `${names.join(', ')} → ${text}`;
}

/** The names for a gap message: the egress's, else the step's own event. */
export const gapNames = (e: Pick<Egress, 'events' | 'details'> | undefined, stepEvent?: string): string[] => { const n = eventNames(e); return n.length ? n : stepEvent ? [stepEvent] : []; };

/** Plain event names on an ingress (`events: ["X"]`, allowed for a push) are stored as `{type: "X"}`, the shape every reader knows. Same manifest back when there are none. */
export function pushEventsAsObjects<T extends { ingress?: any[]; upsert?: { ingress?: any[] } }>(m: T): T {
  const fix = (list?: any[]) => list?.some((i) => i.events?.some((e: unknown) => typeof e === 'string'))
    ? list.map((i) => (i.events ? { ...i, events: i.events.map((e: unknown) => (typeof e === 'string' ? { type: e } : e)) } : i)) : list;
  const a = fix(m.ingress), b = fix(m.upsert?.ingress);
  if (a === m.ingress && b === m.upsert?.ingress) return m;
  return { ...m, ...(a ? { ingress: a } : {}), ...(b ? { upsert: { ...m.upsert, ingress: b } } : {}) };
}
