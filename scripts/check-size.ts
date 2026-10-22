// Size rule: keep files small and single-purpose. Fails if a .ts/.js file under core/, server/, web/js/,
// scripts/ is over 250 lines (tests/: 350), unless it is on the allowlist below. An allowlisted file may
// shrink but never grow; when it drops under the limit, remove it from the list. Also fails if a file in
// core/ imports `node:` (core/ is shared with the browser).

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = join(import.meta.dirname, '..');
const LIMITS: [string, number][] = [['core', 250], ['server', 250], ['web/js', 250], ['scripts', 250], ['tests', 350]];

/** Oversize files and their line count when recorded. Shrink them, never grow them. */
export const ALLOWLIST: Record<string, number> = {
  'core/trace.ts': 419,
  'core/channel-flow.ts': 286,
  'core/events.ts': 271,
  'core/instances.ts': 266,
};

function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (/\.(ts|js)$/.test(e.name)) yield p;
  }
}

const lines = (text: string) => text.replace(/\n$/, '').split('\n').length;
const errors: string[] = [];
const seen = new Set<string>();

for (const [dir, limit] of LIMITS) {
  for (const file of walk(join(root, dir))) {
    const rel = relative(root, file), text = readFileSync(file, 'utf8'), n = lines(text);
    seen.add(rel);
    const allowed = ALLOWLIST[rel];
    if (allowed === undefined) {
      if (n > limit) errors.push(`${rel}: ${n} lines, over ${limit}. Split it by concern.`);
    } else if (n > allowed) errors.push(`${rel}: ${n} lines, grew past its allowlisted ${allowed}. Split it instead.`);
    else if (n <= limit) errors.push(`${rel}: ${n} lines is within ${limit}; remove it from the allowlist in scripts/check-size.ts.`);
    else if (n < allowed) errors.push(`${rel}: shrank to ${n} lines; lower its allowlist entry from ${allowed} to ${n} in scripts/check-size.ts.`);
    if (dir === 'core' && /(?:from\s+|import\s*\(\s*|import\s+)['"]node:/.test(text)) errors.push(`${rel}: core/ must not import node: modules (it runs in the browser).`);
  }
}
for (const rel of Object.keys(ALLOWLIST)) if (!seen.has(rel)) errors.push(`${rel}: on the allowlist but not found; remove it.`);

if (errors.length) {
  console.error(`check:size failed\n${errors.map((e) => `  ${e}`).join('\n')}`);
  process.exit(1);
}
console.log(`check:size ok (${seen.size} files)`);
