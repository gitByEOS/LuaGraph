import type {
  LuaGraphImpactResult,
  LuaGraphQueryResult,
  QueryCallEdge,
  QueryNode,
  QuerySymbolNode,
} from "./types.js";

export type GraphOutputFormat = "json" | "table" | "tree";

export function formatQueryResult(result: LuaGraphQueryResult, format: GraphOutputFormat): string {
  if (format === "json") {
    return JSON.stringify(result, null, 2);
  }

  if (format === "tree") {
    return formatQueryTree(result);
  }

  return formatQueryTable(result);
}

export function formatImpactResult(result: LuaGraphImpactResult, format: GraphOutputFormat): string {
  if (format === "json") {
    return JSON.stringify(result, null, 2);
  }

  if (format === "tree") {
    return formatImpactTree(result);
  }

  return formatImpactTable(result);
}

function formatQueryTable(result: LuaGraphQueryResult): string {
  return [
    tableRow(["expression", result.expression]),
    tableRow(["count", result.count]),
    queryTableHeader(),
    ...result.nodes.map(formatQueryNodeTableRow),
  ].join("\n");
}

function formatQueryTree(result: LuaGraphQueryResult): string {
  const relation = parseRelationExpression(result.expression);

  if (relation === undefined) {
    return [result.expression, ...result.nodes.map((node) => `  ${formatQueryNodeLine(node)}`)].join(
      "\n",
    );
  }

  const nodes = getSymbolNodes(result.nodes);
  const lines = [`${relation.key}:${relation.value}`];
  const visited = new Set<string>();
  const rootId = relation.key === "callers" ? "callers-root" : "callees-root";

  appendRelationChildren(lines, relation.key, rootId, nodes, result.edges, visited, 1);
  return lines.join("\n");
}

function formatImpactTable(result: LuaGraphImpactResult): string {
  return [
    tableRow(["input", result.input]),
    tableRow(["depth", result.depth]),
    tableRow(["count", result.count]),
    "seeds",
    symbolTableHeader(),
    ...result.seeds.map(formatSymbolTableRow),
    "affected",
    symbolTableHeader(),
    ...result.nodes.map(formatSymbolTableRow),
    "files",
    "path",
    ...result.files,
  ].join("\n");
}

function formatImpactTree(result: LuaGraphImpactResult): string {
  const nodes = new Map(result.nodes.map((node) => [node.id, node]));
  const lines = [`impact:${result.input} depth=${result.depth}`];
  const visited = new Set(result.seeds.map((seed) => seed.id));

  for (const seed of [...result.seeds].sort(compareSymbols)) {
    lines.push(`  ${formatSymbolLine(seed)}`);
    appendImpactCallers(lines, seed.id, nodes, result.edges, visited, 2);
  }

  return lines.join("\n");
}

function appendRelationChildren(
  lines: string[],
  relation: "callers" | "callees",
  originId: string,
  nodes: Map<string, QuerySymbolNode>,
  edges: readonly QueryCallEdge[],
  visited: Set<string>,
  depth: number,
): void {
  const children = getRelationChildren(relation, originId, nodes, edges);

  for (const child of children) {
    const marker = visited.has(child.node.id) ? " (cycle)" : "";
    lines.push(`${"  ".repeat(depth)}${formatSymbolLine(child.node)}${marker}`);

    if (!visited.has(child.node.id)) {
      visited.add(child.node.id);
      appendRelationChildren(lines, relation, child.node.id, nodes, edges, visited, depth + 1);
    }
  }
}

function appendImpactCallers(
  lines: string[],
  targetId: string,
  nodes: Map<string, QuerySymbolNode>,
  edges: readonly QueryCallEdge[],
  visited: Set<string>,
  depth: number,
): void {
  const callers = edges
    .filter((edge) => edge.target === targetId)
    .map((edge) => nodes.get(edge.source))
    .filter(isSymbolNode)
    .sort(compareSymbols);

  for (const caller of callers) {
    const marker = visited.has(caller.id) ? " (cycle)" : "";
    lines.push(`${"  ".repeat(depth)}${formatSymbolLine(caller)}${marker}`);

    if (!visited.has(caller.id)) {
      visited.add(caller.id);
      appendImpactCallers(lines, caller.id, nodes, edges, visited, depth + 1);
    }
  }
}

function getRelationChildren(
  relation: "callers" | "callees",
  originId: string,
  nodes: Map<string, QuerySymbolNode>,
  edges: readonly QueryCallEdge[],
): { readonly node: QuerySymbolNode; readonly edge: QueryCallEdge }[] {
  return edges
    .filter((edge) => isRelationEdge(relation, edge, originId, nodes))
    .map((edge) => ({ edge, node: nodes.get(relation === "callers" ? edge.source : edge.target) }))
    .filter((entry): entry is { readonly node: QuerySymbolNode; readonly edge: QueryCallEdge } =>
      isSymbolNode(entry.node),
    )
    .sort((left, right) => compareSymbols(left.node, right.node));
}

function isRelationEdge(
  relation: "callers" | "callees",
  edge: QueryCallEdge,
  originId: string,
  nodes: Map<string, QuerySymbolNode>,
): boolean {
  if (relation === "callers") {
    return edge.target === originId || (originId === "callers-root" && !nodes.has(edge.target));
  }

  return edge.source === originId || (originId === "callees-root" && !nodes.has(edge.source));
}

function parseRelationExpression(
  expression: string,
): { readonly key: "callers" | "callees"; readonly value: string } | undefined {
  const relation = expression.split(/\s+/).map(parseExpressionPart).find(isRelationPart);

  if (relation === undefined) {
    return undefined;
  }

  return relation;
}

function parseExpressionPart(
  part: string,
): { readonly key: string; readonly value: string } | undefined {
  const separatorIndex = part.indexOf(":");

  if (separatorIndex <= 0 || separatorIndex === part.length - 1) {
    return undefined;
  }

  return {
    key: part.slice(0, separatorIndex),
    value: part.slice(separatorIndex + 1),
  };
}

function isRelationPart(
  part: { readonly key: string; readonly value: string } | undefined,
): part is { readonly key: "callers" | "callees"; readonly value: string } {
  return part?.key === "callers" || part?.key === "callees";
}

function getSymbolNodes(nodes: readonly QueryNode[]): Map<string, QuerySymbolNode> {
  return new Map(nodes.filter(isSymbolNode).map((node) => [node.id, node]));
}

function formatQueryNodeLine(node: QueryNode): string {
  if (node.type === "File") {
    return `${node.kind} ${node.path}`;
  }

  return formatSymbolLine(node);
}

function formatQueryNodeTableRow(node: QueryNode): string {
  if (node.type === "File") {
    return tableRow([node.type, node.kind, node.path, "", "", ""]);
  }

  return tableRow([node.type, node.kind, node.filePath, node.startLine, node.qualifiedName, node.signature]);
}

function formatSymbolLine(node: QuerySymbolNode): string {
  return `${node.filePath}:${node.startLine} ${node.kind} ${node.qualifiedName} ${node.signature}`;
}

function formatSymbolTableRow(node: QuerySymbolNode): string {
  return tableRow([node.type, node.kind, node.filePath, node.startLine, node.qualifiedName, node.signature]);
}

function queryTableHeader(): string {
  return tableRow(["type", "kind", "path/filePath", "line", "qualifiedName", "signature"]);
}

function symbolTableHeader(): string {
  return tableRow(["type", "kind", "filePath", "line", "qualifiedName", "signature"]);
}

function tableRow(values: readonly (number | string)[]): string {
  return values.map(String).join("\t");
}

function compareSymbols(left: QuerySymbolNode, right: QuerySymbolNode): number {
  return (
    left.filePath.localeCompare(right.filePath) ||
    left.startLine - right.startLine ||
    left.kind.localeCompare(right.kind) ||
    left.qualifiedName.localeCompare(right.qualifiedName)
  );
}

function isSymbolNode(node: QueryNode | QuerySymbolNode | undefined): node is QuerySymbolNode {
  return node?.type === "Symbol";
}
