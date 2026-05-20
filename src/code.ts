import { readFile } from "node:fs/promises";

import { normalizeRepositoryPath, resolveSafeRepositoryPath } from "./path.js";

export type CodeSnippetRequest = {
  readonly path: string;
  readonly startLine?: number;
  readonly endLine?: number;
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
  const startLine = request.startLine ?? 1;
  const endLine = request.endLine ?? lineCount;

  assertPositiveInteger(startLine, "startLine");
  assertPositiveInteger(endLine, "endLine");

  if (endLine < startLine) {
    throw new Error("endLine 不能小于 startLine");
  }

  if (startLine > lineCount) {
    throw new Error("startLine 超出文件行数");
  }

  return {
    startLine,
    endLine: Math.min(endLine, lineCount),
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
