// AWS credentials for the server: the standard environment variables, else the EC2 instance role through IMDSv2. Cached until a few minutes before Expiration.

import type { AwsCreds } from './aws-sigv4.ts';

const IMDS = 'http://169.254.169.254';

export function credentialProvider(env: NodeJS.ProcessEnv = process.env, f: typeof fetch = fetch, now: () => number = Date.now): () => Promise<AwsCreds> {
  let cached: { creds: AwsCreds; expires: number } | null = null;
  return async () => {
    if (env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY) return { accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_ACCESS_KEY, sessionToken: env.AWS_SESSION_TOKEN || undefined };
    if (cached && cached.expires - 5 * 60_000 > now()) return cached.creds;
    const sig = AbortSignal.timeout(3000);
    const tok = await f(`${IMDS}/latest/api/token`, { method: 'PUT', headers: { 'X-aws-ec2-metadata-token-ttl-seconds': '21600' }, signal: sig });
    if (!tok.ok) throw new Error(`no AWS credentials: not on an EC2 instance with a role (IMDS token ${tok.status})`);
    const h = { 'X-aws-ec2-metadata-token': await tok.text() };
    const role = (await (await f(`${IMDS}/latest/meta-data/iam/security-credentials/`, { headers: h, signal: sig })).text()).split('\n')[0].trim();
    if (!role) throw new Error('no AWS credentials: the instance has no role');
    const j: any = await (await f(`${IMDS}/latest/meta-data/iam/security-credentials/${role}`, { headers: h, signal: sig })).json();
    if (!j.AccessKeyId) throw new Error('no AWS credentials: the instance role answered without keys');
    const creds = { accessKeyId: j.AccessKeyId, secretAccessKey: j.SecretAccessKey, sessionToken: j.Token };
    cached = { creds, expires: Date.parse(j.Expiration) || now() + 10 * 60_000 };
    return creds;
  };
}
