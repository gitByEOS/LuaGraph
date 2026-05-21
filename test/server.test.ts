import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { indexProject } from "../src/indexer.js";
import { initializeProject } from "../src/init.js";
import { startServer, type ServerHandle } from "../src/server.js";

const tempRoots: string[] = [];
const servers: ServerHandle[] = [];

describe("serve API", () => {
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
    await Promise.all(
      tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it("返回项目状态", async () => {
    const projectRoot = await createIndexedProject();
    const server = await createTestServer(projectRoot);

    const response = await fetchJson(`${server.url}/api/status`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      fileCount: 3,
      symbolCount: 3,
      edgeCount: 6,
      parseErrorCount: 0,
      pendingSyncChangeCount: 0,
    });
  });

  it("返回 File、Symbol 和可视化关系图数据", async () => {
    const projectRoot = await createIndexedProject();
    const server = await createTestServer(projectRoot);

    const response = await fetchJson(`${server.url}/api/graph`);

    expect(response.status).toBe(200);
    expect(response.body.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "src/player.lua",
          type: "File",
          kind: "file",
          label: "src/player.lua",
        }),
        expect.objectContaining({
          type: "Symbol",
          kind: "class",
          filePath: "src/player.lua",
          startLine: 1,
        }),
        expect.objectContaining({
          id: 'module:src/main.lua:"base." .. name',
          type: "Module",
          kind: "module",
          label: '"base." .. name',
        }),
      ]),
    );
    expect(response.body.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "src/player.lua",
          kind: "Contains",
        }),
        expect.objectContaining({
          source: expect.stringContaining("#class#Player#"),
          target: expect.stringContaining("#class#Base#"),
          kind: "Extends",
        }),
        expect.objectContaining({
          source: "src/main.lua",
          target: "src/player.lua",
          kind: "Requires",
          moduleName: "src.player",
          isResolved: true,
        }),
        expect.objectContaining({
          source: "src/main.lua",
          target: 'module:src/main.lua:"base." .. name',
          kind: "Requires",
          moduleName: '"base." .. name',
          isResolved: false,
        }),
      ]),
    );
  });

  it("按 line/context=0 读取目标行", async () => {
    const projectRoot = await createIndexedProject();
    const server = await createTestServer(projectRoot);

    const response = await fetchJson(
      `${server.url}/api/code?path=src/player.lua&line=2&context=0`,
    );

    expect(response).toEqual({
      status: 200,
      body: {
        path: "src/player.lua",
        startLine: 2,
        endLine: 2,
        code: "function Player:move()",
      },
    });
  });

  it("按 line/context=1 读取上下文", async () => {
    const projectRoot = await createIndexedProject();
    const server = await createTestServer(projectRoot);

    const response = await fetchJson(
      `${server.url}/api/code?path=src/player.lua&line=2&context=1`,
    );

    expect(response).toEqual({
      status: 200,
      body: {
        path: "src/player.lua",
        startLine: 1,
        endLine: 3,
        code: 'Player = setmetatable({}, { __index = Base })\nfunction Player:move()\nend',
      },
    });
  });

  it("拒绝绝对路径读取", async () => {
    const projectRoot = await createIndexedProject();
    const server = await createTestServer(projectRoot);
    const absolutePath = encodeURIComponent(join(projectRoot, "src/player.lua"));

    const response = await fetchJson(`${server.url}/api/code?path=${absolutePath}&line=1&context=0`);

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("相对路径");
  });

  it("拒绝包含 .. 的路径读取", async () => {
    const projectRoot = await createIndexedProject();
    const server = await createTestServer(projectRoot);

    const response = await fetchJson(`${server.url}/api/code?path=../secret.lua&line=1&context=0`);

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("..");
  });

  it("对未知路由返回 404", async () => {
    const projectRoot = await createIndexedProject();
    const server = await createTestServer(projectRoot);

    const response = await fetchJson(`${server.url}/missing.js`);

    expect(response.status).toBe(404);
  });

  it("静态资源文件缺失时返回 404 且服务继续可用", async () => {
    const projectRoot = await createIndexedProject();

    vi.resetModules();
    vi.doMock("node:fs/promises", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs/promises")>();

      return {
        ...actual,
        readFile: async (...args: Parameters<typeof actual.readFile>) => {
          if (String(args[0]).endsWith("node_modules/echarts/dist/echarts.min.js")) {
            const error = new Error("missing vendor asset") as NodeJS.ErrnoException;
            error.code = "ENOENT";
            throw error;
          }

          return actual.readFile(...args);
        },
      };
    });

    try {
      const { startServer: startServerWithMissingVendor } = await import("../src/server.js");
      const server = await startServerWithMissingVendor(projectRoot);
      servers.push(server);

      const missingAsset = await fetchJson(`${server.url}/vendor/echarts.min.js`);
      expect(missingAsset).toEqual({
        status: 404,
        body: { error: "资源不存在" },
      });

      const status = await fetchJson(`${server.url}/api/status`);
      expect(status.status).toBe(200);
      expect(status.body.fileCount).toBe(3);
    } finally {
      vi.doUnmock("node:fs/promises");
      vi.resetModules();
    }
  });

});

async function createIndexedProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "luagraph-serve-"));
  tempRoots.push(projectRoot);

  await writeProjectFile(
    projectRoot,
    "src/player.lua",
    'Player = setmetatable({}, { __index = Base })\nfunction Player:move()\nend\n',
  );
  await writeProjectFile(projectRoot, "src/base.lua", 'Base = class("Base")\n');
  await writeProjectFile(projectRoot, "src/main.lua", 'require("src.player")\nrequire("base." .. name)\n');
  await initializeProject(projectRoot);
  await indexProject(projectRoot);

  return projectRoot;
}

async function createTestServer(projectRoot: string): Promise<ServerHandle> {
  const server = await startServer(projectRoot);
  servers.push(server);

  return server;
}

async function writeProjectFile(
  projectRoot: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const targetPath = join(projectRoot, relativePath);

  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, content, "utf8");
}

async function fetchJson(url: string): Promise<{ readonly status: number; readonly body: any }> {
  const response = await fetch(url);

  return {
    status: response.status,
    body: await response.json(),
  };
}

