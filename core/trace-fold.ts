// Repeated internal callees (#90), pure. A call step to a function already expanded earlier in the trace (same service, same function, same bound
// values) is one line `<fn> ↩ seen at step N` (`repeatOf: N`), the way a repeated delivery is (#43). The earlier expansion is reused only when
// every either/or arm it sat in is on the later call's path (#82); otherwise the callee expands again. Recursion stays a cycle marker.

export type Expansions = Map<string, { n: number; path: string[] }[]>;

/** The key of an internal expansion: the callee plus what changes what it draws, the values bound on the way down (#42) and the fixes in force (a fixed arm hides its sibling, #82). */
export const callKey = (service: string, fn: string, binds: ReadonlyMap<string, { value: string }>, fixes: ReadonlyMap<string, { arm: string }>) =>
  `call|${service}:${fn}|${[...binds].map(([k, b]) => `${k}=${b.value}`).join(',')}|${[...fixes].map(([g, x]) => `${g}:${x.arm}`).join(',')}`;

/** The step number of the earlier expansion `path` may reuse, if any. */
export const firstExpansion = (seen: Expansions, key: string, path: string[]) => seen.get(key)?.find((e) => e.path.every((a) => path.includes(a)))?.n;

export const noteExpansion = (seen: Expansions, key: string, n: number, path: string[]) => { seen.set(key, [...(seen.get(key) ?? []), { n, path }]); };
