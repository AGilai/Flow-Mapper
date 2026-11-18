// Contract rule (CR #132): an ingress's `fixes` ([{group_id, arm}]) must name an alternatives group of the env and one of its arms,
// and the group should be reached by the walk from that ingress. Pure; see docs/HARVESTER-GUIDE.md ("Ingress fixes").

import { altIndex } from './alternatives.ts';
import { trace } from './trace.ts';
import type { GraphIndex } from './graph-index.ts';
import type { StepFix } from './types.ts';
import type { Finding } from './contract.ts';

export function ingressFixFindings(m: { service: string; ingress?: { id: string; fixes?: StepFix[] }[] }, g: GraphIndex, add: (f: Omit<Finding, 'service'>) => void): void {
  for (const i of m.ingress ?? []) {
    if (!Array.isArray(i.fixes) || !i.fixes.length) continue;
    const ix = altIndex(g);
    let reached: Set<string> | null = null;
    for (const x of i.fixes) {
      const group = ix?.groups.get(x.group_id);
      if (!group) {
        add({ level: 'error', code: 'ingress-fix-unknown-group', kind: 'ingress', id: i.id, message: `ingress '${i.id}' fixes group '${x.group_id}', which no step of this environment declares in \`alternatives\``, fix: 'Use the group_id of an alternatives group declared on a step of the handler tree (same string, case sensitive), or drop the fix.' });
        continue;
      }
      if (!group.arms.includes(x.arm)) {
        add({ level: 'error', code: 'ingress-fix-unknown-arm', kind: 'ingress', id: i.id, message: `ingress '${i.id}' fixes group '${x.group_id}' to arm '${x.arm}', but the group's arms are [${group.arms.join(', ')}]`, fix: "Use one of the group's arm names." });
        continue;
      }
      reached ??= new Set((trace(g, { service: m.service, ingress: i.id }, { scope: 'full', countsOnly: true })?.decisions ?? []).map((d) => d.group_id));
      if (!reached.has(x.group_id)) add({ level: 'warn', code: 'ingress-fix-unreached-group', kind: 'ingress', id: i.id, message: `ingress '${i.id}' fixes group '${x.group_id}', but the walk from this ingress never reaches it`, fix: 'Check the ingress handler and that the group sits below it; a fix on a group the flow does not reach does nothing.' });
    }
  }
}
