// #125: infra/deploy.sh echoes the command it runs with both secrets masked (the sed needs the g flag).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

test('deploy.sh masks every PreAuthPassword= and OriginSecret= in the echoed command', () => {
  const line = readFileSync('infra/deploy.sh', 'utf8').split('\n').find((l) => l.startsWith('echo "deploy:'))!;
  const expr = /sed -E '([^']+)'/.exec(line)![1];
  const out = execFileSync('sed', ['-E', expr], { input: 'deploy: x OriginSecret=aaa PreAuthPassword=bbb y\n' }).toString().trim();
  assert.equal(out, 'deploy: x OriginSecret=**** PreAuthPassword=**** y');
});
