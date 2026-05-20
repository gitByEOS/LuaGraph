import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const webRoot = join(process.cwd(), "src/web");

describe("serve 静态 Web 资产", () => {
  it("声明页面布局和 ECharts 静态脚本", async () => {
    const html = await readWebAsset("index.html");

    expect(html).toContain('id="statusPanel"');
    expect(html).toContain('id="searchInput"');
    expect(html).toContain('id="kindFilter"');
    expect(html).toContain('id="resultList"');
    expect(html).toContain('id="graph"');
    expect(html).toContain('id="nodeDetail"');
    expect(html).toContain('id="codeSnippet"');
    expect(html).toContain('src="/vendor/echarts.min.js"');
    expect(html).toContain('src="/app.js"');
  });

  it("固定第一版 API 路径和核心交互函数", async () => {
    const app = await readWebAsset("app.js");

    expect(app).toContain('status: "/api/status"');
    expect(app).toContain('graph: "/api/graph"');
    expect(app).toContain('code: "/api/code"');
    expect(app).toContain('context: "5"');
    expect(app).toContain("function loadStatus()");
    expect(app).toContain("function loadGraph()");
    expect(app).toContain("function fetchCodeSnippet(node)");
    expect(app).toContain("function applySearch()");
    expect(app).toContain("function renderGraph()");
    expect(app).toContain('edge.type === "Contains"');
    expect(app).toContain("searchableText(node)");
    expect(app).toContain("findNeighborIds(matchedIds)");
  });

  it("提供失败态和空数据态样式", async () => {
    const html = await readWebAsset("index.html");
    const css = await readWebAsset("style.css");
    const app = await readWebAsset("app.js");

    expect(html).toContain('id="message"');
    expect(css).toContain(".message.is-error");
    expect(app).toContain("图谱加载失败");
    expect(app).toContain("状态加载失败");
    expect(app).toContain("暂无图谱数据");
  });
});

async function readWebAsset(fileName: string): Promise<string> {
  return readFile(join(webRoot, fileName), "utf8");
}
