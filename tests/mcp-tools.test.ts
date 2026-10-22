// Guards the MCP tool list: names, order, descriptions and input schemas must not drift by accident.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { TOOLS } from '../server/mcp/tools.ts';

// 0.34.x: set_env_color added; list_envs returns color, colorName, colorAuto
// 0.33.0: list_open_questions added; edit_design (component, subsystem), set_subsystem_settings and create_env groups take owners; list_mentions also returns the about mentions
// 0.32.0: list_users, list_mentions added; add_comment, resolve_comment, add_action_item, update_action_item take no required author (default Assistant)
// 0.30.0: set_description takes an optional `title` (a step's short title)
// 0.29.2: resolve_comment added; add_comment takes the importer fields (createdAt, externalId, externalSource, authorExternalId, parentExternalId, resolved, resolvedBy, resolvedAt)
// 0.29.0: list_action_items, add_action_item, update_action_item added (action items under a flow)
// 0.28.0: get_subsystems, get_subsystem_map, list_abstract_links, suggest_refinements, apply_plan_links, (0.28.2) list_flow_relations, set_subsystem_settings, set_levels added; edit_design and apply_import_plan descriptions changed
// 0.27.0: list_comments and add_comment added (comments under a flow)
// 0.34.0: get_notes, set_notes added; list_mentions also returns notes; add_comment takes steps (a range of steps)
// 0.30.2: about on edit_design (component, subsystem), set_subsystem_settings, create_env groups, get_subsystems
// 0.25.2: link_health takes assumed / basis; get_service, get_endpoint_info, trace_flow, get_resource_keys say assumed values are defaults
// 0.25.0: upsert_entity and delete_entity removed; import_preview, import_into_draft, edit_design, get_call, get_flow_names, set_flow_name added; descriptions of list_entry_points, trace_flow, edit_in_draft changed
const NAMES = 'search,list_services,get_service,list_entry_points,trace_flow,set_description,find_paths,link_health,changelog,ingest_manifest,get_endpoint_info,load_dtos,event_types,inventory,get_store,list_clients,get_resource_keys,get_channel,get_exchange,load_schemas,list_bugs,get_bug,report_bug,update_bug,list_envs,create_env,set_env_color,open_draft,list_drafts,draft_changes,edit_in_draft,apply_draft,discard_draft,get_marks,apply_import_plan,import_preview,import_into_draft,edit_design,get_call,get_flow_names,set_flow_name,list_comments,add_comment,resolve_comment,get_notes,set_notes,get_subsystems,get_subsystem_map,list_abstract_links,suggest_refinements,apply_plan_links,list_flow_relations,set_subsystem_settings,set_levels,export_mermaid,import_mermaid,list_action_items,add_action_item,update_action_item,list_users,list_mentions,list_open_questions';
const HASH = '7be0214543ccec15c04f6f7b1f55a89c338eeece468ed14040496e9c28fe80b7';

test('MCP tool list is stable', () => {
  assert.equal(TOOLS.map((t) => t.name).join(','), NAMES);
  const h = createHash('sha256').update(JSON.stringify(TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })))).digest('hex');
  assert.equal(h, HASH);
});
