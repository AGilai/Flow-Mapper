// What the Flows page loads about its own (current) environment for the entry-point list: points with their flow names, counts of flows,
// comments, action items, @mentions and relations, and the component list. Tabs of other environments load theirs through flow-env-ctx.js.

import { api } from '../api.js';
import { currentId } from '../users/me.js';
import { relCounts } from './flow-relations-pure.js';

/** loadListData(env, service, design) -> { points, counts, cmts, acts, ments, relBy, names (Map `service/ingress` -> name), svcs }. `service`: only that component's ingress. */
export async function loadListData(env, service, design) {
  const points = service
    ? (await api.service(env, service)).ingress.map((i) => ({ service, id: i.id, bindKey: i.bindKey, transport: i.transport, handler: i.handler, entryPoint: i.entryPoint }))
    : await api.entryPoints(env);
  const counts = new Map((await api.flowCounts(env).catch(() => [])).map((c) => [`${c.service}:${c.ingress}`, c]));
  const cmts = await api.commentCounts(env).catch(() => ({})); // comments per flow, for the 💬 count of the list
  const acts = await api.actionCounts(env).catch(() => ({})); // open action items per flow, for the list's badge
  const ments = currentId() ? await api.mentionCounts(env, currentId()).catch(() => ({})) : {}; // unread @mentions of the signed-in user per flow ("@ n new")
  const relBy = relCounts(design ? await api.flowRelations(env).catch(() => []) : []); // 0.28.2: relations per flow, for the list's badge and filter
  const names = new Map((await api.flowNames(env).catch(() => [])).map((n) => [`${n.service}/${n.ingress}`, n.name]));
  points.forEach((p) => { p.name ||= names.get(`${p.service}/${p.id}`) ?? ''; });
  const svcs = await api.services(env).catch(() => []);
  return { points, counts, cmts, acts, ments, relBy, names, svcs };
}
