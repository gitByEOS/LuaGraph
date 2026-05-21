import { deleteCallsForFiles, rebuildCallsRelationships } from "./call-graph.js";
import { deleteExtendsForFiles, rebuildExtendsRelationships } from "./extend-graph.js";
import { parseLuaFile } from "./parser.js";
import { deleteRequiresForFiles, rebuildRequiresRelationships } from "./require-graph.js";
import type { LanguageAdapter } from "../registry.js";

export { parseLuaFile, extractLuaCalls, extractLuaExtends, extractLuaRequires, extractLuaSymbols } from "./parser.js";
export { deleteCallsForFiles, rebuildCallsRelationships } from "./call-graph.js";
export { deleteExtendsForFiles, rebuildExtendsRelationships } from "./extend-graph.js";
export { deleteRequiresForFiles, rebuildRequiresRelationships } from "./require-graph.js";

export const luaAdapter: LanguageAdapter = {
  parseFile: parseLuaFile,
  rebuildCallsRelationships,
  rebuildExtendsRelationships,
  rebuildRequiresRelationships,
  deleteCallsForFiles,
  deleteExtendsForFiles,
  deleteRequiresForFiles,
};
