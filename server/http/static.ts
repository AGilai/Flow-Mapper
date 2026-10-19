// Serves the web UI from web/ and the shared core/ modules to the browser.
// core/*.ts is type-stripped on the fly (node:module stripTypeScriptTypes) so the browser
// runs the exact same graph code as the server, with no build step.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { send } from './router.ts';

const ROOT = join(import.meta.dirname, '../..');
const WEB = join(ROOT, 'web');
const CORE = join(ROOT, 'core');
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon',
};

const transpiled = new Map<string, string>();

/** Strip types and point `.ts` imports at `.js` URLs. Exported for the static preview build. */
export function transpileCore(source: string): string {
  return stripTypeScriptTypes(source).replace(/(from\s+['"]\.{1,2}\/[^'"]+)\.ts(['"])/g, '$1.js$2');
}

const safeJoin = (base: string, rel: string) => {
  const p = normalize(join(base, rel));
  return p === base || p.startsWith(base + sep) ? p : null;
};

export async function serveStatic(req: IncomingMessage, res: ServerResponse, dev: boolean): Promise<boolean> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
  try {
    if (path.startsWith('/core/') && path.endsWith('.js')) {
      const file = safeJoin(CORE, path.slice('/core/'.length).replace(/\.js$/, '.ts'));
      if (!file) return false;
      let js = dev ? undefined : transpiled.get(file);
      if (!js) { js = transpileCore(await readFile(file, 'utf8')); transpiled.set(file, js); }
      send(res, 200, js, { 'content-type': TYPES['.js'], 'cache-control': 'no-cache' });
      return true;
    }
    const rel = path === '/' ? 'index.html' : path.slice(1);
    let file = safeJoin(WEB, rel);
    if (!file) return false;
    let body: Buffer;
    try { body = await readFile(file); }
    catch {
      if (extname(rel)) return false; // missing asset → 404
      file = join(WEB, 'index.html');  // client-side route → app shell
      body = await readFile(file);
    }
    send(res, 200, body, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
    return true;
  } catch {
    return false;
  }
}
