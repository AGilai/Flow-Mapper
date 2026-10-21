// Components copy: bring the channels (topics, queues, exchanges, buses) the picked components use, the routing out of them,
// and the bindings that connect two copied items (core/channels-for.ts decides which), even when an unpicked service,
// usually an infra service or a consumer, declares them. They are stored under ONE synthetic `infra` service named
// "<source>-infra" (no groupPath), not under their original owners: that keeps the copy self-contained without dragging
// the owners' other entities in, and an `infra` service is already how the map, the inventory and the link checks treat
// "a service that only declares channels". Their rows are in baseline_items too, so they read as unchanged.

import { channelsFor } from '../../core/channels-for.ts';
import type { CopyCtx } from './env-copy-rows.ts';
import { loadModel } from './snapshots-read.ts';
import { writeChangelog } from './snapshots-write.ts';

/** "<source>-infra", numbered when a service of the source already has that name. */
function ownerName(c: CopyCtx): string {
  const taken = new Set((c.db.prepare('SELECT service FROM snapshots WHERE env = ?').all(c.from) as { service: string }[]).map((r) => r.service));
  let name = `${c.from}-infra`;
  for (let i = 2; taken.has(name); i++) name = `${c.from}-infra-${i}`;
  return name;
}

const strip = ({ service: _s, ...rest }: any) => rest;

export function copySharedChannels(c: CopyCtx, picked: Set<string>) {
  const { bring, bindings } = channelsFor(loadModel(c.db, c.from), picked);
  const items = [
    ...bring.map((ch) => ({ list: 'channels', key: ch.bindKey, data: strip(ch) })),
    // ids are per service in the source; under one owner they are prefixed with the declaring service
    ...bindings.map((b) => ({ list: 'bindings', key: `${b.service}.${b.id}`, data: { ...strip(b), id: `${b.service}.${b.id}` } })),
  ];
  if (!items.length) return null;

  const name = ownerName(c);
  const description = `Channels and bindings the copied components use, declared by other services in ${c.from}.`;
  c.db.prepare('INSERT INTO snapshots (env, service, kind, meta, version, harvested_at, commit_sha, updated_at) VALUES (?, ?, ?, ?, 1, ?, NULL, ?)')
    .run(c.to, name, 'infra', JSON.stringify({ description }), c.at, c.at);
  const ins = c.db.prepare('INSERT INTO entities (env, service, list, key, data) VALUES (?, ?, ?, ?, ?)');
  const base = c.db.prepare('INSERT OR REPLACE INTO baseline_items (env, service, list, key, data, source_env, source_version, taken_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)');
  base.run(c.to, name, 'header', '', JSON.stringify({ kind: 'infra', description }), c.from, c.at);
  for (const i of items) {
    ins.run(c.to, name, i.list, i.key, JSON.stringify(i.data));
    base.run(c.to, name, i.list, i.key, JSON.stringify(i.data), c.from, c.at);
  }
  writeChangelog(c.db, c.to, name, null, 1, 'copy', 'api', { copiedFrom: c.from, channels: bring.length, bindings: bindings.length });
  return { owner: name, channels: bring.length, bindings: bindings.length };
}
