import type { Connection } from "kuzu";
import nodePath from "node:path";

import { jsAdapter } from "./js/index.js";
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

export function getLanguageAdapter(filePath: string): LanguageAdapter {
  const extension = nodePath.extname(filePath);

  if (extension === ".lua") {
    return luaAdapter;
  }

  if (isJavaScriptLikeExtension(extension)) {
    return jsAdapter;
  }

  throw new Error(`不支持的源码文件类型：${filePath}`);
}

function isJavaScriptLikeExtension(extension: string): boolean {
  return extension === ".js" || extension === ".jsx" || extension === ".ts" || extension === ".tsx";
}
