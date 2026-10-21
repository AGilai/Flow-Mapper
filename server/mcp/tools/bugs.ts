// Bug tools: list, get, report and update bugs.

import * as bugs from '../../store/bugs.ts';
import * as keys from '../../store/keys.ts';
import { type Tool, env, obj, envOf, listArg } from './common.ts';

export const listBugsTool: Tool = {
  name: 'list_bugs', description: 'Bugs sorted by priority. Filter by status/priority/reporter (comma lists), service, version, text, open=true, or updatedSince (ISO time; includes new comments) for polling.',
  inputSchema: obj({ status: { type: 'string' }, priority: { type: 'string' }, reporter: { type: 'string' }, updatedSince: { type: 'string' }, service: { type: 'string' }, version: { type: 'string' }, q: { type: 'string' }, open: { type: 'boolean' } }),
  run: (c, a) => bugs.listBugs(c.db, a, c.appVersion),
};

export const getBugTool: Tool = {
  name: 'get_bug', description: 'One bug with links, attachments, comments and allowed status transitions.',
  inputSchema: obj({ id: { type: 'integer' } }, ['id']),
  run: (c, a) => bugs.getBug(c.db, a.id, c.appVersion),
};

export const reportBugTool: Tool = {
  name: 'report_bug', description: 'Report a bug in Flow-Mapper. Severity S1 (worst) to S4. Optionally link map entities.',
  inputSchema: obj({
    title: { type: 'string' }, description: { type: 'string' }, steps: { type: 'string' }, severity: { enum: ['S1', 'S2', 'S3', 'S4'] },
    appVersion: { type: 'string' }, env, reporter: { type: 'string' },
    links: { type: 'array', items: obj({ type: { enum: ['service', 'function', 'ingress', 'egress', 'channel', 'resource'] }, service: { type: 'string' }, id: { type: 'string' } }, ['type', 'id']) },
    log: { type: 'string', description: 'Optional log text to attach' },
  }, ['title']),
  run: (c, a) => {
    const { log, ...input } = a;
    const id = bugs.createBug(c.db, c.graph, { ...input, channel: 'mcp' }, c.appVersion);
    if (log) bugs.addAttachment(c.db, c.graph, c.dataDir, id, 'reported.log', 'text/plain', Buffer.from(log));
    return bugs.getBug(c.db, id, c.appVersion);
  },
};

export const updateBugTool: Tool = {
  name: 'update_bug', description: 'Change status (respecting the workflow), severity, priority override (null clears), assignee, fixedInVersion, resolution or links.',
  inputSchema: obj({
    id: { type: 'integer' }, status: { type: 'string' }, severity: { type: 'string' }, priority: { type: ['string', 'null'] },
    assignee: { type: 'string' }, fixedInVersion: { type: 'string' }, links: { type: 'array' },
    resolution: obj({ type: { enum: ['code', 'map-data', 'config', 'none'] }, ref: { type: 'string' }, note: { type: 'string' } }, ['type']),
    comment: { type: 'string' },
  }, ['id']),
  run: (c, a) => {
    const { id, comment, ...patch } = a;
    if (Object.keys(patch).length) bugs.updateBug(c.db, c.graph, id, patch);
    if (comment) bugs.addComment(c.db, id, 'agent', comment);
    return bugs.getBug(c.db, id, c.appVersion);
  },
};
