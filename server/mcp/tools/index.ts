// MCP tool definitions, assembled in the order clients see them. Each tool wraps the same store/core functions the REST API uses.

import { searchTool, listServicesTool, getServiceTool, listEntryPointsTool, findPathsTool, linkHealthTool, changelogTool, inventoryTool } from './map.ts';
import { traceFlowTool, setDescriptionTool, eventTypesTool, getEndpointInfoTool, getChannelTool, getExchangeTool } from './flows.ts';
import { ingestManifestTool } from './write.ts';
import { getStoreTool, listClientsTool, getResourceKeysTool, loadSchemasTool, loadDtosTool } from './stores.ts';
import { listBugsTool, getBugTool, reportBugTool, updateBugTool } from './bugs.ts';
import { listEnvsTool, createEnvTool } from './envs.ts';
import { openDraftTool, listDraftsTool, draftChangesTool, editInDraftTool, applyDraftTool, discardDraftTool } from './drafts.ts';
import { getMarksTool, applyImportPlanTool } from './design.ts';
import { importPreviewTool, importIntoDraftTool } from './import.ts';
import { editDesignTool, getCallTool } from './edit.ts';
import { getFlowNamesTool, setFlowNameTool } from './flow-names.ts';
import { listCommentsTool, addCommentTool } from './comments.ts';
import { getSubsystemsTool, getSubsystemMapTool, listAbstractLinksTool, suggestRefinementsTool, applyPlanLinksTool, setSubsystemSettingsTool, setLevelsTool } from './subsystems.ts';
import type { Tool } from './common.ts';
export type { Tool };

export const TOOLS: Tool[] = [
  searchTool,
  listServicesTool,
  getServiceTool,
  listEntryPointsTool,
  traceFlowTool,
  setDescriptionTool,
  findPathsTool,
  linkHealthTool,
  changelogTool,
  ingestManifestTool,
  getEndpointInfoTool,
  loadDtosTool,
  eventTypesTool,
  inventoryTool,
  getStoreTool,
  listClientsTool,
  getResourceKeysTool,
  getChannelTool,
  getExchangeTool,
  loadSchemasTool,
  listBugsTool,
  getBugTool,
  reportBugTool,
  updateBugTool,
  listEnvsTool,
  createEnvTool,
  openDraftTool,
  listDraftsTool,
  draftChangesTool,
  editInDraftTool,
  applyDraftTool,
  discardDraftTool,
  getMarksTool,
  applyImportPlanTool,
  importPreviewTool,
  importIntoDraftTool,
  editDesignTool,
  getCallTool,
  getFlowNamesTool,
  setFlowNameTool,
  listCommentsTool,
  addCommentTool,
  getSubsystemsTool,
  getSubsystemMapTool,
  listAbstractLinksTool,
  suggestRefinementsTool,
  applyPlanLinksTool,
  setSubsystemSettingsTool,
  setLevelsTool,
];
