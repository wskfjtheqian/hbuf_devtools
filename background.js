// @ts-nocheck
// Message hub: forward RPC logs directly to active DevTools panels by tabId (no caching)
const panels = new Map(); // tabId -> Set<Port>

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "HBUF_PANEL") return;
  port.onMessage.addListener((msg) => {
    if (msg.type !== "REGISTER") return;
    if (!panels.has(msg.tabId)) panels.set(msg.tabId, new Set());
    panels.get(msg.tabId).add(port);

    port.onDisconnect.addListener(() => {
      const set = panels.get(msg.tabId);
      set?.delete(port);
      if (set && set.size === 0) panels.delete(msg.tabId);
    });
  });
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type !== "HBUF_LOG" || !sender.tab) return;
  const set = panels.get(sender.tab.id);
  // Drop logs silently if no DevTools panel is currently open for this tab
  if (!set || set.size === 0) return;
  for (const port of set) {
    port.postMessage({ type: "HBUF_LOG", entries: msg.entries });
  }
});
