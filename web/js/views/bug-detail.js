// Bug detail: description, logs, comments; side panel to triage, prioritize and fix.

import { ensureUser } from '../users/signin.js';
import { h, fill, toast } from '../dom.js';
import { api, isPreview } from '../api.js';
import { state } from '../state.js';
import { icon } from '../icons.js';

import { pageHead } from '../components/page.js';
import { ago, priorityPill, statusPill } from '../format.js';
import { attachmentRow, logDropzone } from './bug-logs.js';
import { triageBox } from './bug-triage.js';

export async function render({ main, params }) {
  const id = Number(params.id);
  const page = h('div.content');
  main.append(pageHead(`Bug #${id}`, null, h('a.btn.ghost', { href: '#/bugs' }, icon('back'), 'All bugs')), page);

  async function load() {
    const b = await api.bug(id);
    fill(page, h('div.two-col', body(b), triageBox(b, update)));
  }
  async function update(patch, done = 'Saved') {
    try { await api.updateBug(id, patch); toast(done); await load(); }
    catch (err) { toast(err.message); }
  }

  function body(b) {
    const comment = h('textarea.textarea', { placeholder: 'Add a comment', 'aria-label': 'Comment' });
    const files = [];
    return h('div.stack', { style: { gap: 'var(--s5)' } },
      h('div.stack', { style: { gap: 'var(--s2)' } },
        h('div.row', priorityPill(b.priority), statusPill(b.status), h('span.pill', b.severity),
          b.needsVerification ? h('span.pill.warn', `fixed in v${b.fixedInVersion}, you are on v${state.version}: verify it`) : null),
        h('h1.bug-title', b.title),
        h('p.small.muted', `Reported by ${b.reporter} via ${b.channel}, ${ago(b.createdAt)}, on v${b.appVersion} in ${b.env}`)),
      b.description ? h('section.stack', h('h2', 'What happened'), h('p.prose', b.description)) : null,
      b.steps ? h('section.stack', h('h2', 'Steps to reproduce'), h('p.prose', b.steps)) : null,
      b.resolution ? h('section.stack', h('h2', 'Resolution'), h('p', h('b', b.resolution.type), b.resolution.ref ? ` ${b.resolution.ref}` : '', b.resolution.note ? h('span.muted', ` ${b.resolution.note}`) : null)) : null,
      h('section.stack', h('h2', 'Logs', h('span.muted.small', ` ${b.attachments.length}`)),
        b.attachments.map((a) => attachmentRow(b.id, a)),
        suggestions(b),
        isPreview ? null : [logDropzone(files, async (f) => { await api.attach(b.id, f); toast(`${f.name} attached`); await load(); })]),
      h('section.stack', h('h2', 'Activity'),
        h('div.timeline',
          b.comments.length ? b.comments.map((c) => h('div.comment', h('p.small', h('b', c.author), h('span.muted', ` ${ago(c.createdAt)}`)), h('p.prose', c.body)))
            : h('p.small.muted', 'No comments yet.')),
        h('form.stack', { on: { submit: async (e) => {
          e.preventDefault();
          if (!comment.value.trim()) return;
          let who;
          try { who = await ensureUser('Sign in to comment. There are no passwords yet: picking a user only labels what you write.'); } catch (er) { if (er.cancelled) return; throw er; }
          await api.comment(b.id, who.name, comment.value);
          await load();
        } } }, comment, h('div', h('button.btn', { type: 'submit' }, 'Comment')))));
  }

  // Map entities found in uploaded logs that are not linked yet; one click links them.
  function suggestions(b) {
    const linked = new Set(b.links.map((l) => `${l.type}|${l.service ?? ''}|${l.id}`));
    const all = b.attachments.flatMap((a) => a.suggestions).filter((s) => !linked.has(`${s.type}|${s.service ?? ''}|${s.id}`));
    const uniq = [...new Map(all.map((s) => [`${s.type}|${s.service ?? ''}|${s.id}`, s])).values()].slice(0, 8);
    if (!uniq.length) return null;
    return h('div.box', h('div.box-head', h('p.small', h('b', 'Found in the logs. '), 'Link these to raise the bug\'s impact score.')),
      h('div.list', { style: { padding: 'var(--s2)' } }, uniq.map((s) => h('div.list-item',
        h('span.pill', s.type), h('span.key.grow', s.service ? `${s.service}:${s.id}` : s.id), h('span.xs.muted', `${s.hits}×`),
        h('button.btn.ghost', { on: { click: () => update({ links: [...b.links, { type: s.type, service: s.service, id: s.id }] }, 'Linked') } }, 'Link')))));
  }

  await load();
}

