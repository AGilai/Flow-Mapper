// The `order` argument of the trace and Mermaid reads (#138): 'subsystem' (default, undefined) or 'calls'; anything else is a 400.
import { orderParam } from '../core/trace-view-params.ts';
import { badRequest } from './errors.ts';

export function orderArg(v: unknown): 'subsystem' | 'calls' | undefined {
  try { return orderParam(v); } catch (e) { throw badRequest((e as Error).message); }
}
