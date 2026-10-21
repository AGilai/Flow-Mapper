// Guards the MCP tool list: names, order, descriptions and input schemas must not drift by accident.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { TOOLS } from '../server/mcp/tools.ts';

// 0.28.0: get_subsystems, get_subsystem_map, list_abstract_links, suggest_refinements, apply_plan_links, (0.28.2) list_flow_relations, set_subsystem_settings, set_levels added; edit_design and apply_import_plan descriptions changed
// 0.27.0: list_comments and add_comment added (comments under a flow)
// 0.25.2: link_health takes assumed / basis; get_service, get_endpoint_info, trace_flow, get_resource_keys say assumed values are defaults
// 0.25.0: upsert_entity and delete_entity removed; import_preview, import_into_draft, edit_design, get_call, get_flow_names, set_flow_name added; descriptions of list_entry_points, trace_flow, edit_in_draft changed
const NAMES = 'search,list_services,get_service,list_entry_points,trace_flow,set_description,find_paths,link_health,changelog,ingest_manifest,get_endpoint_info,load_dtos,event_types,inventory,get_store,list_clients,get_resource_keys,get_channel,get_exchange,load_schemas,list_bugs,get_bug,report_bug,update_bug,list_envs,create_env,open_draft,list_drafts,draft_changes,edit_in_draft,apply_draft,discard_draft,get_marks,apply_import_plan,import_preview,import_into_draft,edit_design,get_call,get_flow_names,set_flow_name,list_comments,add_comment,get_subsystems,get_subsystem_map,list_abstract_links,suggest_refinements,apply_plan_links,list_flow_relations,set_subsystem_settings,set_levels,export_mermaid,import_mermaid';
const HASH = 'd86834b7e064eb9b6397224e40d7ff8c9fc0f8f3661caa144eceb6215302b0b2';

test('MCP tool list is stable', () => {
  assert.equal(TOOLS.map((t) => t.name).join(','), NAMES);
  const h = createHash('sha256').update(JSON.stringify(TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })))).digest('hex');
  assert.equal(h, HASH);
});
