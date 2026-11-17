// Store types of the Drivers view: a client row's kind (a store kind, or an egress transport) folds into one picker type.

import { typeOf, kindLabel } from '../../core/driver-kinds.js';
export { typeOf, kindLabel };

/** Types always offered, dimmed "no data yet" until a harvester reports clients for them. */
export const ALWAYS = ['redis', 'mongodb', 'sqs-sns', 'http'];

/** Picker order: Redis, MongoDB, other stores with data, then the SDK placeholders. */
export const typeOrder = (types) => [...new Set([...ALWAYS, ...types])].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
const rank = (t) => (t === 'redis' ? 0 : t === 'mongodb' ? 1 : t === 'sqs-sns' ? 8 : t === 'http' ? 9 : 5);
