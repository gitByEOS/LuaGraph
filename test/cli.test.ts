import { describe, expect, it, vi } from "vitest";

import { createCli } from "../src/cli.js";

describe("luagraph init CLI", () => {
  it("缺少项目路径时提示用法", () => {
    const cli = createTestCli();

    expect(() => cli.parse(["node", "luagraph", "init"], { from: "node" })).toThrow(
      "请指定项目路径：luagraph init <project_root>",
    );
  });

  it("指定项目路径时输出 init plan", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const cli = createTestCli();

    cli.parse(["node", "luagraph", "init", "/tmp/project"], { from: "node" });

    expect(log).toHaveBeenCalledTimes(1);
    const output = log.mock.calls[0]?.[0];
    expect(typeof output).toBe("string");
    expect(JSON.parse(output as string)).toMatchObject({
      projectRoot: "/tmp/project",
      config: {
        include: ["**/*.lua"],
        exclude: [".luagraph/**"],
        databaseDir: ".luagraph/kuzu",
      },
    });

    log.mockRestore();
  });
});

function createTestCli() {
  return createCli().exitOverride();
}
