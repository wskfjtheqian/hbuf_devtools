// MAIN world 桥脚本：由 content.js 以 <script src=chrome.runtime.getURL("bridge.js")> 注入
// （页面 CSP 需放行扩展源；内联脚本会被 script-src 拦截，不能用 textContent 注入）。
// 加载完成后立即全量补发一次，解决「桥异步加载前 SDK 已写入的日志」时序问题。
(() => {
  if (window.__HBUF_RPC_BRIDGE__) return;
  window.__HBUF_RPC_BRIDGE__ = true;

  // 诊断标记：在页面 console 执行 window.__HBUF_RPC_CONTENT__ 验证注入是否成功
  window.__HBUF_RPC_CONTENT__ = true;

  const EVENT = "__hbuf_rpc_log__";
  // 初始 0：桥加载完成后把页面已有日志全量送出（面板侧按 id 去重，不会重复展示）
  let lastLength = 0;

  function safeClone(entry) {
    try {
      return JSON.parse(JSON.stringify(entry));
    } catch {
      return { id: entry?.id, path: entry?.path, error: "序列化失败" };
    }
  }

  function post(entries) {
    try {
      window.postMessage({ type: "HBUF_LOG", entries }, "*");
    } catch (e) { /* 忽略不可克隆条目 */ }
  }

  function collect() {
    const logs = window.__HBUF_RPC_LOG__;
    if (!logs || logs.length <= lastLength) return;
    const fresh = logs.slice(0, logs.length - lastLength).map(safeClone);
    lastLength = logs.length;
    post(fresh);
  }

  window.addEventListener(EVENT, (event) => {
    const entry = event && event.detail;
    if (entry && typeof entry === "object" && entry.id != null) {
      // 单条推送：新增（pending）与更新（done）都即时送出，不等轮询
      post([safeClone(entry)]);
      const logs = window.__HBUF_RPC_LOG__;
      if (logs && logs.length > lastLength) {
        // 新增条目已推送，同步计数避免轮询重复发送
        lastLength = logs.length;
      }
      return;
    }
    collect();
  });

  collect(); // 全量补发：把桥加载完成前 SDK 已写入的日志一次性送出
  setInterval(collect, 1000); // 兜底轮询，防事件丢失
})();
