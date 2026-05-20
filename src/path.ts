import nodePath from "node:path";

import type { NormalizedPath } from "./types.js";

export function normalizeRepositoryPath(pathValue: string): NormalizedPath {
  const slashPath = pathValue.replaceAll("\\", "/");
  const normalizedPath = nodePath.posix.normalize(slashPath);

  if (
    nodePath.posix.isAbsolute(normalizedPath) ||
    normalizedPath === "." ||
    normalizedPath.startsWith("../") ||
    normalizedPath.includes("/../")
  ) {
    throw new Error("路径必须是项目根内的相对路径");
  }

  return normalizedPath.replace(/^\.\//, "") as NormalizedPath;
}
