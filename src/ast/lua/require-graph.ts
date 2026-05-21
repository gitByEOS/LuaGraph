import nodePath from "node:path";

import { Connection, type QueryResult } from "kuzu";

import type { ParsedRequire, NormalizedPath } from "../types.js";

export type ParsedRequireGraphFile = {
  readonly path: NormalizedPath;
  readonly requires: readonly ParsedRequire[];
};

export async function rebuildRequiresRelationships(
  connection: Connection,
  files: readonly ParsedRequireGraphFile[],
): Promise<number> {
  await deleteAllRequiresRelationships(connection);

  return insertRequiresRelationships(connection, files);
}

export async function deleteRequiresForFiles(
  connection: Connection,
  filePaths: readonly string[],
): Promise<void> {
  const statement = await connection.prepare(
    "MATCH (source:File)-[require:Requires]->(target:File) WHERE source.path = $path OR target.path = $path DELETE require",
  );

  for (const path of filePaths) {
    closeResult(await connection.execute(statement, { path }));
  }
}

async function deleteAllRequiresRelationships(connection: Connection): Promise<void> {
  closeResult(await connection.query("MATCH (:File)-[require:Requires]->(:File) DELETE require;"));
}

async function insertRequiresRelationships(
  connection: Connection,
  files: readonly ParsedRequireGraphFile[],
): Promise<number> {
  const filePaths = files.map((file) => file.path);
  const statement = await connection.prepare(
    "MATCH (source:File {path: $sourcePath}), (target:File {path: $targetPath}) CREATE (source)-[r:Requires]->(target) SET r.moduleName = $moduleName, r.isResolved = $isResolved",
  );
  let requiresCount = 0;

  for (const file of files) {
    for (const require of file.requires) {
      const targetPath = require.isStatic ? resolveModulePath(file.path, require.moduleName, filePaths) : undefined;

      closeResult(
        await connection.execute(statement, {
          sourcePath: file.path,
          targetPath: targetPath ?? file.path,
          moduleName: require.moduleName,
          isResolved: targetPath !== undefined,
        }),
      );
      requiresCount += 1;
    }
  }

  return requiresCount;
}

function resolveModulePath(
  sourcePath: NormalizedPath,
  moduleName: string,
  filePaths: readonly NormalizedPath[],
): NormalizedPath | undefined {
  const modulePath = moduleName.replace(/\./g, "/");
  const candidates = [
    `${modulePath}.lua`,
    `${modulePath}/init.lua`,
    ...createSiblingCandidates(sourcePath, modulePath),
  ];

  for (const candidate of candidates) {
    const match = filePaths.find((filePath) => filePath === candidate);
    if (match !== undefined) {
      return match;
    }
  }

  return findUniqueSuffix(filePaths, [`/${modulePath}.lua`, `/${modulePath}/init.lua`]);
}

function createSiblingCandidates(sourcePath: NormalizedPath, modulePath: string): readonly string[] {
  const sourceDir = nodePath.posix.dirname(sourcePath);

  if (sourceDir === ".") {
    return [];
  }

  return [`${sourceDir}/${modulePath}.lua`, `${sourceDir}/${modulePath}/init.lua`];
}

function findUniqueSuffix(
  filePaths: readonly NormalizedPath[],
  suffixes: readonly string[],
): NormalizedPath | undefined {
  const matches = filePaths.filter((filePath) => suffixes.some((suffix) => filePath.endsWith(suffix)));

  return matches.length === 1 ? matches[0] : undefined;
}

function closeResult(result: QueryResult | QueryResult[] | undefined): void {
  const results = Array.isArray(result) ? result : result === undefined ? [] : [result];

  for (const item of results) {
    item.close();
  }
}
