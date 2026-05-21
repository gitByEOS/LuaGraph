import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import nodePath from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { normalizeRepositoryPath, resolveSafeRepositoryPath } from "../src/core/path.js";

const tempRoots: string[] = [];

afterEach(() => {
  for (const tempRoot of tempRoots.splice(0)) {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

describe("normalizeRepositoryPath", () => {
  it("保留普通相对路径", () => {
    expect(normalizeRepositoryPath("src/core.lua")).toBe("src/core.lua");
  });

  it("把 Windows 反斜杠规范化为 Git 风格路径", () => {
    expect(normalizeRepositoryPath("src\\core.lua")).toBe("src/core.lua");
  });

  it("移除 ./ 前缀", () => {
    expect(normalizeRepositoryPath("./src/core.lua")).toBe("src/core.lua");
  });

  it("移除重复斜杠", () => {
    expect(normalizeRepositoryPath("src//nested///core.lua")).toBe("src/nested/core.lua");
  });

  it("拒绝 .. 路径段", () => {
    expect(() => normalizeRepositoryPath("src/../core.lua")).toThrow("..");
  });

  it("拒绝绝对路径、空路径和根路径", () => {
    expect(() => normalizeRepositoryPath("/src/core.lua")).toThrow("相对路径");
    expect(() => normalizeRepositoryPath("")).toThrow("不能为空");
    expect(() => normalizeRepositoryPath("./")).toThrow("项目根");
  });
});

describe("resolveSafeRepositoryPath", () => {
  it("解析真实路径时拒绝软链逃逸项目根", () => {
    const projectRoot = createTempRoot();
    const outsideRoot = createTempRoot();

    mkdirSync(nodePath.join(projectRoot, "src"));
    writeFileSync(nodePath.join(outsideRoot, "secret.lua"), "return 1");
    symlinkSync(
      nodePath.join(outsideRoot, "secret.lua"),
      nodePath.join(projectRoot, "src", "secret.lua"),
    );

    expect(() => resolveSafeRepositoryPath(projectRoot, "src/secret.lua")).toThrow("逃逸项目根");
  });

  it("允许项目根内的真实路径", () => {
    const projectRoot = createTempRoot();

    mkdirSync(nodePath.join(projectRoot, "src"));
    writeFileSync(nodePath.join(projectRoot, "src", "core.lua"), "return 1");

    expect(resolveSafeRepositoryPath(projectRoot, "src/core.lua")).toBe(
      realpathSync.native(nodePath.join(projectRoot, "src", "core.lua")),
    );
  });
});

function createTempRoot(): string {
  const tempRoot = mkdtempSync(nodePath.join(tmpdir(), "luagraph-path-"));

  tempRoots.push(tempRoot);

  return tempRoot;
}
