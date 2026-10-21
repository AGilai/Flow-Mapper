// MCP tool definitions, assembled in the order clients see them. Each tool wraps the same store/core functions the REST API uses.

import { searchTool, listServicesTool, getServiceTool, listEntryPointsTool, findPathsTool, linkHealthTool, changelogTool, inventoryTool } from './map.ts';
import { traceFlowTool, setDescriptionTool, eventTypesTool, getEndpointInfoTool, getChannelTool, getExchangeTool } from './flows.ts';
import { ingestManifestTool, upsertEntityTool, deleteEntityTool } from './write.ts';
import { getStoreTool, listClientsTool, getResourceKeysTool, loadSchemasTool, loadDtosTool } from './stores.ts';
import { listBugsTool, getBugTool, reportBugTool, updateBugTool } from './bugs.ts';
import { listEnvsTool, createEnvTool } from './envs.ts';
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
  upsertEntityTool,
  deleteEntityTool,
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
];
