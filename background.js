// Message hub: forwards content script logs to the matching DevTools panel by tabId
const panels = new Map(); // tabId -> Set<Port>
const cache = new Map(); // tabId -> entries[] (logs cached before the panel opens, replayed on registration)

const MAX_CACHE = 200;

function pushCache(tabId, entries) {
  if (!entries || entries.length === 0) return;
  if (!cache.has(tabId)) cache.set(tabId, []);
  const list = cache.get(tabId);
  for (const e of entries) {
    // Overwrite by id: the pending entry of an RPC is replaced by its done entry, avoiding duplicate cache items
    const idx = list.findIndex((x) => x.id === e.id);
    if (idx >= 0) list.splice(idx, 1);
    list.unshift(e);
  }
  if (list.length > MAX_CACHE) list.length = MAX_CACHE;
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "HBUF_PANEL") return;
  port.onMessage.addListener((msg) => {
    if (msg.type !== "REGISTER") return;
    if (!panels.has(msg.tabId)) panels.set(msg.tabId, new Set());
    panels.get(msg.tabId).add(port);
    // Replay cache: batch-send logs produced before the panel opens, solving the "fired before panel opened" timing issue
    const snapshot = cache.get(msg.tabId) || [];
    if (snapshot.length > 0) {
      port.postMessage({ type: "HBUF_LOG", entries: snapshot });
    }
    port.onDisconnect.addListener(() => {
      const set = panels.get(msg.tabId);
      set?.delete(port);
      if (set && set.size === 0) panels.delete(msg.tabId);
    });
  });
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type !== "HBUF_LOG" || !sender.tab) return;
  pushCache(sender.tab.id, msg.entries);
  const set = panels.get(sender.tab.id);
  if (!set) return;
  for (const port of set) {
    port.postMessage({ type: "HBUF_LOG", entries: msg.entries });
  }
});
