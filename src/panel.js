const tabId = Number(new URLSearchParams(location.search).get("tabId"));
const entries = [];
let filterText = "";
let activeType = "ALL"; // "ALL" | "http" | "websocket"
let activeTab = "headers"; // "headers" | "payload" | "response"
const collapsedPaths = new Set(); // Tracks nodes the user collapsed (roots expand by default, children collapse)
const expandedPaths = new Set();  // Tracks child nodes the user expanded
let selected = null;
let currentRows = []; // Cache of the filtered/sorted list for keyboard up/down navigation
let ctxEntry = null;  // Entry currently selected in the context menu

const el = (id) => document.getElementById(id);

// ===== Establish a long-lived connection with the background and register the current tabId =====
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

// ===== Top toolbar interactions =====
el("filter").addEventListener("input", (e) => {
  filterText = e.target.value.trim().toLowerCase();
  renderList();
});

// Type filter pill buttons (single-select, like the Network panel)
for (const btn of document.querySelectorAll(".filter-pills .pill")) {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".filter-pills .pill").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    activeType = btn.dataset.type;
    renderList();
  });
}

// Detail top tab switching
for (const btn of document.querySelectorAll(".detail-tabs .tab-btn")) {
  btn.addEventListener("click", () => {
    activeTab = btn.dataset.tab;
    document.querySelectorAll(".detail-tabs .tab-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll(".detail-content .tab-pane").forEach((p) => p.classList.remove("active"));
    el("tab-" + activeTab).classList.add("active");
  });
}

// Clear and close
el("clear").addEventListener("click", () => {
  entries.length = 0;
  hideDetail();
  renderList();
});
el("detail-close").addEventListener("click", hideDetail);

// "Copy Payload / Copy Response" buttons in the top-right of the detail pane
el("copy-req").addEventListener("click", () => {
  if (!selected || selected.req === undefined) return;
  copyText(formatJsonForCopy(selected.req), el("copy-req"));
});

el("copy-resp").addEventListener("click", () => {
  if (!selected || selected.status === "pending" || selected.resp === undefined) return;
  copyText(formatJsonForCopy(selected.resp), el("copy-resp"));
});

// ===== Keyboard navigation: Esc closes detail/menu, ArrowUp/ArrowDown switch entries =====
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

// ===== Drag to resize the left/right split =====
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

// ===== Common utility functions =====
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

async function copyText(text, triggerBtn) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // If the DevTools panel is restricted by focus permissions, fall back to textarea + execCommand
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
    triggerBtn.textContent = "✓ Copied";
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

// ===== Render the request list on the left =====
function renderList() {
  const list = el("list");
  currentRows = entries
    .filter((e) =>
      (!filterText ||
        e.path.toLowerCase().includes(filterText) ||
        (e.traceId ?? "").toLowerCase().includes(filterText)) &&
      (activeType === "ALL" || e.transport === activeType)
    )
    .sort((a, b) => a.ts - a.ts);

  el("count").textContent = currentRows.length + " entries";
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

// ===== List right-click context menu =====
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

// ===== Right detail drawer controls =====
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
    el("resp-body").innerHTML = '<span class="empty">Waiting for response…</span>';
  } else {
    renderJsonTree(el("resp-body"), selected.resp);
  }
  el("copy-req").disabled = selected.req === undefined;
  el("copy-resp").disabled = selected.status === "pending" || selected.resp === undefined;
}

// ===== Tab 1: Headers (General + Request Headers collapsible groups) =====
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
    addHeaderSection(body, "Request Headers", [["Status", "Recorded after the response returns"]]);
    return;
  }
  const rows = Object.entries(e.reqHeaders ?? {});
  if (e.traceId && !rows.some(([k]) => k.toLowerCase() === "x-trace-id")) {
    rows.push(["x-trace-id", e.traceId]);
  }
  addHeaderSection(body, "Request Headers", rows.length > 0 ? rows : [["(not set)", ""]]);
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

// ===== Tabs 2 & 3: collapsible JSON tree =====
function renderJsonTree(container, value) {
  container.innerHTML = "";
  if (value === undefined) {
    container.innerHTML = '<span class="empty">(No data, e.g. a notification or a failure before sending)</span>';
    return;
  }
  container.appendChild(buildJsonNode(container.id, "", value, true, ""));
}

function buildJsonNode(ns, key, value, isRoot, parentPath) {
  const selfPath = parentPath + "/" + key;
  const stored = ns + selfPath;
  // Root nodes expand by default (unless in collapsedPaths); child nodes collapse by default (unless in expandedPaths)
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
