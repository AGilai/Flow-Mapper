// "Invite people" (CR #134): an admin-only dialog on cognito servers. Paste e-mail addresses (comma, space or new line), Send invitations, read one result per address;
// below, the people in the pool with their status and a Resend for those who were invited and never signed in. Server: POST/GET /api/admin/invites.

import { h } from '../dom.js';
import { api } from '../api.js';
import { parseEmails } from '../../core/invite-emails.js';

const LABEL = { invited: 'Invited', exists: 'Already has an account', pending: 'Invited, not signed in yet', failed: 'Failed' };
const POOL = { CONFIRMED: 'Signed in', FORCE_CHANGE_PASSWORD: 'Invited, not signed in yet', RESET_REQUIRED: 'Password reset required', UNCONFIRMED: 'Unconfirmed' };
const day = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '');

let open = false;

export function inviteDialog() {
  if (open) return;
  open = true;
  let results = [], people = null, busy = false, listErr = '';
  const ta = h('textarea.input', { rows: 3, placeholder: 'name@company.com, other@company.com', 'aria-label': 'E-mail addresses', 'data-qa': 'inv-emails', on: { input: () => draw() } });
  const err = h('div.ac-err', { role: 'alert' });
  const out = h('div.inv-res', { 'data-qa': 'inv-results', 'aria-live': 'polite' });
  const list = h('div.inv-list', { 'data-qa': 'inv-list' });
  const send = h('button.btn.sm.primary', { type: 'button', 'data-qa': 'inv-send', on: { click: () => submit(parseEmails(ta.value).emails, false) } }, 'Send invitations');
  const close = h('button.btn.sm', { type: 'button', 'data-qa': 'inv-close', on: { click: () => done() } }, 'Close');
  const dlg = h('dialog.u-dialog.inv-dialog', { 'aria-label': 'Invite people', on: { cancel: (e) => { e.preventDefault(); done(); }, mousedown: (e) => { if (e.target === dlg) done(); } } },
    h('header', h('h3', 'Invite people'), h('p', 'They get an e-mail with a temporary password and set their own when they first sign in.')),
    h('div.bd', h('label.ac-l', { for: 'inv-ta' }, 'E-mail addresses'), ta, h('small.inv-hint', 'Separate with commas, spaces or new lines. Up to 50 at a time.'), err, out, h('h4.inv-h', 'People in the pool'), list),
    h('footer', close, send));
  ta.id = 'inv-ta';
  const done = () => { dlg.close(); dlg.remove(); open = false; };

  const badge = (s, text) => h('span.inv-b', { class: s, 'data-qa': 'inv-status', 'data-status': s }, text);
  function draw() {
    const { emails, bad } = parseEmails(ta.value);
    err.textContent = bad.length ? `Not an e-mail address: ${bad.slice(0, 3).join(', ')}${bad.length > 3 ? ` and ${bad.length - 3} more` : ''}` : '';
    send.disabled = busy || !emails.length || emails.length > 50;
    send.textContent = emails.length > 1 ? `Send ${emails.length} invitations` : 'Send invitation';
    out.replaceChildren(...results.map((r) => h('div.inv-row', { 'data-qa': 'inv-result' }, h('b', r.email), badge(r.status, LABEL[r.status]), h('small', r.message ?? ''),
      r.status === 'pending' ? h('button.btn.sm', { type: 'button', 'data-qa': 'inv-resend', on: { click: () => submit([r.email], true) } }, 'Resend') : null)));
    list.replaceChildren(...(people === null ? [h('div.u-none', listErr || 'Loading…')] : !people.length ? [h('div.u-none', 'No one yet.')] : people.map((u) => {
      const pending = u.status === 'FORCE_CHANGE_PASSWORD';
      return h('div.inv-row', { 'data-qa': 'inv-person' }, h('b', u.email), h('small', `${POOL[u.status] ?? u.status}${u.created ? ` · ${day(u.created)}` : ''}`),
        pending ? h('button.btn.sm', { type: 'button', 'data-qa': 'inv-resend-row', on: { click: () => submit([u.email], true) } }, 'Resend') : null);
    })));
  }
  async function submit(emails, resend) {
    if (!emails.length || busy) return;
    busy = true; err.textContent = ''; draw();
    try {
      results = (await api.invite({ emails, resend })).results;
      if (!resend) ta.value = results.filter((r) => r.status === 'failed').map((r) => r.email).join('\n'); // only the failures stay to be fixed
      await refresh();
    } catch (e) { err.textContent = e.message || 'Could not send.'; }
    busy = false; draw();
  }
  async function refresh() { try { people = (await api.invitees()).users; listErr = ''; } catch (e) { listErr = e.message || 'Could not load the list.'; people = people ?? null; } }
  draw();
  document.body.append(dlg);
  dlg.showModal();
  ta.focus();
  refresh().then(draw);
}
