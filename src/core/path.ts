import { realpathSync } from "node:fs";
import nodePath from "node:path";

import type { NormalizedPath } from "../ast/types.js";

export function normalizeRepositoryPath(pathValue: string): NormalizedPath {
  if (pathValue.length === 0) {
    throw new Error("路径不能为空");
  }

  const slashPath = pathValue.replaceAll("\\", "/");

  if (nodePath.posix.isAbsolute(slashPath) || nodePath.win32.isAbsolute(pathValue)) {
    throw new Error("路径必须是项目根内的相对路径");
  }

  const segments = slashPath.split("/");

  if (segments.includes("..")) {
    throw new Error("路径不能包含 ..");
  }

  const normalizedPath = segments.filter((segment) => segment !== "" && segment !== ".").join("/");

  if (normalizedPath.length === 0) {
    throw new Error("路径不能指向项目根");
  }

  return normalizedPath as NormalizedPath;
}

export function resolveSafeRepositoryPath(projectRoot: string, pathValue: string): string {
  const normalizedPath = normalizeRepositoryPath(pathValue);
  const realProjectRoot = realpathSync.native(projectRoot);
  const realTargetPath = realpathSync.native(nodePath.join(realProjectRoot, normalizedPath));

  if (!isInsidePath(realProjectRoot, realTargetPath)) {
    throw new Error("真实路径不能逃逸项目根");
  }

  return realTargetPath;
}

function isInsidePath(parentPath: string, childPath: string): boolean {
  const relativePath = nodePath.relative(parentPath, childPath);

  return (
    relativePath === "" || (!relativePath.startsWith("..") && !nodePath.isAbsolute(relativePath))
  );
}
