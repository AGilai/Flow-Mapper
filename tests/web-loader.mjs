// A module loader hook for tests that load browser modules which import `../../core/x.js`: in the browser the server maps /core/ to the repo's core/
// (TypeScript here), on disk the path is web/core/x.js. Register it with `register('./web-loader.mjs', import.meta.url)`, then `await import(...)` the module.

export async function resolve(specifier, context, nextResolve) {
  try { return await nextResolve(specifier, context); } catch (e) {
    const m = /\/web\/core\/(.+)\.js$/.exec(e?.url ?? '');
    if (e?.code === 'ERR_MODULE_NOT_FOUND' && m) return nextResolve(new URL(`../core/${m[1]}.ts`, import.meta.url).href, context);
    throw e;
  }
}
