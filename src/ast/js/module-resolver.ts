import { existsSync, readFileSync } from "node:fs";
import nodePath from "node:path";

import type { NormalizedPath } from "../types.js";

type CompilerPathConfig = {
  readonly baseUrl?: string;
  readonly paths?: Readonly<Record<string, readonly string[]>>;
};

type TsConfig = {
  readonly compilerOptions?: CompilerPathConfig;
};

export type JsModuleResolverOptions = {
  readonly configRoot?: string;
  readonly compilerOptions?: CompilerPathConfig;
};

const jsExtensions = [".ts", ".tsx", ".js", ".jsx"] as const;
const tsSourceExtensionsByImportExtension = new Map<string, readonly string[]>([
  [".js", [".ts", ".tsx"]],
  [".jsx", [".tsx"]],
]);

export function resolveJsModulePath(
  sourcePath: NormalizedPath,
  moduleName: string,
  filePaths: readonly NormalizedPath[],
  options: JsModuleResolverOptions = {},
): NormalizedPath | undefined {
  if (isRelativeModule(moduleName)) {
    return resolveCandidatePath(createRelativeBasePath(sourcePath, moduleName), filePaths);
  }

  const compilerOptions = options.compilerOptions ?? readCompilerOptions(options.configRoot ?? process.cwd());

  return resolvePathsCandidate(moduleName, compilerOptions, filePaths);
}

function resolvePathsCandidate(
  moduleName: string,
  compilerOptions: CompilerPathConfig,
  filePaths: readonly NormalizedPath[],
): NormalizedPath | undefined {
  const paths = compilerOptions.paths ?? {};
  const baseUrl = normalizeConfigPath(compilerOptions.baseUrl ?? ".");

  for (const [pattern, targets] of Object.entries(paths)) {
    const wildcard = matchPathPattern(pattern, moduleName);

    if (wildcard === undefined) {
      continue;
    }

    for (const target of targets) {
      const mappedPath = normalizeConfigPath(target.replaceAll("*", wildcard));
      const candidate = normalizePath(`${baseUrl}/${mappedPath}`);
      const match = resolveCandidatePath(candidate, filePaths);

      if (match !== undefined) {
        return match;
      }
    }
  }

  return undefined;
}

function resolveCandidatePath(basePath: string, filePaths: readonly NormalizedPath[]): NormalizedPath | undefined {
  const candidates = createCandidates(basePath);

  for (const candidate of candidates) {
    const match = filePaths.find((filePath) => filePath === candidate);

    if (match !== undefined) {
      return match;
    }
  }

  return undefined;
}

function createCandidates(basePath: string): readonly NormalizedPath[] {
  const normalized = normalizePath(basePath);
  const extension = nodePath.posix.extname(normalized);

  if (jsExtensions.includes(extension as (typeof jsExtensions)[number])) {
    const sourceExtensions = tsSourceExtensionsByImportExtension.get(extension) ?? [];
    const withoutExtension = normalized.slice(0, -extension.length);

    return [
      normalized as NormalizedPath,
      ...sourceExtensions.map((item) => `${withoutExtension}${item}` as NormalizedPath),
      ...jsExtensions.map((item) => `${normalized}/index${item}` as NormalizedPath),
    ];
  }

  return [
    ...jsExtensions.map((item) => `${normalized}${item}` as NormalizedPath),
    ...jsExtensions.map((item) => `${normalized}/index${item}` as NormalizedPath),
  ];
}

function createRelativeBasePath(sourcePath: NormalizedPath, moduleName: string): string {
  const sourceDir = nodePath.posix.dirname(sourcePath);

  return normalizePath(nodePath.posix.join(sourceDir === "." ? "" : sourceDir, moduleName));
}

function readCompilerOptions(configRoot: string): CompilerPathConfig {
  const config = readConfig(configRoot, "tsconfig.json") ?? readConfig(configRoot, "jsconfig.json");

  return config?.compilerOptions ?? {};
}

function readConfig(configRoot: string, fileName: string): TsConfig | undefined {
  const configPath = nodePath.join(configRoot, fileName);

  if (!existsSync(configPath)) {
    return undefined;
  }

  return JSON.parse(stripJsonComments(readFileSync(configPath, "utf8"))) as TsConfig;
}

function stripJsonComments(value: string): string {
  return value.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function matchPathPattern(pattern: string, moduleName: string): string | undefined {
  if (!pattern.includes("*")) {
    return pattern === moduleName ? "" : undefined;
  }

  const [prefix = "", suffix = ""] = pattern.split("*", 2);

  if (!moduleName.startsWith(prefix) || !moduleName.endsWith(suffix)) {
    return undefined;
  }

  return moduleName.slice(prefix.length, moduleName.length - suffix.length);
}

function isRelativeModule(moduleName: string): boolean {
  return moduleName.startsWith("./") || moduleName.startsWith("../");
}

function normalizeConfigPath(value: string): string {
  return normalizePath(value.replaceAll("\\", "/"));
}

function normalizePath(value: string): string {
  return nodePath.posix.normalize(value.replaceAll("\\", "/")).replace(/^\.\//, "");
}
