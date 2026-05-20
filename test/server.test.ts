import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

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
      fileCount: 1,
      symbolCount: 2,
      edgeCount: 2,
      parseErrorCount: 0,
      pendingSyncChangeCount: 0,
    });
  });

  it("返回 File、Symbol 和 Contains 图数据", async () => {
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
          kind: "table",
          filePath: "src/player.lua",
          startLine: 1,
        }),
      ]),
    );
    expect(response.body.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "src/player.lua",
          kind: "Contains",
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
        code: 'Player = class("Player")\nfunction Player:move()\nend',
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

  it("服务 UI 主入口静态资源", async () => {
    const projectRoot = await createIndexedProject();
    const server = await createTestServer(projectRoot);

    await expect(fetchText(`${server.url}/app.js`)).resolves.toMatchObject({
      status: 200,
      body: expect.stringContaining("LuaGraph"),
    });
    await expect(fetchText(`${server.url}/style.css`)).resolves.toMatchObject({
      status: 200,
      body: expect.stringContaining("font-family"),
    });
  });
});

async function createIndexedProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "luagraph-serve-"));
  tempRoots.push(projectRoot);

  await writeProjectFile(
    projectRoot,
    "src/player.lua",
    'Player = class("Player")\nfunction Player:move()\nend\n',
  );
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

async function fetchText(url: string): Promise<{ readonly status: number; readonly body: string }> {
  const response = await fetch(url);

  return {
    status: response.status,
    body: await response.text(),
  };
}
