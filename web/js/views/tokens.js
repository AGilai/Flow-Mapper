// Frame 27e: personal access tokens for agents (MCP, REST). Create (name, optional expiry, admins: harvester scope), a one-time reveal with the MCP
// client config, the list (scope, created, last used, expires, revoke with an inline confirm). A token acts as its owner, with the owner's access.

import { h, fill } from '../dom.js';
import { api } from '../api.js';
import { pageHead } from '../components/page.js';
import { account, isCognito } from '../account.js';
import { icon } from '../icons.js';

const EXPIRY = [['', 'Never'], ['30', '30 days'], ['90', '90 days'], ['365', '1 year']];
const day = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '');
const ago = (iso) => {
  if (!iso) return 'Never';
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 2 ? 'Just now' : m < 120 ? `${m} minutes ago` : m < 2880 ? `${Math.round(m / 60)} hours ago` : day(iso);
};
const daysLeft = (iso) => Math.ceil((Date.parse(iso) - Date.now()) / 86400000);

/** Expires cell: "never", or a date, with an amber "expires in N days" under 14 days (the word is there too: never colour alone). */
export function expiresCell(t) {
  if (!t.expiresAt) return h('span.c', 'never');
  const n = daysLeft(t.expiresAt);
  if (n <= 0) return h('span.c', 'expired ', day(t.expiresAt));
  return h('span.c', day(t.expiresAt), n < 14 ? h('small.ac-soon', { 'data-qa': 'token-soon' }, `expires in ${n} day${n === 1 ? '' : 's'}`) : null);
}

export async function render({ main }) {
  if (!isCognito()) { fill(main, h('div.content', pageHead('Tokens', ''), h('p.ac-lead', 'This server has no accounts (FLOW_AUTH is off), so there are no tokens: agents connect without one.'))); return; }
  let tokens = (await api.tokens()).tokens, fresh = null, confirm = null, err = '';
  const name = h('input.input', { type: 'text', placeholder: 'e.g. Claude Code, laptop', maxLength: 80, 'aria-label': 'Name', 'data-qa': 'token-name', on: { input: () => { go.disabled = !name.value.trim(); } } });
  const exp = h('select.input', { 'aria-label': 'Expires', 'data-qa': 'token-expiry' }, EXPIRY.map(([v, t]) => h('option', { value: v }, t)));
  const harv = account.admin ? h('input', { type: 'checkbox', 'data-qa': 'token-harvester' }) : null;
  const go = h('button.btn.primary', { type: 'button', disabled: true, 'data-qa': 'token-create', on: { click: create } }, 'Create token');
  const box = h('div.content.ac-tk');
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !go.disabled) create(); });

  async function create() {
    err = '';
    try {
      fresh = await api.createToken({ name: name.value.trim(), expiresInDays: exp.value ? Number(exp.value) : null, ...(harv?.checked ? { scope: 'harvester' } : {}) });
      tokens = (await api.tokens()).tokens; name.value = ''; go.disabled = true;
    } catch (e) { err = e.message; }
    draw();
  }
  async function revoke(t) { try { await api.revokeToken(t.id); tokens = (await api.tokens()).tokens; } catch (e) { err = e.message; } confirm = null; draw(); }
  const copy = (text) => h('button.btn.sm', { type: 'button', on: { click: async (e) => { try { await navigator.clipboard.writeText(text); e.target.textContent = 'Copied'; } catch { /* clipboard blocked */ } } } }, icon('copy'), 'Copy');

  function reveal() {
    const cfg = JSON.stringify({ mcpServers: { 'flow-mapper': { type: 'http', url: `${location.origin}/mcp`, headers: { Authorization: `Bearer ${fresh.token}` } } } }, null, 2);
    return h('section.ac-sec.rev', { 'data-qa': 'token-reveal' },
      h('div.ac-rh', h('h3', icon('key'), ` Token created: ${fresh.name}`), h('span', 'Copy it now. It is shown once, and only a hash is stored.')),
      h('div.ac-code.one', h('code', { 'data-qa': 'token-value' }, fresh.token), copy(fresh.token)),
      h('div.ac-l', 'MCP client config'), h('div.ac-code', h('pre', cfg), copy(cfg)),
      h('p.ac-h', fresh.scope === 'harvester' ? 'Harvester scope: this token may ingest into sealed environments.' : 'Without the harvester scope a token cannot write to sealed environments: it gets “403 SEALED”.'));
  }
  function list() {
    if (!tokens.length) return h('section.ac-sec.pad', { 'data-qa': 'token-empty' }, h('b', 'No tokens yet'), h('p.ac-h', 'Create one to connect an agent over MCP or REST.'));
    return h('section.ac-sec', h('h3.ac-sech', 'Your tokens ', h('small', String(tokens.length))),
      h('div.ac-th', h('span', 'Name'), h('span', 'Created'), h('span', 'Last used'), h('span', 'Expires'), h('span')),
      ...tokens.map((t) => h('div.ac-tkr', { class: t.revokedAt ? 'off' : '', 'data-qa': 'token-row' },
        h('div.n', h('b', t.name), t.scope === 'harvester' ? h('em.ac-vb', 'Harvester') : null),
        h('span.c', day(t.createdAt)), h('span.c', ago(t.lastUsedAt)),
        t.revokedAt ? h('span.c', '—') : expiresCell(t),
        h('div.a', t.revokedAt ? h('span.c', 'Revoked')
          : confirm === t.id ? h('span.ac-cf', 'Revoke it? ', h('button.btn.sm.bad', { type: 'button', 'data-qa': 'token-revoke-yes', on: { click: () => revoke(t) } }, 'Revoke'), h('button.btn.sm', { type: 'button', on: { click: () => { confirm = null; draw(); } } }, 'Keep'))
          : h('button.btn.sm', { type: 'button', 'data-qa': 'token-revoke', on: { click: () => { confirm = t.id; draw(); } } }, 'Revoke')))));
  }
  function draw() {
    fill(box,
      pageHead('Tokens', 'Personal access tokens for agents (MCP, REST)'),
      h('p.ac-lead', "A token acts as you, with your access: the same designs, the same rules. Put it in an agent's MCP config or send it as a REST bearer token. Treat it like a password."),
      h('section.ac-sec.pad', h('h3', 'Create a token'),
        h('div.ac-addrow', h('div.ac-fld', h('label.ac-l', 'Name'), name), h('div', h('label.ac-l', 'Expires'), exp), go),
        harv ? h('label.ac-cb', harv, h('span', h('b', 'Harvester (may ingest into sealed environments)'), h('small', h('em.ac-vb', 'Admins only'), 'Not shown to other users. Without it a token cannot write to prod: it gets “403 SEALED”.'))) : null,
        err ? h('div.ac-err', { role: 'alert' }, err) : null),
      fresh ? reveal() : null, list());
  }
  draw();
  fill(main, box);
}
