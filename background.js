// 消息中枢：把 content script 的日志按 tabId 转发给对应 DevTools 面板
const panels = new Map(); // tabId -> Set<Port>
const cache = new Map(); // tabId -> entries[]（面板打开前的日志缓存，注册时回放）

const MAX_CACHE = 200;

function pushCache(tabId, entries) {
  if (!entries || entries.length === 0) return;
  if (!cache.has(tabId)) cache.set(tabId, []);
  const list = cache.get(tabId);
  for (const e of entries) {
    // 同 id 覆盖：同一条 RPC 的 pending 被 done 替换，不产生重复缓存
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
    // 回放缓存：面板打开前产生的日志一次性补发，解决“先触发后开面板”时序问题
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
