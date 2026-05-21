(function () {
  const API = {
    status: "/api/status",
    graph: "/api/graph",
    code: "/api/code",
  };
  const SEARCH_DELAY_MS = 160;
  const RESULT_RENDER_LIMIT = 200;

  const CATEGORY_COLORS = {
    File: "#8aadf4",
    class: "#eed49f",
    table: "#eed49f",
    module: "#c6a0f6",
    function: "#a6da95",
    method: "#f5a97f",
    Symbol: "#cad3f5",
  };
  const CHART_THEME = {
    darkMode: true,
    color: Object.values(CATEGORY_COLORS),
    backgroundColor: "rgba(4,8,16,1)",
    textStyle: { color: "#e6edf7" },
    graph: {
      label: { color: "#e6edf7" },
      lineStyle: { color: "#8aadf4", opacity: 0.36 },
    },
    legend: {
      textStyle: { color: "#91a1b8" },
    },
  };
  const CHART_PERFORMANCE_OPTION = {
    animation: "auto",
    animationDuration: 1000,
    animationDurationUpdate: 500,
    animationEasing: "cubicInOut",
    animationEasingUpdate: "cubicInOut",
    animationThreshold: 2000,
    progressiveThreshold: 3000,
    progressive: 400,
    hoverLayerThreshold: 3000,
    useUTC: false,
    stateAnimation: {
      duration: 500,
      easing: "cubicInOut",
    },
    aria: {
      enabled: true,
    },
  };

  const state = {
    status: undefined,
    graph: { nodes: [], edges: [] },
    filteredNodes: [],
    matchedIds: new Set(),
    neighborIds: new Set(),
    selectedId: undefined,
    highlightedGraphId: undefined,
    graphNodeIndexes: new Map(),
    chart: undefined,
    searchTimer: undefined,
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
    dom.searchInput.addEventListener("input", scheduleSearch);
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
      const payload = await fetchJson(API.graph);
      state.graph = normalizeGraph(payload);
      state.filteredNodes = state.graph.nodes;
      renderKindFilter(state.graph.nodes);
      requestAnimationFrame(() => {
        renderGraph();
        applySearch();
        if (state.graph.nodes.length === 0) {
          showMessage("暂无图谱数据，请先完成 index。", false);
          return;
        }

        hideMessage();
      });
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
      return isGraphRelation(edge.type) && nodeIds.has(edge.source) && nodeIds.has(edge.target);
    });

    return { nodes, edges };
  }

  function toGraphNode(raw) {
    const type = readNodeType(raw);
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
      searchText: [name, raw.qualifiedName, filePath, raw.path, raw.signature].join("\n").toLowerCase(),
      raw,
    };
  }

  function readNodeType(raw) {
    if (raw.type === "File" || raw.type === "Symbol" || raw.type === "Module") {
      return raw.type;
    }

    return raw.kind ? "Symbol" : "File";
  }

  function toGraphEdge(raw) {
    return {
      source: String(raw.source || raw.from || raw.fromId || raw.parent || ""),
      target: String(raw.target || raw.to || raw.toId || raw.child || ""),
      type: String(raw.type || raw.kind || raw.label || "Contains"),
      moduleName: String(raw.moduleName || ""),
      isResolved: raw.isResolved === undefined ? undefined : Boolean(raw.isResolved),
    };
  }

  function isGraphRelation(type) {
    return type === "Contains" || type === "Extends" || type === "Requires";
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
    if (state.searchTimer) {
      clearTimeout(state.searchTimer);
      state.searchTimer = undefined;
    }

    const query = dom.searchInput.value.trim().toLowerCase();
    const kind = dom.kindFilter.value;

    const nodes = state.graph.nodes.filter((node) => {
      const isKindMatched = kind === "" || node.kind === kind;
      const isTextMatched = query === "" || searchableText(node).includes(query);

      return isKindMatched && isTextMatched;
    });

    state.filteredNodes = nodes;
    renderResults(nodes);
  }

  function scheduleSearch() {
    if (state.searchTimer) {
      clearTimeout(state.searchTimer);
    }

    state.searchTimer = setTimeout(applySearch, SEARCH_DELAY_MS);
  }

  function searchableText(node) {
    return node.searchText;
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

    const visibleNodes = nodes.slice(0, RESULT_RENDER_LIMIT);
    const fragment = document.createDocumentFragment();
    for (const node of visibleNodes) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = `result-item${node.id === state.selectedId ? " is-active" : ""}`;
      button.innerHTML = `<span class="result-name"></span><span class="result-meta"></span>`;
      button.querySelector(".result-name").textContent = node.name;
      button.querySelector(".result-meta").textContent = `${node.kind} · ${node.filePath || node.path}`;
      button.addEventListener("mouseenter", () => highlightGraphNode(node.id));
      button.addEventListener("mouseleave", () => downplayGraphNode(node.id));
      button.addEventListener("click", () => selectNode(node.id, true));
      item.appendChild(button);
      fragment.appendChild(item);
    }

    dom.resultList.appendChild(fragment);
    if (nodes.length > RESULT_RENDER_LIMIT) {
      const item = document.createElement("li");
      item.className = "muted";
      item.textContent = `仅显示前 ${RESULT_RENDER_LIMIT} 条，请继续输入缩小范围。`;
      dom.resultList.appendChild(item);
    }
  }

  function ensureChart() {
    if (!window.echarts) {
      showMessage("缺少 /vendor/echarts.min.js，图谱无法渲染。", true);
      return undefined;
    }

    if (!state.chart) {
      state.chart = window.echarts.init(dom.graph, CHART_THEME);
      state.chart.on("click", (params) => {
        if (params.dataType === "node") {
          selectNode(params.data.id, false);
        }
      });
    }

    return state.chart;
  }

  function renderGraph() {
    const chart = ensureChart();
    if (!chart) {
      return;
    }

    const isNarrowed = state.matchedIds.size > 0;
    const categories = buildCategories(state.graph.nodes);
    const categoryIndexes = new Map(categories.map((category, index) => [category.name, index]));
    state.graphNodeIndexes = new Map(state.graph.nodes.map((node, index) => [node.id, index]));
    const nodes = state.graph.nodes.map((node) => {
      const isMatched = !isNarrowed || state.matchedIds.has(node.id);
      const isNeighbor = isNarrowed && state.neighborIds.has(node.id);
      const isSelected = node.id === state.selectedId;
      const opacity = isMatched || isNeighbor || isSelected ? 1 : 0.16;

      return {
        id: node.id,
        name: node.name,
        value: 1,
        kind: node.kind,
        qualifiedName: node.qualifiedName,
        category: categoryIndexes.get(node.kind),
      ...(node.type === "File" ? { symbolSize: 5 } : {}),
      ...(node.type === "Module" ? { symbol: "diamond", symbolSize: 8 } : {}),
        itemStyle: {
          opacity,
        },
        label: {
          show: false,
          opacity,
        },
      };
    });
    const edges = state.graph.edges.map((edge) => ({
      source: edge.source,
      target: edge.target,
      type: edge.type,
      moduleName: edge.moduleName,
      isResolved: edge.isResolved,
      lineStyle: {
        color: edgeColor(edge.type),
        opacity: edge.type === "Contains" ? 0.28 : 0.72,
        type: edge.type === "Requires" ? "dashed" : "solid",
      },
    }));

    chart.setOption(
      {
        ...CHART_PERFORMANCE_OPTION,
        backgroundColor: CHART_THEME.backgroundColor,
        tooltip: {
          formatter: (params) => {
            if (params.dataType === "edge") {
              return formatEdgeTooltip(params.data);
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
            animation: false,
            roam: true,
            roamTrigger: "global",
            scaleLimit: {
              max: 8,
              min: 0.5,
            },
            draggable: true,
            categories,
            data: nodes,
            edges,
            colorBy: "series",
            progressiveThreshold: CHART_PERFORMANCE_OPTION.progressiveThreshold,
            progressive: CHART_PERFORMANCE_OPTION.progressive,
            hoverLayerThreshold: CHART_PERFORMANCE_OPTION.hoverLayerThreshold,
            label: {
              color: "#e6edf7",
              position: "right",
              formatter: "{b}",
            },
            force: {
              edgeLength: 5,
              repulsion: 20,
              gravity: 0.2,
            },
            emphasis: {
              focus: "adjacency",
              label: { show: true },
            },
          },
        ],
        thumbnail: {
          width: "15%",
          height: "15%",
          windowStyle: {
            color: "rgba(140, 212, 250, 0.5)",
            borderColor: "rgba(30, 64, 175, 0.7)",
            opacity: 1,
          },
        },
      },
      true,
    );
  }

  function buildCategories(nodes) {
    return Array.from(new Set(nodes.map((node) => node.kind)))
      .sort()
      .map((name) => ({ name }));
  }

  function edgeColor(type) {
    if (type === "Requires") {
      return "#8bd5ca";
    }

    if (type === "Extends") {
      return "#c6a0f6";
    }

    return "#8aadf4";
  }

  function formatEdgeTooltip(edge) {
    const detail = edge.type === "Requires" && edge.moduleName
      ? `<br/>module: ${edge.moduleName}${edge.isResolved === false ? " (unresolved)" : ""}`
      : "";

    return `${edge.source} → ${edge.target}<br/>${edge.type}${detail}`;
  }

  function selectNode(id, shouldFocus) {
    const node = state.graph.nodes.find((item) => item.id === id);
    if (!node) {
      return;
    }

    if (state.selectedId && state.selectedId !== id) {
      downplayGraphNode(state.selectedId, true);
    }
    state.selectedId = id;
    renderDetail(node);
    renderResults(state.filteredNodes);
    fetchCodeSnippet(node);
    highlightGraphNode(id);

    if (shouldFocus && state.chart) {
      const dataIndex = readGraphNodeIndex(id);
      if (dataIndex === -1) {
        return;
      }
      state.chart.dispatchAction({ type: "focusNodeAdjacency", seriesIndex: 0, dataIndex });
    }
  }

  function highlightGraphNode(id) {
    if (!state.chart) {
      return;
    }

    const dataIndex = readGraphNodeIndex(id);
    if (dataIndex === -1) {
      return;
    }

    if (state.highlightedGraphId && state.highlightedGraphId !== id) {
      downplayGraphNode(state.highlightedGraphId, true);
    }

    state.highlightedGraphId = id;
    state.chart.dispatchAction({ type: "highlight", seriesIndex: 0, dataIndex });
    state.chart.dispatchAction({ type: "focusNodeAdjacency", seriesIndex: 0, dataIndex });
  }

  function downplayGraphNode(id, shouldForce) {
    if (!state.chart || (!shouldForce && id === state.selectedId)) {
      return;
    }

    const dataIndex = readGraphNodeIndex(id);
    if (dataIndex === -1) {
      return;
    }

    if (state.highlightedGraphId === id) {
      state.highlightedGraphId = undefined;
    }
    state.chart.dispatchAction({ type: "unfocusNodeAdjacency", seriesIndex: 0, dataIndex });
    state.chart.dispatchAction({ type: "downplay", seriesIndex: 0, dataIndex });
  }

  function readGraphNodeIndex(id) {
    return state.graphNodeIndexes.get(id) ?? -1;
  }

  function renderDetail(node) {
    dom.nodeDetail.className = "detail-card";
    dom.nodeDetail.innerHTML = "";
    const rows = [
      ["类型", node.type],
      ["Kind", node.kind],
      ["名称", node.name],
      ["QualifiedName", node.qualifiedName],
      [node.type === "Module" ? "来源文件" : "文件", node.filePath || node.path],
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

    if (typeof payload.code === "string") {
      return payload.code;
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
    return node.type === "Symbol";
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
