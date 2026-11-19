// Component icons (CR #144, frame 32): an optional `details.icon` on a component (service header).
// Value: a built-in name (a file of web/icons/ without .svg), an `<svg ...>` string, or a `data:image/...` URL; at most MAX_ICON characters.
// Pure: the REST / MCP edit, the ingest check, the draft rules and the browser (picker, drawing) all use this file. Nothing here is injected as markup:
// the UI draws every icon as an <img> (a user's SVG as a data: URL), where scripts never run; the checks below also keep hostile files out of the store.

export const MAX_ICON = 16 * 1024;

/** The built-in set, grouped as the picker shows it: [group, [[name, label]...]]. */
export const BUILTIN_ICON_GROUPS: [string, [string, string][]][] = [
  ['Products', [['vault', 'Vault'], ['auth0', 'Auth0'], ['mongodb', 'MongoDB'], ['redis', 'Redis'], ['postgres', 'PostgreSQL'], ['mysql', 'MySQL'], ['elasticsearch', 'Elasticsearch'], ['rabbitmq', 'RabbitMQ'], ['kafka', 'Kafka']]],
  ['AWS · Compute', [['aws-lambda', 'Lambda'], ['aws-ec2', 'EC2']]],
  ['AWS · Containers', [['aws-ecs', 'ECS'], ['aws-eks', 'EKS']]],
  ['AWS · Application integration', [['aws-sqs', 'SQS'], ['aws-sns', 'SNS'], ['aws-eventbridge', 'EventBridge'], ['aws-step-functions', 'Step Functions']]],
  ['AWS · Databases', [['aws-dynamodb', 'DynamoDB'], ['aws-rds', 'RDS'], ['aws-elasticache', 'ElastiCache']]],
  ['AWS · Storage', [['aws-s3', 'S3']]],
  ['AWS · Networking', [['aws-api-gateway', 'API Gateway'], ['aws-cloudfront', 'CloudFront']]],
  ['AWS · Analytics', [['aws-kinesis', 'Kinesis']]],
  ['AWS · Security', [['aws-cognito', 'Cognito'], ['aws-kms', 'KMS'], ['aws-secrets-manager', 'Secrets Manager'], ['aws-iam', 'IAM']]],
];
export const BUILTIN_ICONS: string[] = BUILTIN_ICON_GROUPS.flatMap(([, items]) => items.map(([n]) => n));
const LABELS = new Map(BUILTIN_ICON_GROUPS.flatMap(([, items]) => items));
/** Words a search also matches (what the product is, not only its name): "queue" finds SQS, RabbitMQ and Kafka. */
const KEYWORDS: Record<string, string> = {
  vault: 'secrets hashicorp', auth0: 'identity login idp oauth', mongodb: 'database nosql document', redis: 'cache database key value', postgres: 'database sql relational', mysql: 'database sql relational',
  elasticsearch: 'search index', rabbitmq: 'queue broker amqp messaging', kafka: 'queue stream broker messaging', 'aws-lambda': 'function serverless', 'aws-sqs': 'queue messaging', 'aws-sns': 'topic pubsub messaging notification',
  'aws-eventbridge': 'event bus messaging', 'aws-step-functions': 'workflow orchestration', 'aws-dynamodb': 'database nosql', 'aws-rds': 'database sql relational', 'aws-elasticache': 'cache redis memcached',
  'aws-s3': 'bucket object storage files', 'aws-api-gateway': 'gateway api http', 'aws-cloudfront': 'cdn', 'aws-kinesis': 'stream messaging', 'aws-cognito': 'identity login users', 'aws-kms': 'keys encryption', 'aws-secrets-manager': 'secrets vault', 'aws-iam': 'identity permissions roles',
};
export const iconLabel = (name: string): string => LABELS.get(name) ?? name;

export type IconKind = 'builtin' | 'svg' | 'data';
const XML_DECL = /^\s*<\?xml[^>]*\?>\s*/i;
export const iconKind = (v: unknown): IconKind | null =>
  typeof v !== 'string' ? null : BUILTIN_ICONS.includes(v) ? 'builtin' : /^\s*(<\?xml[^>]*\?>\s*)?<svg[\s>]/i.test(v) ? 'svg' : /^data:image\//i.test(v) ? 'data' : null;

const HELP = () => `Use one of the built-in icons (${BUILTIN_ICONS.join(', ')}), an <svg> string, or a data:image/ URL, at most ${MAX_ICON / 1024} KB`;

/** The problem with an SVG document, or null: no script, no event handler attribute, no external reference. */
export function svgProblem(svg: string): string | null {
  if (!/<\/svg>\s*$/i.test(svg)) return 'the SVG must be one <svg>...</svg> document';
  if (/<\s*(script|foreignObject|iframe|embed|object|audio|video|link|meta)\b/i.test(svg) || /<!(doctype|entity)/i.test(svg)) return 'the SVG must not contain <script>, <foreignObject>, embedded objects or a DOCTYPE';
  if (/[\s"'/]on[a-z]+\s*=/i.test(svg)) return 'the SVG must not contain on...= event attributes';
  if (/javascript:/i.test(svg)) return 'the SVG must not contain javascript: URLs';
  for (const m of svg.matchAll(/(?:xlink:)?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    const u = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    if (!u.startsWith('#') && !/^data:image\/(png|jpe?g|gif|webp);/i.test(u)) return 'the SVG must not link to anything outside itself (href must be #id)';
  }
  if (/url\(\s*["']?\s*(?!#|data:image)/i.test(svg) || /@import/i.test(svg)) return 'the SVG must not load anything outside itself (url(), @import)';
  return null;
}

const DATA_URL = /^data:image\/(png|jpe?g|gif|webp|avif|svg\+xml)((?:;[a-z0-9=.+-]+)*?)(;base64)?,/i;

/** The problem with a stored `icon` value, or null. */
export function iconProblem(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim()) return `icon must be a non-empty string. ${HELP()}`;
  if (v.length > MAX_ICON) return `icon is ${v.length} characters; at most ${MAX_ICON} (${MAX_ICON / 1024} KB)`;
  const kind = iconKind(v);
  if (kind === 'builtin') return null;
  if (kind === 'svg') return svgProblem(v.replace(XML_DECL, '').trim());
  if (kind === 'data') {
    const m = DATA_URL.exec(v);
    if (!m) return `icon data URL must be data:image/(png|jpeg|gif|webp|avif|svg+xml),... ${HELP()}`;
    if (/svg/i.test(m[1])) {
      let text: string;
      try { text = m[3] ? atob(v.slice(m[0].length)) : decodeURIComponent(v.slice(m[0].length)); } catch { return 'icon data URL could not be decoded'; }
      return svgProblem(text.replace(XML_DECL, '').trim());
    }
    return null;
  }
  return `unknown icon '${v.length > 40 ? `${v.slice(0, 40)}...` : v}'. ${HELP()}`;
}

const seen = new Map<string, boolean>();
/** What a component header carries as its icon: `details.icon` when it is valid, else null (a bad value is never drawn). */
export function iconOf(header: any): string | null {
  const v = header?.details?.icon ?? header?.icon;
  if (typeof v !== 'string') return null;
  let ok = seen.get(v);
  if (ok === undefined) { ok = iconProblem(v) === null; if (seen.size > 500) seen.clear(); seen.set(v, ok); }
  return ok ? v : null;
}

/** The URL an <img> takes for an icon (relative to web/), or null. A user's SVG becomes a data: URL, so it is only ever drawn as an image. */
export function iconSrc(v: unknown, base = 'icons/'): string | null {
  const k = iconKind(v);
  if (k === 'builtin') return `${base}${v}.svg`;
  if (k === 'data') return v as string;
  if (k === 'svg') {
    const s = (v as string).replace(XML_DECL, '').trim();
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(/^<svg[^>]*\sxmlns\s*=/i.test(s) ? s : s.replace(/^<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"'))}`;
  }
  return null;
}

/** The tile behind the mark (frame 32), never a recolour: Vault a dark slate tile; Kafka and MySQL a white tile in dark mode only; a user's logo a white tile. */
export function iconTile(v: unknown): 'slate' | 'white-dark' | 'white' | null {
  const k = iconKind(v);
  return v === 'vault' ? 'slate' : v === 'kafka' || v === 'mysql' ? 'white-dark' : k === 'svg' || k === 'data' ? 'white' : null;
}

/** The picker's groups for a search text: every group, or only the items whose name, label or group contain each word; empty groups are dropped. */
export function searchIcons(q: string): [string, [string, string][]][] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return BUILTIN_ICON_GROUPS;
  return BUILTIN_ICON_GROUPS.map(([g, items]) => [g, items.filter(([n, l]) => words.every((w) => `${n} ${l} ${g} ${KEYWORDS[n] ?? ''}`.toLowerCase().includes(w)))] as [string, [string, string][]]).filter(([, items]) => items.length);
}
