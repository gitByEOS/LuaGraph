import { readdir, stat } from "node:fs/promises";
import nodePath from "node:path";

import { normalizeRepositoryPath } from "./path.js";
import type { LuaGraphConfig, NormalizedPath, ScannedLuaFile } from "./types.js";

export async function scanLuaFiles(
  projectRoot: string,
  config: LuaGraphConfig,
): Promise<ScannedLuaFile[]> {
  const includeMatcher = createPatternMatcher(config.include);
  const excludeMatcher = createPatternMatcher(config.exclude);
  const files: ScannedLuaFile[] = [];

  await scanDirectory("");

  return files.sort((left, right) => left.path.localeCompare(right.path));

  async function scanDirectory(relativeDirectory: string): Promise<void> {
    const absoluteDirectory =
      relativeDirectory === "" ? projectRoot : nodePath.join(projectRoot, relativeDirectory);
    const entries = await readdir(absoluteDirectory, { withFileTypes: true });

    for (const entry of entries) {
      const relativePath = toRepositoryPath(relativeDirectory, entry.name);

      if (entry.isDirectory()) {
        if (!excludeMatcher(relativePath)) {
          await scanDirectory(relativePath);
        }
        continue;
      }

      if (!entry.isFile() || !relativePath.endsWith(".lua") || excludeMatcher(relativePath)) {
        continue;
      }

      if (!includeMatcher(relativePath)) {
        continue;
      }

      const fileStats = await stat(nodePath.join(projectRoot, relativePath));

      files.push({
        path: relativePath,
        size: fileStats.size,
        modifiedAt: fileStats.mtime,
      });
    }
  }
}

type PatternMatcher = (path: NormalizedPath) => boolean;

export function createPatternMatcher(patterns: readonly string[]): PatternMatcher {
  const matchers = patterns.map(createSinglePatternMatcher);

  return (path) => matchers.some((matcher) => matcher(path));
}

function createSinglePatternMatcher(pattern: string): PatternMatcher {
  const normalizedPattern = normalizePattern(pattern);

  if (normalizedPattern.endsWith("/")) {
    return createDirectoryMatcher(normalizedPattern.slice(0, -1));
  }

  if (normalizedPattern.endsWith("/**")) {
    return createDescendantMatcher(normalizedPattern.slice(0, -3));
  }

  const patternSegments = normalizedPattern.split("/");

  return (path) => isSegmentMatch(patternSegments, path.split("/"));
}

function createDirectoryMatcher(directoryPath: string): PatternMatcher {
  if (directoryPath.includes("/")) {
    return createDescendantMatcher(directoryPath);
  }

  return (path) => {
    const segments = path.split("/");
    return segments.includes(directoryPath);
  };
}

function createDescendantMatcher(basePath: string): PatternMatcher {
  return (path) => path === basePath || path.startsWith(`${basePath}/`);
}

function isSegmentMatch(
  patternSegments: readonly string[],
  pathSegments: readonly string[],
  patternIndex = 0,
  pathIndex = 0,
): boolean {
  const patternSegment = patternSegments[patternIndex];

  if (patternSegment === undefined) {
    return pathIndex === pathSegments.length;
  }

  if (patternSegment === "**") {
    if (patternIndex === patternSegments.length - 1) {
      return true;
    }

    for (let nextPathIndex = pathIndex; nextPathIndex <= pathSegments.length; nextPathIndex += 1) {
      if (isSegmentMatch(patternSegments, pathSegments, patternIndex + 1, nextPathIndex)) {
        return true;
      }
    }

    return false;
  }

  const pathSegment = pathSegments[pathIndex];

  if (pathSegment === undefined || !isPathSegmentMatch(patternSegment, pathSegment)) {
    return false;
  }

  return isSegmentMatch(patternSegments, pathSegments, patternIndex + 1, pathIndex + 1);
}

function isPathSegmentMatch(patternSegment: string, pathSegment: string): boolean {
  const regex = new RegExp(`^${toSegmentRegexSource(patternSegment)}$`);

  return regex.test(pathSegment);
}

function toSegmentRegexSource(patternSegment: string): string {
  return [...patternSegment]
    .map((character) => (character === "*" ? "[^/]*" : escapeRegex(character)))
    .join("");
}

function normalizePattern(pattern: string): string {
  return pattern.replaceAll("\\", "/").replaceAll(/\/+/g, "/").replace(/^\.\//, "");
}

function toRepositoryPath(relativeDirectory: string, entryName: string): NormalizedPath {
  const relativePath = relativeDirectory === "" ? entryName : `${relativeDirectory}/${entryName}`;

  return normalizeRepositoryPath(relativePath);
}

function escapeRegex(value: string): string {
  return value.replaceAll(/[.+?^${}()|[\]\\]/g, "\\$&");
}
