// "Flows through it" rows (#94): a flow's summary is a one-line preview, so its Markdown syntax is stripped before the row is drawn.
import { stripMarkdown } from '../../core/markdown-strip.js';

export const plainSummaries = (flows) => (Array.isArray(flows) ? flows.map((e) => (e?.summary ? { ...e, summary: stripMarkdown(e.summary) } : e)) : flows);
