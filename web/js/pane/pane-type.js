// The Type row of a component's info pane (CR #148 follow-up): the large lifeline head no longer draws the type line, so the pane says it.
import { RUNTIME_NAMES, runtimeOf } from '../components/ext-links.js';

export const KIND = { service: 'Service', gateway: 'Gateway', lambda: 'Lambda', 'client-app': 'Client app', infra: 'Infrastructure' };

/** The specific runtime (e.g. "Kubernetes pod") when the manifest knows it, else the kind (Gateway, Lambda…), else the word "Service": never empty. */
export const typeOf = (svc, kind) => RUNTIME_NAMES[runtimeOf(svc)] ?? KIND[kind] ?? 'Service';
