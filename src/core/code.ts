import { readFile } from "node:fs/promises";

import { normalizeRepositoryPath, resolveSafeRepositoryPath } from "./path.js";

export type CodeSnippetRequest = {
  readonly path: string;
  readonly line: number;
  readonly context: number;
};

export type CodeSnippetResult = {
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly code: string;
};

export async function readCodeSnippet(
  projectRoot: string,
  request: CodeSnippetRequest,
): Promise<CodeSnippetResult> {
  const normalizedPath = normalizeRepositoryPath(request.path);
  const targetPath = resolveSafeRepositoryPath(projectRoot, normalizedPath);
  const content = await readFile(targetPath, "utf8");
  const lines = splitLines(content);
  const range = readLineRange(request, lines.length);

  return {
    path: normalizedPath,
    startLine: range.startLine,
    endLine: range.endLine,
    code: lines.slice(range.startLine - 1, range.endLine).join("\n"),
  };
}

function readLineRange(
  request: CodeSnippetRequest,
  lineCount: number,
): { readonly startLine: number; readonly endLine: number } {
  assertPositiveInteger(request.line, "line");
  assertNonNegativeInteger(request.context, "context");

  if (request.line > lineCount) {
    throw new Error("line 超出文件行数");
  }

  return {
    startLine: Math.max(1, request.line - request.context),
    endLine: Math.min(lineCount, request.line + request.context),
  };
}

function splitLines(content: string): string[] {
  const lines = content.split(/\r?\n/);

  if (lines.length > 1 && lines[lines.length - 1] === "") {
    return lines.slice(0, -1);
  }

  return lines;
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} 必须是正整数`);
  }
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} 必须是非负整数`);
  }
}
