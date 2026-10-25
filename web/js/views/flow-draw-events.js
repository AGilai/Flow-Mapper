// Event wiring of a drawn lane: clicks, keys, menus, hover and the number tiles. Returns mark(label, on).

export function wireEvents(head, body, { columns, events, bars }, { onMessage, onBar, onBarMenu, onParticipant, onNum, onNumHover, onFan, onMw, onBarTip, onSqueeze, onBand, onInternal, onDb, onPill, onStore }) {
  const sqOf = (t) => t.closest?.('[data-sqfold]'); // a fold column: click opens it (squeeze off for the tab)
  const eventOf = (t) => events[Number(t.closest?.('[data-e]')?.dataset.e)];
  const barOf = (t) => { const r = t?.closest?.('[data-bar]'); return r ? bars[Number(r.dataset.bar)] : null; };
  const numOf = (t) => t?.closest?.('[data-num]');
  const foldOf = (t) => t.closest?.('[data-mwfold]');
  const fold = (el) => onMw?.(bars[Number(el.dataset.mwfold)], el.classList.contains('mwlab') ? '.mwlab' : '.mwseg'); // the redraw replaces the element: the caller refocuses by this selector
  const ipillOf = (t) => !!t.closest?.('[data-ipill]'); // the folded "N internal calls" marker (#84); a middleware label is also a pill
  const pillOf = (t) => { const b = t.closest?.('[data-pill]'); return b ? bars[Number(b.dataset.pill)] : null; };
  const pm = (ev) => {
    const g = ev.target.closest?.('[data-p]'), c = g && columns[Number(g.dataset.p)];
    if (c?.service && onParticipant) { ev.preventDefault(); onParticipant({ id: `svc:${c.service}`, kind: 'service', service: c.service, label: c.label }, ev.clientX, ev.clientY, ev.type); }
    else if (c?.fan && onFan && ev.type === 'click') onFan(c.fan.topic);
    else if (onStore && g?.classList.contains('store-hd') && ev.type === 'click' && !String(getSelection?.() ?? '')) onStore(c, ev); // #86: a Redis or Mongo head opens the store panel (a text selection is not a click)
  };
  const bandOf = (t) => (t.closest?.('.band-add') ? null : t.closest?.('.band.sub')); // a subsystem band (0.33.0): its click opens the subsystem's info pane
  const intOf = (t) => t.closest?.('[data-int]'); // "⊕ internal" under a service head (0.38.0)
  head.addEventListener('keydown', (ev) => { if ((ev.key === 'Enter' || ev.key === ' ') && intOf(ev.target)) { ev.preventDefault(); onInternal?.(intOf(ev.target).dataset.int); return; } if ((ev.key === 'Enter' || ev.key === ' ') && onBand && bandOf(ev.target)) { ev.preventDefault(); onBand(bandOf(ev.target).dataset.sub); return; } if (ev.key === 'Enter' || ev.key === ' ') { if (sqOf(ev.target)) { ev.preventDefault(); onSqueeze?.(); return; } const g = ev.target.closest?.('[data-p]'), c = g && columns[Number(g.dataset.p)]; if (c?.fan) { ev.preventDefault(); onFan?.(c.fan.topic); } else if (onStore && g?.classList.contains('store-hd')) { ev.preventDefault(); onStore(c, ev); } } });
  head.addEventListener('contextmenu', pm);
  head.addEventListener('click', (ev) => { if (intOf(ev.target)) { ev.stopPropagation(); onInternal?.(intOf(ev.target).dataset.int); return; } if (sqOf(ev.target)) onSqueeze?.(); else if (onBand && bandOf(ev.target)) onBand(bandOf(ev.target).dataset.sub); else pm(ev); });
  let foldTimer = 0; // a fold click waits a beat so a double-click (look inside) never flips the fold
  body.addEventListener('dblclick', (ev) => { clearTimeout(foldTimer); const f = foldOf(ev.target), b = barOf(ev.target) ?? (f ? bars[Number(f.dataset.mwfold)] : null); if (b) onBar?.(b); });
  if (onBarTip) { // the popover on a bar: hover (the caller delays it) and keyboard focus
    const enter = (ev) => { const b = barOf(ev.target); if (b && barOf(ev.relatedTarget) !== b) onBarTip(b, b.el); };
    const leave = (ev) => { const b = barOf(ev.target); if (b && barOf(ev.relatedTarget) !== b) onBarTip(null); };
    body.addEventListener('mouseover', enter); body.addEventListener('mouseout', leave);
    body.addEventListener('focusin', enter); body.addEventListener('focusout', leave);
    body.addEventListener('dblclick', () => onBarTip(null)); body.addEventListener('contextmenu', () => onBarTip(null));
  }
  body.addEventListener('contextmenu', (ev) => { const b = barOf(ev.target); if (b) { ev.preventDefault(); onBarMenu?.(b, ev.clientX, ev.clientY); } });
  const dbOf = (t) => t.closest?.('[data-db]');
  body.addEventListener('click', (ev) => {
    if (dbOf(ev.target)) return onDb?.(dbOf(ev.target).dataset.db);
    if (sqOf(ev.target)) return onSqueeze?.();
    const bd = numOf(ev.target), pill = pillOf(ev.target), b = barOf(ev.target), e = eventOf(ev.target);
    if (foldOf(ev.target)) { if (ev.detail <= 1) { const f = foldOf(ev.target); clearTimeout(foldTimer); foldTimer = setTimeout(() => fold(f), 200); } } else if (bd) { ev.stopPropagation(); onNum?.(bd.dataset.num); } else if (pill) (onPill && ipillOf(ev.target) ? onPill : onBar)?.(pill); else if (b) onBar?.(b, 'select'); else if (e?.msg) onMessage?.(e.msg, ev.target.closest('[data-e]'), e, !!(e.publish && ev.target.classList?.contains('trunk')));
  });
  body.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    if (ev.target.closest?.('.dec-row')) return; // a dropdown in the diagram keeps its own keys
    ev.preventDefault();
    if (dbOf(ev.target)) return onDb?.(dbOf(ev.target).dataset.db);
    const bd = numOf(ev.target), pill = pillOf(ev.target), b = barOf(ev.target), e = eventOf(ev.target);
    if (foldOf(ev.target)) fold(foldOf(ev.target)); else if (bd) onNum?.(bd.dataset.num); else if (pill) (onPill && ipillOf(ev.target) ? onPill : onBar)?.(pill); else if (b) onBar?.(b); else if (e?.msg) onMessage?.(e.msg, ev.target.closest('[data-e]'), e, !!(e.publish && ev.target.classList?.contains('trunk')));
  });
  // a tile and its list row light up together
  const own = (el) => (el.dataset.own ?? '').split(' ').filter(Boolean);
  body.addEventListener('mouseover', (ev) => { const t = numOf(ev.target); if (t && numOf(ev.relatedTarget) !== t) onNumHover?.(own(t), true); });
  body.addEventListener('mouseout', (ev) => { const t = numOf(ev.target); if (t && numOf(ev.relatedTarget) !== t) onNumHover?.(own(t), false); });
  body.addEventListener('focusin', (ev) => { const t = numOf(ev.target); if (t) onNumHover?.(own(t), true); });
  body.addEventListener('focusout', (ev) => { const t = numOf(ev.target); if (t) onNumHover?.(own(t), false); });
  const mark = (label, on) => body.querySelectorAll('.numtile').forEach((t) => { if (own(t).includes(label)) t.classList.toggle('hl', on); });
  return mark;
}
