import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

import { Connection, Database } from "kuzu";
import { afterEach, describe, expect, it } from "vitest";

import { getKuzuDatabasePath, initializeStore, schemaStatements } from "../src/core/store.js";

const tempRoots: string[] = [];

describe("Kuzu store", () => {
  afterEach(async () => {
    await Promise.all(
      tempRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
    );
  });

  it("initializes the v0.1.0 schema repeatedly", async () => {
    const projectRoot = await createTempProjectRoot();
    const databaseDir = join(projectRoot, ".luagraph", "kuzu");

    await initializeStore(databaseDir);
    await initializeStore(databaseDir);

    await expectPathExists(databaseDir);
    expect(schemaStatements.map((statement) => statement.name)).toEqual([
      "File",
      "Symbol",
      "Contains",
      "Calls",
      "Requires",
      "Returns",
      "Assigns",
      "Extends",
    ]);

    const database = new Database(getKuzuDatabasePath(databaseDir), undefined, undefined, true);
    const connection = new Connection(database);

    try {
      const result = await connection.query("MATCH (file:File) RETURN count(file) AS fileCount;");
      const queryResult = Array.isArray(result) ? result[0] : result;

      if (queryResult === undefined) {
        throw new Error("Kuzu 查询未返回结果");
      }

      expect(await queryResult.getAll()).toEqual([{ fileCount: 0 }]);
      queryResult.close();
    } finally {
      await connection.close();
      await database.close();
    }
  });
});

async function createTempProjectRoot(): Promise<string> {
  const tempParent = join(process.cwd(), ".luagraph", "test-temp");
  await mkdir(tempParent, { recursive: true });

  const tempRoot = join(tempParent, `${process.pid}-${Date.now()}`);
  await mkdir(tempRoot);
  tempRoots.push(tempRoot);

  return tempRoot;
}

async function expectPathExists(path: string): Promise<void> {
  await expect(mkdir(path, { recursive: false })).rejects.toMatchObject({ code: "EEXIST" });
}
