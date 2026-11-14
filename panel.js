const tabId = Number(new URLSearchParams(location.search).get("tabId"));
const entries = []; // 请求日志：新 id 追加，已有 id 就地更新（pending → done）
let filterText = "";
const typeFilters = new Set(); // 传输类型过滤：空 = 全部（Network 同款交互）
const expandedPaths = new Set(); // JSON 折叠树展开状态：条目更新/重建后保持（键为 容器id+字段路径）
let selected = null;

const port = chrome.runtime.connect({ name: "HBUF_PANEL" });
port.postMessage({ type: "REGISTER", tabId });
port.onMessage.addListener((msg) => {
  if (msg.type !== "HBUF_LOG") return;
  let selectedChanged = false;
  for (const e of msg.entries) {
    const idx = entries.findIndex((x) => x.id === e.id);
    if (idx >= 0) {
      entries[idx] = e; // 同 id 更新：响应回来后替换 pending 条目
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
  if (selectedChanged) refreshDetail(); // 选中条目的响应回来后实时刷新详情区
});

const el = (id) => document.getElementById(id);

el("filter").addEventListener("input", (e) => {
  filterText = e.target.value.trim().toLowerCase();
  renderList();
});
// 传输类型过滤按钮（Network 同款 toggle）：无选中 = 全部，有选中 = 只显示选中类型
for (const btn of document.querySelectorAll(".toolbar .toggle")) {
  btn.addEventListener("click", () => {
    const type = btn.dataset.type;
    if (typeFilters.has(type)) {
      typeFilters.delete(type);
      btn.classList.remove("active");
    } else {
      typeFilters.add(type);
      btn.classList.add("active");
    }
    renderList();
  });
}
el("clear").addEventListener("click", () => {
  entries.length = 0;
  hideDetail();
  renderList();
});
el("detail-close").addEventListener("click", hideDetail);
// 请求头区标题点击折叠/展开（Network Headers 分组同款交互）
el("hdr-panel").querySelector(".hdr-toggle").addEventListener("click", () => {
  const panel = el("hdr-panel");
  const collapsed = panel.classList.toggle("collapsed");
  el("hdr-arrow").textContent = collapsed ? "▸" : "▾";
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function renderList() {
  const list = el("list");
  // 按开始时间倒序（最新在前），回放与实时批次的插入顺序不再影响展示顺序
  const rows = entries.filter((e) =>
    (!filterText ||
      e.path.toLowerCase().includes(filterText) ||
      (e.traceId ?? "").toLowerCase().includes(filterText)) &&
    (typeFilters.size === 0 || typeFilters.has(e.transport))
  ).sort((a, b) => b.ts - a.ts);
  el("count").textContent = rows.length + " 条";
  list.innerHTML = "";
  for (const e of rows) {
    const pending = e.status === "pending";
    const row = document.createElement("div");
    row.className = "grid-row" + (e.error ? " err" : "") + (pending ? " pending" : "") + (selected === e ? " selected" : "");
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
    list.appendChild(row);
  }
}

function select(e) {
  selected = e;
  renderList();
  el("detail").classList.remove("hidden");
  refreshDetail();
}

function refreshDetail() {
  if (!selected) return;
  el("detail-path").textContent = selected.path;
  el("detail-path").className = selected.error ? "err" : "";
  const meta = [];
  if (selected.traceId) meta.push("traceId: " + selected.traceId);
  if (selected.status === "pending") {
    meta.push("状态: 等待响应…");
  } else {
    meta.push("耗时: " + selected.duration + " ms");
  }
  meta.push("开始: " + new Date(selected.ts).toLocaleTimeString());
  if (selected.error) meta.push("错误: " + selected.error);
  el("detail-meta").textContent = meta.join("   |   ");
  renderHeaders(selected);
  renderJsonTree(el("req-body"), selected.req);
  if (selected.status === "pending") {
    el("resp-body").innerHTML = '<span class="empty">等待响应…</span>';
  } else {
    renderJsonTree(el("resp-body"), selected.resp);
  }
}

function hideDetail() {
  selected = null;
  el("detail").classList.add("hidden");
  renderList();
}

// ===== 请求头区（Network Headers tab 同款：General + Request Headers 分组键值行）=====
function renderHeaders(e) {
  const body = el("hdr-body");
  body.innerHTML = "";
  addHeaderGroup(body, "General", [
    ["Request URL", e.path],
    ["Request Method", e.notification ? "NOTIFY" : "POST"],
    ["Type", e.transport],
  ]);
  if (e.status === "pending") {
    addHeaderGroup(body, "Request Headers", [["（响应返回后记录）", ""]]);
    return;
  }
  const rows = Object.entries(e.reqHeaders ?? {});
  if (e.traceId && !rows.some(([k]) => k.toLowerCase() === "x-trace-id")) {
    rows.push(["x-trace-id", e.traceId]); // traceId 与 X-Trace-Id 请求头同源，补充展示
  }
  addHeaderGroup(body, "Request Headers", rows.length > 0 ? rows : [["（未设置）", ""]]);
}

function addHeaderGroup(body, name, rows) {
  const group = document.createElement("div");
  group.className = "hdr-group";
  group.textContent = name;
  body.appendChild(group);
  for (const [k, v] of rows) {
    const row = document.createElement("div");
    row.className = "hdr-row";
    const key = document.createElement("span");
    key.className = "hdr-key";
    key.textContent = k;
    const val = document.createElement("span");
    val.className = "hdr-val";
    val.textContent = v;
    val.title = v;
    row.appendChild(key);
    row.appendChild(val);
    body.appendChild(row);
  }
}

// ===== JSON 折叠树 =====
function renderJsonTree(container, value) {
  container.innerHTML = "";
  if (value === undefined) {
    container.innerHTML = '<span class="empty">（无数据，如 notification 或发送前失败）</span>';
    return;
  }
  container.appendChild(buildJsonNode(container.id, "", value, true, ""));
}

// ns 容器 id（req-body/resp-body）+ 字段路径组成展开状态键，重建后恢复用户展开/收起选择
function buildJsonNode(ns, key, value, expanded, parentPath) {
  const selfPath = parentPath + "/" + key;
  const stored = ns + selfPath;
  const open = expandedPaths.has(stored) ? true : (expanded ?? false);
  const wrapper = document.createElement("div");
  wrapper.className = "j-node";
  const isArr = Array.isArray(value);
  const isObj = value !== null && typeof value === "object" && !isArr;

  if (isArr || isObj) {
    const count = isArr ? value.length : Object.keys(value).length;
    if (count === 0) {
      const row = document.createElement("div");
      row.className = "j-line";
      row.innerHTML = `<span class="j-key">${escapeHtml(key)}</span><span class="j-punc">: ${isArr ? "[]" : "{}"}</span>`;
      wrapper.appendChild(row);
      return wrapper;
    }
    // 可折叠头部：▸/▾ + key + 元素数提示
    const header = document.createElement("div");
    header.className = "j-line j-toggle";
    const arrow = document.createElement("span");
    arrow.className = "j-arrow" + (open ? " open" : "");
    arrow.textContent = open ? "▾" : "▸";
    const label = document.createElement("span");
    label.className = "j-key";
    label.textContent = key + ": ";
    const hint = document.createElement("span");
    hint.className = "j-hint";
    hint.textContent = isArr ? "Array(" + count + ")" : "{" + count + " keys}";
    header.appendChild(arrow);
    header.appendChild(label);
    header.appendChild(hint);
    wrapper.appendChild(header);

    const children = document.createElement("div");
    children.className = "j-children" + (open ? "" : " hidden");
    if (isArr) {
      value.forEach((item, i) => children.appendChild(buildJsonNode(ns, String(i), item, undefined, selfPath)));
    } else {
      for (const [k, v] of Object.entries(value)) {
        children.appendChild(buildJsonNode(ns, k, v, undefined, selfPath));
      }
    }
    children.appendChild(buildCloseLine(isArr ? "]" : "}"));
    wrapper.appendChild(children);

    header.addEventListener("click", () => {
      const isOpen = children.classList.toggle("hidden") === false;
      if (isOpen) {
        expandedPaths.add(stored);
      } else {
        expandedPaths.delete(stored);
      }
      arrow.textContent = isOpen ? "▾" : "▸";
    });
    return wrapper;
  }

  // 基本类型
  const row = document.createElement("div");
  row.className = "j-line";
  let cls = "num";
  let text = String(value);
  if (value === null) {
    cls = "nil";
    text = "null";
  } else if (value === true || value === false) {
    cls = "bool";
  } else if (typeof value === "string") {
    cls = "str";
    text = JSON.stringify(value);
  }
  row.innerHTML = `<span class="j-key">${escapeHtml(key)}</span><span class="j-punc">: </span><span class="j-val ${cls}">${escapeHtml(text)}</span>`;
  return wrapper;
}

function buildCloseLine(bracket) {
  const row = document.createElement("div");
  row.className = "j-line";
  row.innerHTML = `<span class="j-punc">${bracket}</span>`;
  return row;
}
