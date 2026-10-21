// Read or write access of a data-store step. Pure; shared by the store pages (stores.ts) and the trace (trace.ts).

import type { Step } from './types.ts';

export type Access = 'read' | 'write' | 'read_write' | 'unknown';

const READ = /^(get|mget|hget|hgetall|hmget|exists|ttl|pttl|keys|scan|smembers|sismember|lrange|zrange|zscore|find|findone|count|countdocuments|aggregate|distinct|query|select|read|list|head|headobject|getobject|getitem|batchgetitem|describe)\b/i;

/** Read or write, from the step's `access` or else its operation's first word. */
export function accessOf(step: Step): Access {
  if (step.access) return step.access;
  const op = step.operation?.trim();
  if (!op) return 'unknown';
  return READ.test(op) ? 'read' : 'write';
}
