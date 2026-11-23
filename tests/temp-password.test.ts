import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tempPassword } from '../server/auth/temp-password.ts';

test('tempPassword: 16 alphanumerics with upper, lower and digit', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 500; i++) {
    const p = tempPassword();
    assert.match(p, /^[A-Za-z0-9]{16}$/);
    assert.match(p, /[A-Z]/); assert.match(p, /[a-z]/); assert.match(p, /[0-9]/);
    seen.add(p);
  }
  assert.equal(seen.size, 500);
});
