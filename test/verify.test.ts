import { describe, expect, it } from "vitest";

import { analyzeProject } from "../src/analyze.js";
import { getProjectStatus } from "../src/status.js";
import { initializeProject } from "../src/init.js";

describe("Systems/ analysis verification", () => {
  it("分析 Systems/ 后 Kuzu 库中有数据", async () => {
    const projectRoot = "/Users/bole/dev/mul-agents/LuaGraph";

    await initializeProject(projectRoot);

    const analyzeResult = await analyzeProject(projectRoot, "Systems/**/*.lua");

    expect(analyzeResult.fileCount).toBe(18);
    expect(analyzeResult.symbolCount).toBeGreaterThan(0);
    expect(analyzeResult.containsCount).toBeGreaterThan(0);

    const statusResult = await getProjectStatus(projectRoot);

    expect(statusResult.fileCount).toBe(18);
    expect(statusResult.symbolCount).toBe(analyzeResult.symbolCount);
    expect(statusResult.edgeCount).toBeGreaterThan(0);
  }, 60000);
});
