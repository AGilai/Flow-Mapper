// A small AWS Signature Version 4 signer (node:crypto only; no AWS SDK). Never log what it returns: the headers carry a signature and the session token.

import { createHash, createHmac } from 'node:crypto';

export interface AwsCreds { accessKeyId: string; secretAccessKey: string; sessionToken?: string }
export interface SignInput { method: string; url: string; headers?: Record<string, string>; body?: string; region: string; service: string; creds: AwsCreds; date?: Date }

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const hmac = (key: string | Buffer, s: string) => createHmac('sha256', key).update(s).digest();
const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

/** The query string in canonical form: names and values URI-encoded, sorted by name then value. */
function canonicalQuery(u: URL): string {
  return [...u.searchParams.entries()].map(([k, v]) => [enc(k), enc(v)]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join('&');
}

/** Returns the request headers to send, including host, x-amz-date, x-amz-security-token (when there is a session token) and Authorization. */
export function signRequest(i: SignInput): Record<string, string> {
  const u = new URL(i.url), d = i.date ?? new Date();
  const amzDate = d.toISOString().replace(/[-:]|\.\d{3}/g, ''), day = amzDate.slice(0, 8);
  const all: Record<string, string> = { ...(i.headers ?? {}), host: u.host, 'x-amz-date': amzDate };
  if (i.creds.sessionToken) all['x-amz-security-token'] = i.creds.sessionToken;
  const lower = Object.entries(all).map(([k, v]) => [k.toLowerCase(), String(v).trim().replace(/\s+/g, ' ')] as const).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const signed = lower.map(([k]) => k).join(';');
  const canonical = [i.method.toUpperCase(), u.pathname || '/', canonicalQuery(u), lower.map(([k, v]) => `${k}:${v}\n`).join(''), signed, sha256(i.body ?? '')].join('\n');
  const scope = `${day}/${i.region}/${i.service}/aws4_request`;
  const sts = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const key = hmac(hmac(hmac(hmac('AWS4' + i.creds.secretAccessKey, day), i.region), i.service), 'aws4_request');
  const signature = createHmac('sha256', key).update(sts).digest('hex');
  return { ...all, Authorization: `AWS4-HMAC-SHA256 Credential=${i.creds.accessKeyId}/${scope}, SignedHeaders=${signed}, Signature=${signature}` };
}
