// The caller of the running request, kept in AsyncLocalStorage so the store layer (audit rows, owners of new envs and drafts) and the MCP tools
// see it without every function taking a parameter. No store is running for a caller (scripts, stdio MCP, direct store use in tests): that reads as auth off.

import { AsyncLocalStorage } from 'node:async_hooks';

export interface Principal {
  /** The user id; null when nobody is identified (auth off without an X-Flow-User header). */
  id: string | null; name: string; admin: boolean;
  /** 'harvester' tokens may ingest into sealed environments. */
  scope: 'user' | 'harvester';
  /** off: FLOW_AUTH=off (everyone is an admin); session: browser cookie; token: personal access token. */
  via: 'off' | 'session' | 'token';
  /** The session's CSRF value (session only). */
  csrf?: string;
}

const als = new AsyncLocalStorage<Principal>();
export const runAs = <T>(p: Principal, fn: () => T): T => als.run(p, fn);
export const currentWho = (): Principal | undefined => als.getStore();
/** True when no access rules apply: auth off, or no request context at all. */
export const authOff = (): boolean => { const p = als.getStore(); return !p || p.via === 'off'; };
/** The acting user id for audit rows and owners (null when unknown). */
export const actorId = (): string | null => als.getStore()?.id ?? null;
