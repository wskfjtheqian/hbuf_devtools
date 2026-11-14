// MAIN world bridge script: injected by content.js via <script src=chrome.runtime.getURL("bridge.js")>
// (The page CSP must allow the extension origin; inline scripts are blocked by script-src, so textContent injection is not possible).
// Batch-send everything once right after loading, solving the timing issue of "logs written by the SDK before the bridge loaded".
(() => {
  if (window.__HBUF_RPC_BRIDGE__) return;
  window.__HBUF_RPC_BRIDGE__ = true;

  // Diagnostic flag: check window.__HBUF_RPC_CONTENT__ in the page console to verify the injection succeeded
  window.__HBUF_RPC_CONTENT__ = true;

  const EVENT = "__hbuf_rpc_log__";
  // Starts at 0: after the bridge loads, send all existing page logs (the panel dedupes by id, so nothing shows twice)
  let lastLength = 0;

  function safeClone(entry) {
    try {
      return JSON.parse(JSON.stringify(entry));
    } catch {
      return { id: entry?.id, path: entry?.path, error: "Serialization failed" };
    }
  }

  function post(entries) {
    try {
      window.postMessage({ type: "HBUF_LOG", entries }, "*");
    } catch (e) { /* ignore entries that cannot be cloned */ }
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
      // Single-entry push: both new (pending) and updated (done) entries are sent immediately, without waiting for polling
      post([safeClone(entry)]);
      const logs = window.__HBUF_RPC_LOG__;
      if (logs && logs.length > lastLength) {
        // The new entry has been pushed; sync the counter to avoid resending it via polling
        lastLength = logs.length;
      }
      return;
    }
    collect();
  });

  collect(); // Full resend: batch-send all logs the SDK wrote before the bridge loaded
  setInterval(collect, 1000); // Fallback polling in case events are lost
})();
