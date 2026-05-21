import {
  deleteCallsForFiles,
  deleteExtendsForFiles,
  deleteRequiresForFiles,
  rebuildCallsRelationships,
  rebuildExtendsRelationships,
  rebuildRequiresRelationships,
} from "./relationship-graph.js";
import { parseJsFile } from "./parser.js";
import type { LanguageAdapter } from "../registry.js";

export { resolveJsModulePath, type JsModuleResolverOptions } from "./module-resolver.js";
export {
  extractJsCalls,
  extractJsExtends,
  extractJsRequires,
  extractJsSymbols,
  parseJsFile,
} from "./parser.js";
export {
  deleteCallsForFiles,
  deleteExtendsForFiles,
  deleteRequiresForFiles,
  rebuildCallsRelationships,
  rebuildExtendsRelationships,
  rebuildRequiresRelationships,
} from "./relationship-graph.js";

export const jsAdapter: LanguageAdapter = {
  parseFile: parseJsFile,
  rebuildCallsRelationships,
  rebuildExtendsRelationships,
  rebuildRequiresRelationships,
  deleteCallsForFiles,
  deleteExtendsForFiles,
  deleteRequiresForFiles,
};
