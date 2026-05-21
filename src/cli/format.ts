import type {
  LuaGraphImpactResult,
  LuaGraphQueryResult,
  QueryCallEdge,
  QueryEdge,
  QueryNode,
  QueryRequireEdge,
  QuerySymbolNode,
} from "../core/project-types.js";

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
  const relation = parseRelationExpression(result.expression);

  if (relation?.key === "requires" || relation?.key === "dependents") {
    const rows = getRequireRows(getRequireEdges(result.edges)).map((edge) => [
      edge.source,
      edge.target,
      edge.moduleName,
      edge.isResolved ? "true" : "false",
    ]);

    return [renderAsciiTable(["Requiring File", "Required File", "Module", "Resolved"], rows), `${rows.length} rows, target: ${relation.value}`].join("\n");
  }

  if (relation !== undefined) {
    if (isCallRelation(relation.key)) {
      const callEdges = getCallEdges(result.edges);
      const title = relation.key === "callers" ? "Caller" : "Callee";
      const rows = getRelationRows(relation.key, getSymbolNodes(result.nodes), callEdges).map(({ edge, node }) => [
        node.qualifiedName,
        node.kind,
        node.filePath,
        edge.kind === "Calls" ? edge.line : "",
        edge.kind === "Calls" ? edge.column : "",
      ]);
      const target = formatTargetSummary(relation.value, getRelationRoots(relation.key, result.nodes, callEdges)[0]);

      return [renderAsciiTable([title, "Kind", "File", "Line", "Col"], rows), `${rows.length} rows, target: ${target}`].join(
        "\n",
      );
    }

    const rows = getExtendsRows(getExtendsEdges(result.edges)).map((edge) => [
      formatSymbolIdName(edge.source),
      formatSymbolIdName(edge.target),
      formatSymbolIdLocation(edge.source),
      formatSymbolIdLocation(edge.target),
    ]);
    const target = formatTargetSummary(relation.value, getRelationRoots(relation.key, result.nodes, result.edges)[0]);

    return [renderAsciiTable(["Child", "Parent", "Child File", "Parent File"], rows), `${rows.length} rows, target: ${target}`].join(
      "\n",
    );
  }

  const rows = result.nodes.map((node) => {
    if (node.type === "File") {
      return [node.path, node.kind, node.path, "", ""];
    }

    return [node.qualifiedName, node.kind, node.filePath, node.startLine, node.signature];
  });

  return [
    renderAsciiTable(["Name", "Kind", "File", "Line", "Signature"], rows),
    `${rows.length} rows, target: ${result.expression}`,
  ].join("\n");
}

function formatQueryTree(result: LuaGraphQueryResult): string {
  const relation = parseRelationExpression(result.expression);

  if (relation === undefined) {
    return [result.expression, ...result.nodes.map((node) => `  ${formatQueryNodeLine(node)}`)].join("\n");
  }

  if (relation.key === "requires" || relation.key === "dependents") {
    const nodes = getFileNodes(result.nodes);
    const edges = getRequireEdges(result.edges);

    return renderRequireTree(relation.key, relation.value, relation.value, nodes, edges, new Set([relation.value]));
  }

  const nodes = getSymbolNodes(result.nodes);
  const symbolRelation = relation as { readonly key: SymbolRelationKey; readonly value: string };
  const roots = getRelationRoots(symbolRelation.key, result.nodes, result.edges);

  if (roots.length === 0) {
    return formatTargetRoot(symbolRelation.value, undefined);
  }

  return roots
    .map((root) => renderRelationTree(symbolRelation.key, formatTargetRoot(symbolRelation.value, root), root.id, nodes, result.edges))
    .join("\n\n");
}

function formatImpactTable(result: LuaGraphImpactResult): string {
  return [
    `input: ${result.input}`,
    `depth: ${result.depth}`,
    `count: ${result.count}`,
    "",
    "seeds",
    renderAsciiTable(["Name", "Kind", "File", "Line", "Signature"], result.seeds.map(toSymbolTableCells)),
    `${result.seeds.length} rows`,
    "",
    "affected",
    renderAsciiTable(["Name", "Kind", "File", "Line", "Signature"], result.nodes.map(toSymbolTableCells)),
    `${result.nodes.length} rows`,
    "",
    "files",
    renderAsciiTable(["Path"], result.files.map((file) => [file])),
    `${result.files.length} rows`,
  ].join("\n");
}

function formatImpactTree(result: LuaGraphImpactResult): string {
  const nodes = new Map([...result.seeds, ...result.nodes].map((node) => [node.id, node]));
  const symbolEdges = result.edges.filter((edge) => edge.kind === "Calls" || edge.kind === "Extends");

  if (result.seeds.length === 0) {
    return formatTargetRoot(result.input, undefined);
  }

  return [...result.seeds]
    .sort(compareSymbols)
    .map((seed) => renderImpactSymbolTree(formatSymbolRoot(seed), seed.id, nodes, symbolEdges))
    .join("\n\n");
}

type TableValue = number | string;
type RelationKey = "callers" | "callees" | "extends" | "subclasses" | "requires" | "dependents";
type SymbolRelationKey = "callers" | "callees" | "extends" | "subclasses";

type RelationRoot = {
  readonly id: string;
  readonly filePath?: string;
  readonly line?: number;
};

type RelationRow = {
  readonly node: QuerySymbolNode;
  readonly edge: QueryEdge;
};

type TreeNode = {
  readonly label: string;
  readonly children: readonly TreeNode[];
};

function renderAsciiTable(headers: readonly string[], rows: readonly (readonly TableValue[])[]): string {
  const stringRows = rows.map((row) => row.map(String));
  const widths = headers.map((header, index) =>
    Math.max(asciiWidth(header), ...stringRows.map((row) => asciiWidth(row[index] ?? ""))),
  );
  const border = renderTableBorder(widths);
  const lines = [
    border,
    renderTableRow(headers, widths),
    border,
    ...stringRows.map((row) => renderTableRow(row, widths)),
    border,
  ];

  return lines.join("\n");
}

function renderTableBorder(widths: readonly number[]): string {
  return `+${widths.map((width) => "-".repeat(width + 2)).join("+")}+`;
}

function renderTableRow(values: readonly string[], widths: readonly number[]): string {
  return `| ${widths.map((width, index) => padAscii(values[index] ?? "", width)).join(" | ")} |`;
}

function padAscii(value: string, width: number): string {
  return value + " ".repeat(Math.max(0, width - asciiWidth(value)));
}

function asciiWidth(value: string): number {
  return value.length;
}

function renderRelationTree(
  relation: SymbolRelationKey,
  rootLabel: string,
  rootId: string,
  nodes: Map<string, QuerySymbolNode>,
  edges: readonly QueryEdge[],
): string {
  return renderTree(buildRelationTree(relation, rootLabel, rootId, nodes, edges, new Set([rootId])));
}

function renderImpactSymbolTree(
  rootLabel: string,
  rootId: string,
  nodes: Map<string, QuerySymbolNode>,
  edges: readonly QueryEdge[],
): string {
  return renderTree(buildImpactSymbolTree(rootLabel, rootId, nodes, edges, new Set([rootId])));
}

function renderRequireTree(
  relation: "requires" | "dependents",
  label: string,
  originPath: string,
  nodes: Map<string, Extract<QueryNode, { readonly type: "File" }>>,
  edges: readonly QueryRequireEdge[],
  path: ReadonlySet<string>,
): string {
  const children = edges
    .filter((edge) => (relation === "requires" ? edge.source === originPath : edge.target === originPath))
    .map((edge) => {
      const childPath = relation === "requires" ? edge.target : edge.source;
      const node = nodes.get(childPath);
      const marker = path.has(childPath) ? " (cycle)" : "";
      const prefix = relation === "requires" ? "requires" : "required by";
      const childLabel = `${prefix} ${node?.path ?? childPath} [${edge.moduleName}, resolved=${edge.isResolved ? "true" : "false"}]${marker}`;

      if (path.has(childPath)) {
        return { label: childLabel, children: [] };
      }

      return buildRequireTree(relation, childLabel, childPath, nodes, edges, new Set([...path, childPath]));
    });

  return renderTree({ label, children });
}

function buildRequireTree(
  relation: "requires" | "dependents",
  label: string,
  originPath: string,
  nodes: Map<string, Extract<QueryNode, { readonly type: "File" }>>,
  edges: readonly QueryRequireEdge[],
  path: ReadonlySet<string>,
): TreeNode {
  const children = edges
    .filter((edge) => (relation === "requires" ? edge.source === originPath : edge.target === originPath))
    .map((edge) => {
      const childPath = relation === "requires" ? edge.target : edge.source;
      const marker = path.has(childPath) ? " (cycle)" : "";
      const prefix = relation === "requires" ? "requires" : "required by";
      const childLabel = `${prefix} ${childPath} [${edge.moduleName}, resolved=${edge.isResolved ? "true" : "false"}]${marker}`;

      if (path.has(childPath)) {
        return { label: childLabel, children: [] };
      }

      return buildRequireTree(relation, childLabel, childPath, nodes, edges, new Set([...path, childPath]));
    });

  return { label, children };
}

function buildRelationTree(
  relation: SymbolRelationKey,
  label: string,
  originId: string,
  nodes: Map<string, QuerySymbolNode>,
  edges: readonly QueryEdge[],
  path: ReadonlySet<string>,
): TreeNode {
  const children = getRelationChildren(relation, originId, nodes, edges).map(({ edge, node }) =>
    buildRelationChild(relation, edge, node, nodes, edges, path),
  );

  return { label, children };
}

function buildImpactSymbolTree(
  label: string,
  originId: string,
  nodes: Map<string, QuerySymbolNode>,
  edges: readonly QueryEdge[],
  path: ReadonlySet<string>,
): TreeNode {
  const children = getImpactSymbolChildren(originId, nodes, edges).map(({ edge, node }) =>
    buildImpactSymbolChild(edge, node, nodes, edges, path),
  );

  return { label, children };
}

function buildImpactSymbolChild(
  edge: QueryEdge,
  node: QuerySymbolNode,
  nodes: Map<string, QuerySymbolNode>,
  edges: readonly QueryEdge[],
  path: ReadonlySet<string>,
): TreeNode {
  const marker = path.has(node.id) ? " (cycle)" : "";
  const label = `${formatImpactChildLabel(edge, node)}${marker}`;

  if (path.has(node.id)) {
    return { label, children: [] };
  }

  return buildImpactSymbolTree(label, node.id, nodes, edges, new Set([...path, node.id]));
}

function buildRelationChild(
  relation: SymbolRelationKey,
  edge: QueryEdge,
  node: QuerySymbolNode,
  nodes: Map<string, QuerySymbolNode>,
  edges: readonly QueryEdge[],
  path: ReadonlySet<string>,
): TreeNode {
  const marker = path.has(node.id) ? " (cycle)" : "";
  const label = `${formatRelationChildLabel(relation, edge, node)}${marker}`;

  if (path.has(node.id)) {
    return { label, children: [] };
  }

  return buildRelationTree(relation, label, node.id, nodes, edges, new Set([...path, node.id]));
}

function renderTree(root: TreeNode): string {
  return [root.label, ...renderTreeChildren(root.children, "")].join("\n");
}

function renderTreeChildren(children: readonly TreeNode[], prefix: string): string[] {
  return children.flatMap((child, index) => {
    const isLast = index === children.length - 1;
    const connector = isLast ? "└── " : "├── ";
    const childPrefix = `${prefix}${isLast ? "    " : "│   "}`;

    return [`${prefix}${connector}${child.label}`, ...renderTreeChildren(child.children, childPrefix)];
  });
}

function getRelationRows(
  relation: SymbolRelationKey,
  nodes: Map<string, QuerySymbolNode>,
  edges: readonly QueryEdge[],
): RelationRow[] {
  return edges
    .filter((edge) => isEdgeForRelation(relation, edge))
    .map((edge) => ({ edge, node: nodes.get(getRelationNodeId(relation, edge)) }))
    .filter((entry): entry is RelationRow => isSymbolNode(entry.node))
    .sort((left, right) => compareSymbols(left.node, right.node));
}

function getRequireRows(edges: readonly QueryRequireEdge[]): QueryRequireEdge[] {
  return [...edges].sort(
    (left, right) =>
      left.source.localeCompare(right.source) ||
      left.target.localeCompare(right.target) ||
      left.moduleName.localeCompare(right.moduleName),
  );
}

function getExtendsRows(edges: readonly Extract<QueryEdge, { readonly kind: "Extends" }>[]): Extract<QueryEdge, { readonly kind: "Extends" }>[] {
  return [...edges].sort(
    (left, right) =>
      formatSymbolIdName(left.source).localeCompare(formatSymbolIdName(right.source)) ||
      formatSymbolIdName(left.target).localeCompare(formatSymbolIdName(right.target)) ||
      left.source.localeCompare(right.source),
  );
}

function getRelationChildren(
  relation: SymbolRelationKey,
  originId: string,
  nodes: Map<string, QuerySymbolNode>,
  edges: readonly QueryEdge[],
): RelationRow[] {
  return edges
    .filter((edge) => isEdgeForRelation(relation, edge))
    .filter((edge) => (isReverseRelation(relation) ? edge.target === originId : edge.source === originId))
    .map((edge) => ({ edge, node: nodes.get(getRelationNodeId(relation, edge)) }))
    .filter((entry): entry is RelationRow => isSymbolNode(entry.node))
    .sort((left, right) => compareSymbols(left.node, right.node));
}

function getImpactSymbolChildren(
  originId: string,
  nodes: Map<string, QuerySymbolNode>,
  edges: readonly QueryEdge[],
): RelationRow[] {
  return edges
    .filter((edge) => (edge.kind === "Calls" || edge.kind === "Extends") && edge.target === originId)
    .map((edge) => ({ edge, node: nodes.get(edge.source) }))
    .filter((entry): entry is RelationRow => isSymbolNode(entry.node))
    .sort((left, right) => compareSymbols(left.node, right.node));
}

function getRelationRoots(
  relation: SymbolRelationKey,
  nodes: readonly QueryNode[],
  edges: readonly QueryEdge[],
): RelationRoot[] {
  const symbols = getSymbolNodes(nodes);
  const rootIds = [
    ...new Set(
      edges
        .filter((edge) => isEdgeForRelation(relation, edge))
        .map((edge) => (isReverseRelation(relation) ? edge.target : edge.source))
        .filter((id) => !symbols.has(id)),
    ),
  ].sort();

  return rootIds.map(toRelationRoot);
}

function toRelationRoot(id: string): RelationRoot {
  const parsed = parseSymbolId(id);

  return parsed === undefined ? { id } : { id, filePath: parsed.filePath, line: parsed.line };
}

function parseSymbolId(id: string): { readonly filePath: string; readonly line: number } | undefined {
  const locationIndex = id.lastIndexOf("#");
  const location = locationIndex === -1 ? "" : id.slice(locationIndex + 1);
  const separatorIndex = location.indexOf(":");
  const line = Number(location.slice(0, separatorIndex));

  if (locationIndex === -1 || separatorIndex === -1 || !Number.isInteger(line)) {
    return undefined;
  }

  return { filePath: id.slice(0, id.indexOf("#")), line };
}

function formatSymbolIdName(id: string): string {
  const segments = id.split("#");

  return segments[2] ?? id;
}

function formatSymbolIdLocation(id: string): string {
  const parsed = parseSymbolId(id);

  return parsed === undefined ? id : `${parsed.filePath}:${parsed.line}`;
}

function parseRelationExpression(
  expression: string,
): { readonly key: RelationKey; readonly value: string } | undefined {
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
): part is { readonly key: RelationKey; readonly value: string } {
  return (
    part?.key === "callers" ||
    part?.key === "callees" ||
    part?.key === "extends" ||
    part?.key === "subclasses" ||
    part?.key === "requires" ||
    part?.key === "dependents"
  );
}

function getSymbolNodes(nodes: readonly QueryNode[]): Map<string, QuerySymbolNode> {
  return new Map(nodes.filter(isSymbolNode).map((node) => [node.id, node]));
}

function getFileNodes(nodes: readonly QueryNode[]): Map<string, Extract<QueryNode, { readonly type: "File" }>> {
  return new Map(nodes.filter(isFileNode).map((node) => [node.id, node]));
}

function getCallEdges(edges: readonly QueryEdge[]): QueryCallEdge[] {
  return edges.filter((edge): edge is QueryCallEdge => edge.kind === "Calls");
}

function getRequireEdges(edges: readonly QueryEdge[]): QueryRequireEdge[] {
  return edges.filter((edge): edge is QueryRequireEdge => edge.kind === "Requires");
}

function getExtendsEdges(edges: readonly QueryEdge[]): Extract<QueryEdge, { readonly kind: "Extends" }>[] {
  return edges.filter((edge): edge is Extract<QueryEdge, { readonly kind: "Extends" }> => edge.kind === "Extends");
}

function formatQueryNodeLine(node: QueryNode): string {
  if (node.type === "File") {
    return `${node.kind} ${node.path}`;
  }

  return formatSymbolLine(node);
}

function formatSymbolLine(node: QuerySymbolNode): string {
  return `${node.filePath}:${node.startLine} ${node.kind} ${node.qualifiedName} ${node.signature}`;
}

function toSymbolTableCells(node: QuerySymbolNode): readonly TableValue[] {
  return [node.qualifiedName, node.kind, node.filePath, node.startLine, node.signature];
}

function formatSymbolRoot(node: QuerySymbolNode): string {
  return `${formatCallableName(node.qualifiedName)}  (${node.filePath}:${node.startLine})`;
}

function formatTargetRoot(target: string, root: RelationRoot | undefined): string {
  return `${formatCallableName(target)}${root?.filePath === undefined ? "" : `  (${root.filePath}:${root.line})`}`;
}

function formatTargetSummary(target: string, root: RelationRoot | undefined): string {
  if (target === "*") {
    return target;
  }

  return `${target}${root?.filePath === undefined ? "" : ` (${root.filePath}:${root.line})`}`;
}

function formatCallableName(name: string): string {
  return name.endsWith(")") ? name : `${name}()`;
}

function formatRelationChildLabel(relation: SymbolRelationKey, edge: QueryEdge, node: QuerySymbolNode): string {
  if (edge.kind === "Calls") {
    const prefix = relation === "callers" ? "called by" : "calls";

    return `${prefix} ${formatCallableName(node.qualifiedName)} [${node.filePath}:${edge.line}]`;
  }

  const prefix = relation === "extends" ? "extends" : "subclass";

  return `${prefix} ${node.qualifiedName} [${node.filePath}:${node.startLine}]`;
}

function formatImpactChildLabel(edge: QueryEdge, node: QuerySymbolNode): string {
  if (edge.kind === "Extends") {
    return `subclass ${node.qualifiedName} [${node.filePath}:${node.startLine}]`;
  }

  if (edge.kind === "Calls") {
    return `called by ${formatCallableName(node.qualifiedName)} [${node.filePath}:${edge.line}]`;
  }

  return node.qualifiedName;
}

function isCallRelation(relation: SymbolRelationKey): boolean {
  return relation === "callers" || relation === "callees";
}

function isReverseRelation(relation: SymbolRelationKey): boolean {
  return relation === "callers" || relation === "subclasses";
}

function isEdgeForRelation(relation: SymbolRelationKey, edge: QueryEdge): boolean {
  return isCallRelation(relation) ? edge.kind === "Calls" : edge.kind === "Extends";
}

function getRelationNodeId(relation: SymbolRelationKey, edge: QueryEdge): string {
  return isReverseRelation(relation) ? edge.source : edge.target;
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

function isFileNode(node: QueryNode | undefined): node is Extract<QueryNode, { readonly type: "File" }> {
  return node?.type === "File";
}
