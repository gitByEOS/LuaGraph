import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Connection, Database, type QueryResult } from "kuzu";

import { readCodeSnippet } from "./code.js";
import { readConfig } from "./config.js";
import { getProjectStatus } from "./status.js";
import { getKuzuDatabasePath } from "./store.js";

export type ServerOptions = {
  readonly port?: number;
  readonly host?: string;
};

export type ServerHandle = {
  readonly url: string;
  readonly server: Server;
  readonly close: () => Promise<void>;
};

type GraphNode = {
  readonly id: string;
  readonly type: "File" | "Symbol";
  readonly kind: string;
  readonly label: string;
  readonly filePath: string;
  readonly startLine: number | null;
  readonly signature: string;
};

type GraphEdge = {
  readonly source: string;
  readonly target: string;
  readonly kind: "Contains";
};

type GraphResult = {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
};

type StaticAsset = {
  readonly path: string;
  readonly contentType: string;
};

const moduleDir = dirname(fileURLToPath(import.meta.url));

export async function startServer(
  projectRoot: string,
  options: ServerOptions = {},
): Promise<ServerHandle> {
  const resolvedProjectRoot = resolve(projectRoot);
  const server = createServer((request, response) => {
    void handleRequest(resolvedProjectRoot, request, response).catch((error: unknown) => {
      writeError(response, error);
    });
  });

  await listen(server, options);

  return {
    url: createServerUrl(server, options.host ?? "127.0.0.1"),
    server,
    close: () => closeServer(server),
  };
}

async function handleRequest(
  projectRoot: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (request.method !== "GET") {
    throw new HttpError(405, "只支持 GET 请求");
  }

  const url = new URL(request.url ?? "/", "http://localhost");

  if (url.pathname === "/api/status") {
    writeJson(response, 200, await getProjectStatus(projectRoot));
    return;
  }

  if (url.pathname === "/api/graph") {
    writeJson(response, 200, await readProjectGraph(projectRoot));
    return;
  }

  if (url.pathname === "/api/code") {
    writeJson(response, 200, await readCodeApi(projectRoot, url));
    return;
  }

  await writeStaticAsset(response, url.pathname);
}

async function readCodeApi(projectRoot: string, url: URL): Promise<unknown> {
  const path = url.searchParams.get("path");

  if (path === null) {
    throw new HttpError(400, "缺少 path 参数");
  }

  try {
    return await readCodeSnippet(projectRoot, {
      path,
      line: readRequiredLine(url, "line"),
      context: readContext(url),
    });
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : "读取代码失败");
  }
}

async function readProjectGraph(projectRoot: string): Promise<GraphResult> {
  const config = await readConfig(projectRoot);

  if (config === undefined) {
    throw new Error(`项目缺少配置文件：${join(projectRoot, ".luagraph/config.json")}`);
  }

  const databasePath = getKuzuDatabasePath(resolve(projectRoot, config.databaseDir));
  if (!(await pathExists(databasePath))) {
    return { nodes: [], edges: [] };
  }

  const database = new Database(databasePath, undefined, undefined, true);
  const connection = new Connection(database);

  try {
    return {
      nodes: [...(await readFileNodes(connection)), ...(await readSymbolNodes(connection))],
      edges: await readContainsEdges(connection),
    };
  } finally {
    await connection.close();
    await database.close();
  }
}

async function readFileNodes(connection: Connection): Promise<GraphNode[]> {
  const rows = await queryRows(connection, "MATCH (file:File) RETURN file.path AS path;");

  return rows.map((row) => {
    const path = String(row.path);

    return {
      id: path,
      type: "File",
      kind: "file",
      label: path,
      filePath: path,
      startLine: null,
      signature: "",
    };
  });
}

async function readSymbolNodes(connection: Connection): Promise<GraphNode[]> {
  const rows = await queryRows(
    connection,
    "MATCH (symbol:Symbol) RETURN symbol.id AS id, symbol.kind AS kind, symbol.qualifiedName AS qualifiedName, symbol.name AS name, symbol.filePath AS filePath, symbol.startLine AS startLine, symbol.signature AS signature;",
  );

  return rows.map((row) => ({
    id: String(row.id),
    type: "Symbol",
    kind: String(row.kind),
    label: String(row.qualifiedName ?? row.name),
    filePath: String(row.filePath),
    startLine: toNullableNumber(row.startLine),
    signature: String(row.signature ?? ""),
  }));
}

async function readContainsEdges(connection: Connection): Promise<GraphEdge[]> {
  const fileEdges = await queryRows(
    connection,
    "MATCH (source:File)-[edge:Contains]->(target:Symbol) RETURN source.path AS source, target.id AS target;",
  );
  const symbolEdges = await queryRows(
    connection,
    "MATCH (source:Symbol)-[edge:Contains]->(target:Symbol) RETURN source.id AS source, target.id AS target;",
  );

  return [...fileEdges, ...symbolEdges].map((row) => ({
    source: String(row.source),
    target: String(row.target),
    kind: "Contains",
  }));
}

async function queryRows(connection: Connection, cypher: string): Promise<Record<string, unknown>[]> {
  let result: QueryResult | QueryResult[] | undefined;

  try {
    result = await connection.query(cypher);
    const queryResult = Array.isArray(result) ? result[0] : result;

    if (queryResult === undefined) {
      throw new Error("图查询未返回结果");
    }

    return (await queryResult.getAll()) as Record<string, unknown>[];
  } finally {
    closeQueryResult(result);
  }
}

function closeQueryResult(result: QueryResult | QueryResult[] | undefined): void {
  const results = Array.isArray(result) ? result : result === undefined ? [] : [result];

  for (const item of results) {
    item.close();
  }
}

async function writeStaticAsset(response: ServerResponse, path: string): Promise<void> {
  const asset = resolveStaticAsset(path);

  if (asset === undefined) {
    throw new HttpError(404, "资源不存在");
  }

  try {
    const content = await readFile(asset.path);

    response.writeHead(200, { "Content-Type": asset.contentType });
    response.end(content);
  } catch (error) {
    if (isMissingPathError(error)) {
      throw new HttpError(404, "资源不存在");
    }

    throw error;
  }
}

function resolveStaticAsset(path: string): StaticAsset | undefined {
  if (path === "/vendor/echarts.min.js") {
    return {
      path: join(moduleDir, "../node_modules/echarts/dist/echarts.min.js"),
      contentType: "text/javascript; charset=utf-8",
    };
  }

  const relativePath = readWebAssetPath(path);
  if (relativePath === undefined) {
    return undefined;
  }

  return {
    path: join(moduleDir, "web", relativePath),
    contentType: readContentType(relativePath),
  };
}

function readWebAssetPath(path: string): string | undefined {
  if (path === "/") {
    return "index.html";
  }

  if (path === "/web/app.js") {
    return "app.js";
  }

  if (path === "/app.js") {
    return "app.js";
  }

  if (path === "/web/style.css") {
    return "style.css";
  }

  if (path === "/style.css") {
    return "style.css";
  }

  return undefined;
}

function readContentType(path: string): string {
  if (extname(path) === ".js") {
    return "text/javascript; charset=utf-8";
  }

  if (extname(path) === ".css") {
    return "text/css; charset=utf-8";
  }

  return "text/html; charset=utf-8";
}

function readRequiredLine(url: URL, name: "line"): number {
  const value = url.searchParams.get(name);

  if (value === null) {
    throw new HttpError(400, `缺少 ${name} 参数`);
  }

  const line = Number(value);
  if (!Number.isInteger(line)) {
    throw new HttpError(400, `${name} 必须是整数`);
  }

  return line;
}

function readContext(url: URL): number {
  const value = url.searchParams.get("context");

  if (value === null) {
    return 0;
  }

  const context = Number(value);
  if (!Number.isInteger(context)) {
    throw new HttpError(400, "context 必须是整数");
  }

  return context;
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(`${JSON.stringify(body)}\n`);
}

function writeError(response: ServerResponse, error: unknown): void {
  const statusCode = error instanceof HttpError ? error.statusCode : 500;
  const message = error instanceof Error ? error.message : "未知错误";

  writeJson(response, statusCode, { error: message });
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  return Number(value);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isMissingPathError(error)) {
      return false;
    }

    throw error;
  }
}

async function listen(server: Server, options: ServerOptions): Promise<void> {
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(options.port ?? 0, options.host ?? "127.0.0.1", () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => {
      if (error) {
        rejectClose(error);
        return;
      }

      resolveClose();
    });
  });
}

function createServerUrl(server: Server, host: string): string {
  const address = server.address();

  if (address === null || typeof address === "string") {
    throw new Error("服务地址不可用");
  }

  return `http://${host}:${address.port}`;
}

function isMissingPathError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
