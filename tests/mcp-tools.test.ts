// Guards the MCP tool list: names, order, descriptions and input schemas must not drift by accident.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { TOOLS } from '../server/mcp/tools.ts';

// 0.25.2: link_health takes assumed / basis; get_service, get_endpoint_info, trace_flow, get_resource_keys say assumed values are defaults
// 0.25.0: upsert_entity and delete_entity removed; import_preview, import_into_draft, edit_design, get_call, get_flow_names, set_flow_name added; descriptions of list_entry_points, trace_flow, edit_in_draft changed
const NAMES = 'search,list_services,get_service,list_entry_points,trace_flow,set_description,find_paths,link_health,changelog,ingest_manifest,get_endpoint_info,load_dtos,event_types,inventory,get_store,list_clients,get_resource_keys,get_channel,get_exchange,load_schemas,list_bugs,get_bug,report_bug,update_bug,list_envs,create_env,open_draft,list_drafts,draft_changes,edit_in_draft,apply_draft,discard_draft,get_marks,apply_import_plan,import_preview,import_into_draft,edit_design,get_call,get_flow_names,set_flow_name';
const HASH = '0091c4284e12e14b9d363223c869f9daa47e7a2503c1e02189dcb8b5b6af436d';

test('MCP tool list is stable', () => {
  assert.equal(TOOLS.map((t) => t.name).join(','), NAMES);
  const h = createHash('sha256').update(JSON.stringify(TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })))).digest('hex');
  assert.equal(h, HASH);
});
