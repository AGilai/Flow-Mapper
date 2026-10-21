// Guards the MCP tool list: names, order, descriptions and input schemas must not drift by accident.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { TOOLS } from '../server/mcp/tools.ts';

const NAMES = 'search,list_services,get_service,list_entry_points,trace_flow,set_description,find_paths,link_health,changelog,ingest_manifest,upsert_entity,delete_entity,get_endpoint_info,load_dtos,event_types,inventory,get_store,list_clients,get_resource_keys,get_channel,get_exchange,load_schemas,list_bugs,get_bug,report_bug,update_bug,list_envs,create_env';
const HASH = 'd169851a026067210fd0455e303b17453cb6c8e3550e3309189a0b150ba4ba63';

test('MCP tool list is stable', () => {
  assert.equal(TOOLS.map((t) => t.name).join(','), NAMES);
  const h = createHash('sha256').update(JSON.stringify(TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })))).digest('hex');
  assert.equal(h, HASH);
});
