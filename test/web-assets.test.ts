import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const webRoot = join(process.cwd(), "src/web/assets");

describe("serve 静态 Web 资产", () => {
  it("声明页面布局和 ECharts 静态脚本", async () => {
    const html = await readWebAsset("index.html");

    expect(html).toContain("Lua-Graph");
    expect(html).toContain("Graph Workbench");
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

  it("使用 Cursor 风格工作台样式", async () => {
    const css = await readWebAsset("style.css");

    expect(css).toContain("--bg: #0f1117");
    expect(css).toContain("--surface: #111318");
    expect(css).toContain("height: 56px");
    expect(css).toContain("height: 2.4rem");
    expect(css).toContain("grid-template-columns: 360px minmax(520px, 1fr) 340px");
    expect(css).toContain("flex: 1 1 auto");
    expect(css).toContain("appearance: none");
    expect(css).toContain("select option");
    expect(css).toContain("background: #040810");
    expect(css).toContain("font-family: \"SFMono-Regular\"");
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
    expect(app).toContain("function scheduleSearch()");
    expect(app).toContain("payload.code");
    expect(app).toContain("function renderGraph()");
    expect(app).toContain("function isGraphRelation(type)");
    expect(app).toContain('type === "Requires"');
    expect(app).toContain('type === "Extends"');
    expect(app).toContain("searchableText(node)");
  });

  it("默认隐藏节点文字，仅在悬停时显示", async () => {
    const app = await readWebAsset("app.js");

    expect(app).toContain("show: false");
    expect(app).toContain("label: { show: true }");
  });

  it("仅缩小 File 节点尺寸并保留透明度逻辑", async () => {
    const app = await readWebAsset("app.js");

    expect(app).toContain("value: 1");
    expect(app).toContain("opacity,");
    expect(app).toContain('node.type === "File" ? { symbolSize: 5 } : {}');
    expect(app).not.toContain("borderWidth:");
  });

  it("使用深色主题和全局性能配置", async () => {
    const app = await readWebAsset("app.js");

    expect(app).toContain("darkMode: true");
    expect(app).toContain('File: "#8aadf4"');
    expect(app).toContain('function: "#a6da95"');
    expect(app).toContain('lineStyle: { color: "#8aadf4", opacity: 0.36 }');
    expect(app).toContain('backgroundColor: "rgba(4,8,16,1)"');
    expect(app).toContain('animation: "auto"');
    expect(app).toContain("animationDuration: 1000");
    expect(app).toContain("animationDurationUpdate: 500");
    expect(app).toContain('animationEasing: "cubicInOut"');
    expect(app).toContain('animationEasingUpdate: "cubicInOut"');
    expect(app).toContain("animationThreshold: 2000");
    expect(app).toContain("progressiveThreshold: 3000");
    expect(app).toContain("progressive: 400");
    expect(app).toContain("hoverLayerThreshold: 3000");
    expect(app).toContain("useUTC: false");
    expect(app).toContain("stateAnimation:");
    expect(app).toContain("aria:");
    expect(app).toContain('return "#8bd5ca"');
    expect(app).toContain('return "#c6a0f6"');
  });

  it("使用官方 graph-webkit-dep 力导参数", async () => {
    const app = await readWebAsset("app.js");

    expect(app).toContain("animation: false");
    expect(app).toContain('roamTrigger: "global"');
    expect(app).toContain("scaleLimit:");
    expect(app).toContain("edgeLength: 5");
    expect(app).toContain("repulsion: 20");
    expect(app).toContain("gravity: 0.2");
    expect(app).toContain("thumbnail:");
  });

  it("使用官方默认边样式", async () => {
    const app = await readWebAsset("app.js");

    expect(app).not.toContain('edgeSymbol: ["none", "arrow"]');
    expect(app).not.toContain("width: 3");
    expect(app).not.toContain("isRelated");
  });

  it("延迟首屏渲染并限制频繁交互重绘", async () => {
    const app = await readWebAsset("app.js");

    expect(app).not.toContain("showLoading()");
    expect(app).toContain("requestAnimationFrame");
    expect(app).toContain("SEARCH_DELAY_MS");
    expect(app).toContain("RESULT_RENDER_LIMIT");
    expect(app).not.toContain("renderResults(state.filteredNodes);\n    renderGraph();");
  });

  it("搜索只更新列表，列表交互高亮图节点", async () => {
    const app = await readWebAsset("app.js");

    expect(app).toContain('addEventListener("mouseenter", () => highlightGraphNode(node.id))');
    expect(app).toContain('addEventListener("mouseleave", () => downplayGraphNode(node.id))');
    expect(app).toContain('type: "highlight"');
    expect(app).toContain('type: "downplay"');
    expect(app).not.toContain("state.matchedIds = matchedIds");
    expect(app).not.toContain("state.neighborIds = findNeighborIds(matchedIds)");
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
