const tabId = Number(new URLSearchParams(location.search).get("tabId"));
const entries = [];
let filterText = "";
let activeType = "ALL"; // "ALL" | "http" | "websocket"
let activeTab = "headers"; // "headers" | "payload" | "response"
const collapsedPaths = new Set(); // 记录用户主动收起的节点（默认根节点展开，子节点收起）
const expandedPaths = new Set();  // 记录用户主动展开的子节点
let selected = null;
let currentRows = []; // 当前过滤排序后的列表缓存，供键盘上下键导航
let ctxEntry = null;  // 当前右键菜单选中的条目

const el = (id) => document.getElementById(id);

// ===== 与 background 建立长连接并注册当前 tabId =====
const port = chrome.runtime.connect({ name: "HBUF_PANEL" });
port.postMessage({ type: "REGISTER", tabId });
port.onMessage.addListener((msg) => {
  if (msg.type !== "HBUF_LOG") return;
  let selectedChanged = false;
  for (const e of msg.entries) {
    const idx = entries.findIndex((x) => x.id === e.id);
    if (idx >= 0) {
      entries[idx] = e;
      if (selected && selected.id === e.id) {
        selected = e;
        selectedChanged = true;
      }
    } else {
      entries.push(e);
    }
  }
  if (entries.length > 500) entries.length = 500;
  renderList();
  if (selectedChanged) refreshDetail();
});

// ===== 顶部工具栏交互 =====
el("filter").addEventListener("input", (e) => {
  filterText = e.target.value.trim().toLowerCase();
  renderList();
});

// 类型过滤胶囊按钮（单选互斥，同 Network 面板）
for (const btn of document.querySelectorAll(".filter-pills .pill")) {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".filter-pills .pill").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    activeType = btn.dataset.type;
    renderList();
  });
}

// 详情顶部 Tab 切换
for (const btn of document.querySelectorAll(".detail-tabs .tab-btn")) {
  btn.addEventListener("click", () => {
    activeTab = btn.dataset.tab;
    document.querySelectorAll(".detail-tabs .tab-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll(".detail-content .tab-pane").forEach((p) => p.classList.remove("active"));
    el("tab-" + activeTab).classList.add("active");
  });
}

// 清空与关闭
el("clear").addEventListener("click", () => {
  entries.length = 0;
  hideDetail();
  renderList();
});
el("detail-close").addEventListener("click", hideDetail);

// 详情页右上角「复制载荷 / 复制响应」按钮
el("copy-req").addEventListener("click", () => {
  if (!selected || selected.req === undefined) return;
  copyText(formatJsonForCopy(selected.req), el("copy-req"));
});

el("copy-resp").addEventListener("click", () => {
  if (!selected || selected.status === "pending" || selected.resp === undefined) return;
  copyText(formatJsonForCopy(selected.resp), el("copy-resp"));
});

// ===== 键盘导航：Esc 关闭详情/菜单，上下方向键切换条目 =====
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    el("ctx-menu").classList.add("hidden");
    if (selected) hideDetail();
    return;
  }
  if ((e.key === "ArrowDown" || e.key === "ArrowUp") && currentRows.length > 0) {
    if (document.activeElement === el("filter")) return;
    e.preventDefault();
    const curIdx = selected ? currentRows.findIndex((x) => x.id === selected.id) : -1;
    const nextIdx = e.key === "ArrowDown"
      ? Math.min(curIdx + 1, currentRows.length - 1)
      : Math.max(curIdx - 1, 0);
    select(currentRows[nextIdx]);
  }
});

// ===== 拖拽调整左右分栏宽度 =====
(() => {
  const resizer = el("resizer");
  const listPane = el("list-pane");
  let dragging = false;

  resizer.addEventListener("mousedown", (e) => {
    dragging = true;
    resizer.classList.add("dragging");
    document.body.style.cursor = "col-resize";
    e.preventDefault();
  });
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const total = el("workspace").clientWidth;
    const width = Math.max(180, Math.min(total - 280, e.clientX));
    listPane.style.flex = `0 0 ${width}px`;
    listPane.style.maxWidth = "none";
  });
  window.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    resizer.classList.remove("dragging");
    document.body.style.cursor = "";
  });
})();

// ===== 通用工具函数 =====
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

async function copyText(text, triggerBtn) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // DevTools 面板若受焦点权限限制，回退至 textarea + execCommand
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  if (triggerBtn) {
    const origin = triggerBtn.textContent;
    triggerBtn.textContent = "✓ 已复制";
    triggerBtn.classList.add("copied");
    setTimeout(() => {
      triggerBtn.textContent = origin;
      triggerBtn.classList.remove("copied");
    }, 1200);
  }
}

function formatJsonForCopy(data) {
  if (data === undefined) return "";
  return typeof data === "string" ? data : JSON.stringify(data, null, 2);
}

// ===== 左侧请求列表渲染 =====
function renderList() {
  const list = el("list");
  currentRows = entries
    .filter((e) =>
      (!filterText ||
        e.path.toLowerCase().includes(filterText) ||
        (e.traceId ?? "").toLowerCase().includes(filterText)) &&
      (activeType === "ALL" || e.transport === activeType)
    )
    .sort((a, b) => b.ts - a.ts);

  el("count").textContent = currentRows.length + " 条";
  list.innerHTML = "";
  for (const e of currentRows) {
    const pending = e.status === "pending";
    const row = document.createElement("div");
    row.className = "grid-row" + (e.error ? " err" : "") + (pending ? " pending" : "") + (selected?.id === e.id ? " selected" : "");
    row.innerHTML = `
      <span class="col-status">
        <span class="dot ${e.error ? "red" : (pending ? "gray" : "green")}"></span>
        <span class="status-code">${e.error ? "ERR" : (pending ? "···" : "200")}</span>
      </span>
      <span class="col-method">${e.notification ? "NOTIFY" : "POST"}</span>
      <span class="col-name" title="${escapeHtml(e.path)}">${escapeHtml(e.path)}</span>
      <span class="col-type"><span class="badge ${e.transport}">${e.transport}</span></span>
      <span class="col-time">${e.duration != null ? e.duration + " ms" : "···"}</span>
      <span class="col-start">${new Date(e.ts).toLocaleTimeString()}</span>`;
    row.addEventListener("click", () => select(e));
    row.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      openContextMenu(ev.clientX, ev.clientY, e);
    });
    list.appendChild(row);
  }
}

// ===== 列表右键上下文菜单 =====
const ctxMenu = el("ctx-menu");

function openContextMenu(x, y, entry) {
  ctxEntry = entry;
  const reqItem = ctxMenu.querySelector('[data-action="copy-req"]');
  const respItem = ctxMenu.querySelector('[data-action="copy-resp"]');
  reqItem.classList.toggle("disabled", entry.req === undefined);
  respItem.classList.toggle("disabled", entry.status === "pending" || entry.resp === undefined);

  ctxMenu.classList.remove("hidden");
  const maxX = window.innerWidth - ctxMenu.offsetWidth - 4;
  const maxY = window.innerHeight - ctxMenu.offsetHeight - 4;
  ctxMenu.style.left = Math.max(4, Math.min(x, maxX)) + "px";
  ctxMenu.style.top = Math.max(4, Math.min(y, maxY)) + "px";
}

ctxMenu.addEventListener("click", (ev) => {
  const item = ev.target.closest(".ctx-item");
  if (!item || item.classList.contains("disabled") || !ctxEntry) return;
  const action = item.dataset.action;
  if (action === "copy-req") {
    copyText(formatJsonForCopy(ctxEntry.req));
  } else if (action === "copy-resp") {
    copyText(formatJsonForCopy(ctxEntry.resp));
  } else if (action === "copy-path") {
    copyText(ctxEntry.path);
  }
  ctxMenu.classList.add("hidden");
});

document.addEventListener("click", () => ctxMenu.classList.add("hidden"));

// ===== 右侧详情抽屉控制 =====
function select(e) {
  selected = e;
  el("workspace").classList.add("detail-open");
  el("detail").classList.remove("hidden");
  el("resizer").classList.remove("hidden");
  renderList();
  refreshDetail();
}

function hideDetail() {
  selected = null;
  el("workspace").classList.remove("detail-open");
  el("detail").classList.add("hidden");
  el("resizer").classList.add("hidden");
  el("list-pane").style.flex = "";
  el("list-pane").style.maxWidth = "";
  renderList();
}

function refreshDetail() {
  if (!selected) return;
  el("detail-path").textContent = selected.path;
  renderHeaders(selected);
  renderJsonTree(el("req-body"), selected.req);
  if (selected.status === "pending") {
    el("resp-body").innerHTML = '<span class="empty">正在等待响应…</span>';
  } else {
    renderJsonTree(el("resp-body"), selected.resp);
  }
  el("copy-req").disabled = selected.req === undefined;
  el("copy-resp").disabled = selected.status === "pending" || selected.resp === undefined;
}

// ===== Tab 1: 标头（General + Request Headers 可折叠分组）=====
function renderHeaders(e) {
  const body = el("hdr-body");
  body.innerHTML = "";
  const statusText = e.error ? `ERR (${e.error})` : (e.status === "pending" ? "Pending" : `200 OK (${e.duration} ms)`);
  const generalRows = [
    ["Request URL", e.path],
    ["Request Method", e.notification ? "NOTIFY" : "POST"],
    ["Status Code", statusText, Boolean(e.error)],
    ["Transport", e.transport],
    ["Start Time", new Date(e.ts).toLocaleTimeString()],
  ];
  if (e.traceId) generalRows.push(["Trace ID", e.traceId]);
  addHeaderSection(body, "General", generalRows);

  if (e.status === "pending") {
    addHeaderSection(body, "Request Headers", [["状态", "响应返回后记录"]]);
    return;
  }
  const rows = Object.entries(e.reqHeaders ?? {});
  if (e.traceId && !rows.some(([k]) => k.toLowerCase() === "x-trace-id")) {
    rows.push(["x-trace-id", e.traceId]);
  }
  addHeaderSection(body, "Request Headers", rows.length > 0 ? rows : [["（未设置）", ""]]);
}

function addHeaderSection(container, title, rows) {
  const sec = document.createElement("div");
  sec.className = "hdr-section";

  const head = document.createElement("div");
  head.className = "hdr-sec-title";
  head.innerHTML = `<span class="hdr-sec-arrow">▾</span><span>${escapeHtml(title)}</span>`;
  head.addEventListener("click", () => {
    const collapsed = sec.classList.toggle("collapsed");
    head.querySelector(".hdr-sec-arrow").textContent = collapsed ? "▸" : "▾";
  });

  const body = document.createElement("div");
  body.className = "hdr-sec-body";
  for (const [k, v, isErr] of rows) {
    const row = document.createElement("div");
    row.className = "hdr-row";
    row.innerHTML = `<span class="hdr-key">${escapeHtml(k)}:</span><span class="hdr-val ${isErr ? "err" : ""}">${escapeHtml(v)}</span>`;
    body.appendChild(row);
  }

  sec.appendChild(head);
  sec.appendChild(body);
  container.appendChild(sec);
}

// ===== Tab 2 & 3: JSON 折叠树 =====
function renderJsonTree(container, value) {
  container.innerHTML = "";
  if (value === undefined) {
    container.innerHTML = '<span class="empty">（无数据，如 notification 或发送前失败）</span>';
    return;
  }
  container.appendChild(buildJsonNode(container.id, "", value, true, ""));
}

function buildJsonNode(ns, key, value, isRoot, parentPath) {
  const selfPath = parentPath + "/" + key;
  const stored = ns + selfPath;
  // 根节点默认展开（除非在 collapsedPaths 中）；子节点默认收起（除非在 expandedPaths 中）
  const open = isRoot ? !collapsedPaths.has(stored) : expandedPaths.has(stored);

  const wrapper = document.createElement("div");
  wrapper.className = "j-node" + (isRoot ? " is-root" : "");
  const isArr = Array.isArray(value);
  const isObj = value !== null && typeof value === "object" && !isArr;
  const keyPrefix = key !== "" ? `<span class="j-key">${escapeHtml(key)}</span><span class="j-punc">: </span>` : "";

  if (isArr || isObj) {
    const count = isArr ? value.length : Object.keys(value).length;
    if (count === 0) {
      const row = document.createElement("div");
      row.className = "j-line";
      row.innerHTML = `${keyPrefix}<span class="j-punc">${isArr ? "[]" : "{}"}</span>`;
      wrapper.appendChild(row);
      return wrapper;
    }

    const header = document.createElement("div");
    header.className = "j-line j-toggle";
    header.innerHTML = `<span class="j-arrow">${open ? "▾" : "▸"}</span>${keyPrefix}<span class="j-hint">${isArr ? `Array(${count})` : `{${count} keys}`}</span>`;
    wrapper.appendChild(header);

    const children = document.createElement("div");
    children.className = "j-children" + (open ? "" : " hidden");
    if (isArr) {
      value.forEach((item, i) => children.appendChild(buildJsonNode(ns, String(i), item, false, selfPath)));
    } else {
      for (const [k, v] of Object.entries(value)) {
        children.appendChild(buildJsonNode(ns, k, v, false, selfPath));
      }
    }
    const closeLine = document.createElement("div");
    closeLine.className = "j-line";
    closeLine.innerHTML = `<span class="j-punc">${isArr ? "]" : "}"}</span>`;
    children.appendChild(closeLine);
    wrapper.appendChild(children);

    header.addEventListener("click", () => {
      const isOpen = children.classList.toggle("hidden") === false;
      if (isRoot) {
        isOpen ? collapsedPaths.delete(stored) : collapsedPaths.add(stored);
      } else {
        isOpen ? expandedPaths.add(stored) : expandedPaths.delete(stored);
      }
      header.querySelector(".j-arrow").textContent = isOpen ? "▾" : "▸";
    });
    return wrapper;
  }

  const row = document.createElement("div");
  row.className = "j-line";
  let cls = "num";
  let text = String(value);
  if (value === null) { cls = "nil"; text = "null"; }
  else if (typeof value === "boolean") { cls = "bool"; }
  else if (typeof value === "string") { cls = "str"; text = JSON.stringify(value); }
  row.innerHTML = `${keyPrefix}<span class="j-val ${cls}">${escapeHtml(text)}</span>`;
  wrapper.appendChild(row);
  return wrapper;
}
