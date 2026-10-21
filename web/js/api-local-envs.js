// Preview backend: environment metadata (bundled) and the data the New environment page reads. Creating one is refused.

import { carryRows, neighbours } from '../core/neighbours.js';

export function envApi(data, g) {
  const fail = (message, status = 409) => { const e = new Error(message); e.status = status; throw e; };
  return {
    envMeta: async () => data.envMeta ?? Object.keys(data.models).map((name) => ({ name, kind: 'sealed', source: null, copiedAt: null, groups: [], levels: ['Subsystem', 'Component'], counts: { components: data.models[name].services.length } })),
    envComponents: async (env) => {
      const dtos = {};
      for (const d of data.dtos?.[env] ?? []) dtos[d.service] = (dtos[d.service] ?? 0) + 1;
      return carryRows(data.models[env] ?? fail(`environment '${env}' not found`, 404), dtos);
    },
    neighbours: async (env, services) => neighbours(g(env), services),
    createEnv: async () => fail('Creating an environment is not available in the preview: it needs the server.'),
  };
}
