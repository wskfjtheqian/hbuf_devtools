// MAIN world bridge script: listens for real-time RPC log events and forwards them to the content script
(() => {
  if (window.__HBUF_RPC_BRIDGE__) return;
  window.__HBUF_RPC_BRIDGE__ = true;
  window.__HBUF_RPC_CONTENT__ = true;

  const EVENT = "__hbuf_rpc_log__";

  function safeClone(entry) {
    try {
      return JSON.parse(JSON.stringify(entry));
    } catch {
      return { id: entry?.id, path: entry?.path, error: "Serialization failed" };
    }
  }

  window.addEventListener(EVENT, (event) => {
    const entry = event && event.detail;
    if (entry && typeof entry === "object" && entry.id != null) {
      try {
        window.postMessage({ type: "HBUF_LOG", entries: [safeClone(entry)] }, "*");
      } catch (e) {
        /* Ignore non-cloneable entries */
      }
    }
  });
})();
