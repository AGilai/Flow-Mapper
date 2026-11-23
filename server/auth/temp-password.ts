// Temporary password for invited Cognito users: 16 alphanumerics (Cognito's generated ones carry symbols that garble in the HTML invite e-mail).
import { randomInt } from 'node:crypto';

const UP = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', LO = 'abcdefghijklmnopqrstuvwxyz', DG = '0123456789', ALL = UP + LO + DG;
const pick = (s: string): string => s[randomInt(s.length)];

/** 16 chars of [A-Za-z0-9] with at least one upper, lower and digit, in random positions. Never log it. */
export function tempPassword(len = 16): string {
  const c = [pick(UP), pick(LO), pick(DG)];
  while (c.length < len) c.push(pick(ALL));
  for (let i = c.length - 1; i > 0; i--) { const j = randomInt(i + 1); [c[i], c[j]] = [c[j], c[i]]; }
  return c.join('');
}
