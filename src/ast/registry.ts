import type { Connection } from "kuzu";

import { luaAdapter } from "./lua/index.js";
import type { NormalizedPath, ParsedFile } from "./types.js";

export type LanguageAdapter = {
  readonly parseFile: (path: string, source: string) => ParsedFile;
  readonly rebuildCallsRelationships: (connection: Connection, files: readonly ParsedFile[]) => Promise<number>;
  readonly rebuildExtendsRelationships: (connection: Connection, files: readonly ParsedFile[]) => Promise<number>;
  readonly rebuildRequiresRelationships: (connection: Connection, files: readonly ParsedFile[]) => Promise<number>;
  readonly deleteCallsForFiles: (connection: Connection, filePaths: readonly NormalizedPath[]) => Promise<void>;
  readonly deleteExtendsForFiles: (connection: Connection, filePaths: readonly NormalizedPath[]) => Promise<void>;
  readonly deleteRequiresForFiles: (connection: Connection, filePaths: readonly NormalizedPath[]) => Promise<void>;
};

export function getLanguageAdapter(): LanguageAdapter {
  return luaAdapter;
}
