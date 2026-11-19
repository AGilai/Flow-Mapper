// Reader tools that mirror web reads: flows through components, and one-hop neighbours. Same functions as the REST routes.

import { HttpError } from '../../errors.ts';
import { flowsThroughOut } from '../../refs.ts';
import { neighbours } from '../../../core/neighbours.ts';
import { type Tool, env, obj, envOf, draftArg, viewOf } from './common.ts';

const servicesArg = { type: ['array', 'string'], items: { type: 'string' }, description: 'Component (service) names: an array, or one name / a comma-separated string' };
/** `services` (array or comma string) and the single `service` alias, trimmed; at least one. */
const namesOf = (a: any): string[] => {
  const raw = [a.services, a.service].flatMap((v) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []));
  const out = raw.map((s) => String(s).trim()).filter(Boolean);
  if (!out.length) throw new HttpError(400, 'BAD_REQUEST', 'services is required (one name or an array of names)');
  return out;
};

export const flowsThroughTool: Tool = {
  name: 'flows_through',
  description: "The entry-point rows (as list_entry_points) whose flows run through, or start in, any of the listed components: the info pane's \"Flows through it\". Rows are in list_entry_points order with name, summary and coverage.",
  inputSchema: obj({ draft: draftArg, env, services: servicesArg, service: { type: 'string', description: 'One component (same as services)' } }),
  run: (c, a) => flowsThroughOut(c, envOf(a), a.draft || null, namesOf(a)),
};

export const neighboursTool: Tool = {
  name: 'neighbours',
  description: "Components one hop from the listed ones: those that call them or are called by them, directly or through a topic, queue or exchange, each with its `reasons` (the New environment page's neighbours). Infra components are left out; the listed ones are not repeated.",
  inputSchema: obj({ draft: draftArg, env, services: servicesArg, service: { type: 'string', description: 'One component (same as services)' } }),
  run: (c, a) => neighbours(viewOf(c, a).g, namesOf(a)),
};
