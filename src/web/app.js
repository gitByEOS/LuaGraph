(function () {
  const API = {
    status: "/api/status",
    graph: "/api/graph",
    code: "/api/code",
  };

  const CATEGORY_COLORS = {
    File: "#60a5fa",
    table: "#fbbf24",
    module: "#a78bfa",
    function: "#34d399",
    method: "#fb7185",
    Symbol: "#94a3b8",
  };

  const state = {
    status: undefined,
    graph: { nodes: [], edges: [] },
    filteredNodes: [],
    matchedIds: new Set(),
    neighborIds: new Set(),
    selectedId: undefined,
    chart: undefined,
  };

  const dom = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    bindDom();
    bindEvents();
    loadStatus();
    loadGraph();
  }

  function bindDom() {
    dom.fileCount = document.querySelector("#fileCount");
    dom.symbolCount = document.querySelector("#symbolCount");
    dom.edgeCount = document.querySelector("#edgeCount");
    dom.parseErrorCount = document.querySelector("#parseErrorCount");
    dom.searchInput = document.querySelector("#searchInput");
    dom.kindFilter = document.querySelector("#kindFilter");
    dom.resultCount = document.querySelector("#resultCount");
    dom.resultList = document.querySelector("#resultList");
    dom.message = document.querySelector("#message");
    dom.graph = document.querySelector("#graph");
    dom.nodeDetail = document.querySelector("#nodeDetail");
    dom.codeSnippet = document.querySelector("#codeSnippet");
  }

  function bindEvents() {
    dom.searchInput.addEventListener("input", applySearch);
    dom.kindFilter.addEventListener("change", applySearch);
    window.addEventListener("resize", () => state.chart && state.chart.resize());
  }

  async function loadStatus() {
    try {
      const status = await fetchJson(API.status);
      state.status = status;
      renderStatus(status);
    } catch (error) {
      renderStatus();
      showMessage(`状态加载失败：${readError(error)}`, true);
    }
  }

  async function loadGraph() {
    try {
      showMessage("正在加载图谱...");
      const payload = await fetchJson(API.graph);
      state.graph = normalizeGraph(payload);
      state.filteredNodes = state.graph.nodes;
      renderKindFilter(state.graph.nodes);
      applySearch();
      hideMessage();
      if (state.graph.nodes.length === 0) {
        showMessage("暂无图谱数据，请先完成 index。", false);
      }
    } catch (error) {
      state.graph = { nodes: [], edges: [] };
      state.filteredNodes = [];
      renderKindFilter([]);
      renderResults([]);
      renderGraph();
      showMessage(`图谱加载失败：${readError(error)}`, true);
    }
  }

  async function fetchCodeSnippet(node) {
    if (!isSymbolNode(node)) {
      dom.codeSnippet.textContent = "File 节点没有源码片段请求。";
      return;
    }

    const params = new URLSearchParams({
      path: node.filePath,
      line: String(node.startLine || 1),
      context: "5",
    });

    dom.codeSnippet.textContent = "正在加载源码...";

    try {
      const payload = await fetchJson(`${API.code}?${params.toString()}`);
      dom.codeSnippet.textContent = normalizeCodeSnippet(payload);
    } catch (error) {
      dom.codeSnippet.textContent = `源码加载失败：${readError(error)}`;
    }
  }

  async function fetchJson(url) {
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  function normalizeGraph(payload) {
    const rawNodes = readArray(payload.nodes)
      .concat(readArray(payload.files))
      .concat(readArray(payload.symbols));
    const nodes = uniqueById(rawNodes.map(toGraphNode));
    const nodeIds = new Set(nodes.map((node) => node.id));
    const rawEdges = readArray(payload.edges)
      .concat(readArray(payload.contains))
      .concat(readArray(payload.containsEdges));
    const edges = rawEdges.map(toGraphEdge).filter((edge) => {
      return edge.type === "Contains" && nodeIds.has(edge.source) && nodeIds.has(edge.target);
    });

    return { nodes, edges };
  }

  function toGraphNode(raw) {
    const type = raw.type === "File" ? "File" : raw.type === "Symbol" ? "Symbol" : raw.kind ? "Symbol" : "File";
    const kind = type === "File" ? "File" : String(raw.kind || "Symbol");
    const filePath = String(raw.filePath || raw.path || "");
    const name = String(raw.name || raw.qualifiedName || raw.path || raw.id || "未命名节点");

    return {
      id: String(raw.id || raw.path || raw.qualifiedName || name),
      type,
      kind,
      name,
      qualifiedName: String(raw.qualifiedName || name),
      filePath,
      path: String(raw.path || filePath),
      signature: String(raw.signature || ""),
      startLine: Number(raw.startLine || raw.line || 0),
      endLine: Number(raw.endLine || 0),
      isLocal: Boolean(raw.isLocal),
      isExported: Boolean(raw.isExported),
      raw,
    };
  }

  function toGraphEdge(raw) {
    return {
      source: String(raw.source || raw.from || raw.fromId || raw.parent || ""),
      target: String(raw.target || raw.to || raw.toId || raw.child || ""),
      type: String(raw.type || raw.kind || raw.label || "Contains"),
    };
  }

  function uniqueById(nodes) {
    const seen = new Map();
    for (const node of nodes) {
      if (!seen.has(node.id)) {
        seen.set(node.id, node);
      }
    }

    return Array.from(seen.values());
  }

  function readArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function applySearch() {
    const query = dom.searchInput.value.trim().toLowerCase();
    const kind = dom.kindFilter.value;
    const matchedIds = new Set();

    const nodes = state.graph.nodes.filter((node) => {
      const isKindMatched = kind === "" || node.kind === kind;
      const isTextMatched = query === "" || searchableText(node).includes(query);
      if (isKindMatched && isTextMatched) {
        matchedIds.add(node.id);
      }

      return isKindMatched && isTextMatched;
    });

    state.filteredNodes = nodes;
    state.matchedIds = matchedIds;
    state.neighborIds = findNeighborIds(matchedIds);
    renderResults(nodes);
    renderGraph();
  }

  function searchableText(node) {
    return [node.name, node.qualifiedName, node.filePath, node.path, node.signature]
      .join("\n")
      .toLowerCase();
  }

  function findNeighborIds(ids) {
    if (ids.size === 0) {
      return new Set();
    }

    const neighbors = new Set();
    for (const edge of state.graph.edges) {
      if (ids.has(edge.source)) {
        neighbors.add(edge.target);
      }
      if (ids.has(edge.target)) {
        neighbors.add(edge.source);
      }
    }

    return neighbors;
  }

  function renderStatus(status) {
    dom.fileCount.textContent = formatCount(status && status.fileCount);
    dom.symbolCount.textContent = formatCount(status && status.symbolCount);
    dom.edgeCount.textContent = formatCount(status && status.edgeCount);
    dom.parseErrorCount.textContent = formatCount(status && status.parseErrorCount);
  }

  function renderKindFilter(nodes) {
    const kinds = Array.from(new Set(nodes.map((node) => node.kind))).sort();
    dom.kindFilter.innerHTML = '<option value="">全部</option>';
    for (const kind of kinds) {
      const option = document.createElement("option");
      option.value = kind;
      option.textContent = kind;
      dom.kindFilter.appendChild(option);
    }
  }

  function renderResults(nodes) {
    dom.resultCount.textContent = String(nodes.length);
    dom.resultList.innerHTML = "";

    if (nodes.length === 0) {
      const item = document.createElement("li");
      item.className = "muted";
      item.textContent = state.graph.nodes.length === 0 ? "暂无数据" : "没有匹配结果";
      dom.resultList.appendChild(item);
      return;
    }

    for (const node of nodes) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = `result-item${node.id === state.selectedId ? " is-active" : ""}`;
      button.innerHTML = `<span class="result-name"></span><span class="result-meta"></span>`;
      button.querySelector(".result-name").textContent = node.name;
      button.querySelector(".result-meta").textContent = `${node.kind} · ${node.filePath || node.path}`;
      button.addEventListener("click", () => selectNode(node.id, true));
      item.appendChild(button);
      dom.resultList.appendChild(item);
    }
  }

  function renderGraph() {
    if (!window.echarts) {
      showMessage("缺少 /vendor/echarts.min.js，图谱无法渲染。", true);
      return;
    }

    if (!state.chart) {
      state.chart = window.echarts.init(dom.graph);
      state.chart.on("click", (params) => {
        if (params.dataType === "node") {
          selectNode(params.data.id, false);
        }
      });
    }

    const isNarrowed = state.matchedIds.size > 0;
    const categories = buildCategories(state.graph.nodes);
    const nodes = state.graph.nodes.map((node) => {
      const isMatched = !isNarrowed || state.matchedIds.has(node.id);
      const isNeighbor = isNarrowed && state.neighborIds.has(node.id);
      const isSelected = node.id === state.selectedId;
      const opacity = isMatched || isNeighbor || isSelected ? 1 : 0.16;

      return {
        ...node,
        category: categories.findIndex((category) => category.name === node.kind),
        symbolSize: node.kind === "File" ? 38 : isSelected ? 30 : 22,
        itemStyle: {
          color: CATEGORY_COLORS[node.kind] || CATEGORY_COLORS.Symbol,
          opacity,
          borderColor: isSelected ? "#ffffff" : "transparent",
          borderWidth: isSelected ? 3 : 0,
        },
        label: {
          show: isSelected || isMatched,
          opacity,
        },
      };
    });
    const edges = state.graph.edges.map((edge) => {
      const isRelated = !isNarrowed || state.matchedIds.has(edge.source) || state.matchedIds.has(edge.target);

      return {
        ...edge,
        lineStyle: {
          color: isRelated ? "#67e8f9" : "#334155",
          opacity: isRelated ? 0.72 : 0.08,
          width: isRelated ? 1.8 : 1,
        },
      };
    });

    state.chart.setOption(
      {
        backgroundColor: "transparent",
        tooltip: {
          formatter: (params) => {
            if (params.dataType === "edge") {
              return `${params.data.source} → ${params.data.target}<br/>Contains`;
            }

            return `${params.data.kind}<br/>${params.data.qualifiedName || params.data.name}`;
          },
        },
        legend: {
          top: 14,
          left: 14,
          textStyle: { color: "#91a1b8" },
          data: categories.map((category) => category.name),
        },
        series: [
          {
            type: "graph",
            layout: "force",
            roam: true,
            draggable: true,
            categories,
            data: nodes,
            links: edges,
            edgeSymbol: ["none", "arrow"],
            label: {
              color: "#e6edf7",
              position: "right",
              formatter: "{b}",
            },
            force: {
              repulsion: 180,
              edgeLength: [60, 180],
              gravity: 0.08,
            },
            emphasis: {
              focus: "adjacency",
              lineStyle: { width: 3 },
            },
          },
        ],
      },
      true,
    );
  }

  function buildCategories(nodes) {
    return Array.from(new Set(nodes.map((node) => node.kind)))
      .sort()
      .map((name) => ({ name }));
  }

  function selectNode(id, shouldFocus) {
    const node = state.graph.nodes.find((item) => item.id === id);
    if (!node) {
      return;
    }

    state.selectedId = id;
    renderDetail(node);
    renderResults(state.filteredNodes);
    renderGraph();
    fetchCodeSnippet(node);

    if (shouldFocus && state.chart) {
      const dataIndex = state.graph.nodes.findIndex((item) => item.id === id);
      state.chart.dispatchAction({ type: "focusNodeAdjacency", seriesIndex: 0, dataIndex });
    }
  }

  function renderDetail(node) {
    dom.nodeDetail.className = "detail-card";
    dom.nodeDetail.innerHTML = "";
    const rows = [
      ["类型", node.type],
      ["Kind", node.kind],
      ["名称", node.name],
      ["QualifiedName", node.qualifiedName],
      ["文件", node.filePath || node.path],
      ["行号", node.startLine ? `${node.startLine}-${node.endLine || node.startLine}` : "--"],
      ["签名", node.signature || "--"],
    ];

    for (const [label, value] of rows) {
      const row = document.createElement("div");
      row.className = "detail-row";
      row.innerHTML = "<span></span><strong></strong>";
      row.querySelector("span").textContent = label;
      row.querySelector("strong").textContent = value;
      dom.nodeDetail.appendChild(row);
    }
  }

  function normalizeCodeSnippet(payload) {
    if (typeof payload === "string") {
      return payload;
    }

    if (typeof payload.content === "string") {
      return payload.content;
    }

    if (Array.isArray(payload.lines)) {
      return payload.lines
        .map((line) => {
          if (typeof line === "string") {
            return line;
          }

          return `${line.line || line.number || ""} ${line.text || line.content || ""}`;
        })
        .join("\n");
    }

    return JSON.stringify(payload, null, 2);
  }

  function isSymbolNode(node) {
    return node.type === "Symbol" || node.kind !== "File";
  }

  function showMessage(text, isError) {
    dom.message.hidden = false;
    dom.message.textContent = text;
    dom.message.classList.toggle("is-error", Boolean(isError));
  }

  function hideMessage() {
    dom.message.hidden = true;
    dom.message.textContent = "";
    dom.message.classList.remove("is-error");
  }

  function formatCount(value) {
    return Number.isFinite(value) ? String(value) : "--";
  }

  function readError(error) {
    return error instanceof Error ? error.message : String(error);
  }

  window.LuaGraphWeb = {
    API,
    applySearch,
    fetchCodeSnippet,
    loadGraph,
    loadStatus,
    normalizeGraph,
    renderGraph,
  };
})();
