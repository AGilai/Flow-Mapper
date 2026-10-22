// Tiny DOM helpers. h('div.cls#id', {attrs, on: {click}}, ...children)

export function h(tag, attrs, ...children) {
  if (attrs == null || typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs)) {
    if (attrs != null) children.unshift(attrs);
    attrs = {};
  }
  const [, name = 'div', rest = ''] = tag.match(/^([a-z0-9-]*)(.*)$/i);
  const el = name === 'svg' || attrs.svg ? document.createElementNS('http://www.w3.org/2000/svg', name) : document.createElement(name);
  for (const m of rest.matchAll(/([.#])([^.#]+)/g)) {
    if (m[1] === '.') el.classList.add(m[2]); else el.id = m[2];
  }
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false || k === 'svg') continue;
    if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
    else if (k === 'class') el.classList.add(...String(v).split(/\s+/).filter(Boolean));
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && !(el instanceof SVGElement) && k !== 'list') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const clear = (el) => { el.replaceChildren(); return el; };

/** Replace an element's children; accepts nested arrays and skips null/false. */
export const fill = (el, ...children) => append(clear(el), children);

/** Create an SVG element with attributes. */
export function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  for (const c of children.flat()) if (c != null) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

export function debounce(fn, ms = 150) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

const shown = new Map(); // text -> { el, timer }: the toasts on screen
/** A short message at the bottom. The same text while it is still showing does not stack: the one on screen stays and its timer restarts. */
export function toast(msg, ms = 2600) {
  const old = shown.get(msg);
  if (old?.el.isConnected) { clearTimeout(old.timer); old.timer = setTimeout(() => { old.el.remove(); shown.delete(msg); }, ms); return; }
  const el = h('div.toast', { role: 'status' }, msg), t = { el, timer: setTimeout(() => { el.remove(); shown.delete(msg); }, ms) };
  shown.set(msg, t);
  document.body.append(el);
}
