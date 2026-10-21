// The Refine grid of an abstract link's panel (frame 3), pure: which selects are open, what each offers, and the `refine-link` edit a choice makes.
// A choice is { from: component | '', via: egress id | NEW_CALL | '', to: component | '', toEp: endpoint id | '' }. Three outcomes:
//   narrow: an end that is a subsystem becomes a component (or an endpoint): {from?, to?};
//   use:    an existing call of the chosen From component realises the link: {use};
//   call:   a new call does (NEW_CALL): the call builder opens with the From and To filled in; its edit is wrapped by `callEdit`.

export const NEW_CALL = '__new';
export const NO_EP = '';

/** What each select offers and whether it is open. `comps(subsystemKey)` -> component names; `suggestions`: the panel's `suggest_refinements`. */
export function refineModel(view, choice, comps, suggestions = []) {
  const open = (end) => end.level === 'subsystem';
  const own = (end) => (end.service ? [end.service] : comps(end.subsystem));
  const from = own(view.from), to = own(view.to);
  const calls = suggestions.filter((s) => s.use && (!choice.from || s.use.service === choice.from)).map((s) => s.use);
  return {
    from: { open: open(view.from), options: from, value: open(view.from) ? choice.from : view.from.service ?? '' },
    via: { open: !!(choice.from || view.from.service), options: [...calls.filter((c, i) => calls.findIndex((x) => x.egress === c.egress && x.service === c.service) === i).map((c) => ({ value: c.egress, label: `${c.service} · ${c.egress}` })), { value: NEW_CALL, label: 'new call' }] },
    to: { open: open(view.to), options: to, value: open(view.to) ? choice.to : view.to.service ?? '' },
    epOpen: !!(choice.to || view.to.service) && view.to.level !== 'endpoint',
  };
}

/** The component each side stands for once the choice is applied. */
export const fromOf = (view, c) => (view.from.service ?? c.from) || '';
export const toOf = (view, c) => (view.to.service ?? c.to) || '';

/**
 * choiceEdit(view, choice) -> null | { action: 'narrow' | 'use' | 'call', edit?, from?, to? }
 * `narrow` and `use` carry the `refine-link` edit; `call` carries the call builder's presets (`from` = the component, `to` = { service, ingress? }).
 */
export function choiceEdit(view, choice) {
  const from = fromOf(view, choice), to = toOf(view, choice);
  if (choice.via === NEW_CALL) return from ? { action: 'call', from, to: to ? { service: to, ingress: choice.toEp || undefined } : null } : null;
  if (choice.via) return from ? { action: 'use', edit: { kind: 'refine-link', id: view.id, use: { service: from, egress: choice.via } } } : null;
  const edit = { kind: 'refine-link', id: view.id };
  if (view.from.level === 'subsystem' && choice.from) edit.from = `svc:${choice.from}`;
  if (to && (view.to.level === 'subsystem' ? choice.to : choice.toEp)) edit.to = choice.toEp ? `ing:${to}/${choice.toEp}` : `svc:${choice.to}`;
  return edit.from || edit.to ? { action: 'narrow', edit } : null;
}

/** The `refine-link` edit for a call the call builder made: its own edit, without `kind`. */
export const callEdit = (id, call) => { const { kind, ...rest } = call; return { kind: 'refine-link', id, call: rest }; };

/** The edit of a suggestion's "Use" button: a call to use, or an end to narrow to. */
export function suggestionEdit(view, s) {
  if (s.use) return { kind: 'refine-link', id: view.id, use: s.use };
  if (s.from) return { kind: 'refine-link', id: view.id, from: s.from };
  if (s.to) return { kind: 'refine-link', id: view.id, to: s.to };
  return null;
}

/** The button text of a suggestion: "Use swg-api" (a call), "Use pop-edge" (an end). */
export const suggestionLabel = (s) => `Use ${s.use?.service ?? (s.from ?? s.to ?? '').replace(/^\w+:/, '')}`;

/** The text under the grid: what the link is waiting for. */
export function waitingText(view) {
  if (view.state === 'refined') return 'This link is realised by a call. It shows at component level and is counted in its line here.';
  return 'When both ends have an endpoint, this becomes a call at component level and shows here as part of its line. Until then it stays abstract and is listed under "Open in this design".';
}
