// ISOLATED world：向页面注入 MAIN world 桥脚本（<script src=chrome.runtime.getURL("bridge.js")>），
// 并把桥回传的日志转发给 background。
// 注：页面 CSP 若允许扩展源（script-src 含 chrome-extension://<扩展ID>/），
// <script src> 注入可用；内联脚本（textContent）会被 script-src 拦截，不可用。
(() => {
  // 扩展被 reload 后，旧页面上的 content script 上下文会失效（chrome API 全部抛
  // "Extension context invalidated"）。此时桥仍在发消息，若每次都警告会刷屏，
  // 因此失效后只提示一次并停止转发；恢复日志采集需刷新页面。
  let dead = false;

  function fail(e) {
    if (dead) return;
    dead = true;
    window.removeEventListener("message", handleMessage);
    console.warn("[HBuf RPC Inspector] 扩展已更新，上下文失效，请刷新页面后重试:", e);
  }

  function handleMessage(event) {
    if (event.source !== window || !event.data || event.data.type !== "HBUF_LOG") return;
    if (!Array.isArray(event.data.entries)) return;
    if (dead) return; // 上下文已失效，静默丢弃
    try {
      // MV3 sendMessage 返回 Promise：异步 reject 需用 .catch 处理
      chrome.runtime.sendMessage({ type: "HBUF_LOG", href: location.href, entries: event.data.entries })
        .catch(fail);
    } catch (e) {
      fail(e);
    }
  }

  function injectBridge() {
    const s = document.createElement("script");
    s.src = chrome.runtime.getURL("bridge.js");
    s.onload = () => s.remove();
    s.onerror = () => {
      s.remove();
      console.warn("[HBuf RPC Inspector] bridge.js 注入失败：页面 CSP 未放行扩展源，请在 script-src 中加入 chrome-extension://" + chrome.runtime.id + "/");
    };
    (document.head || document.documentElement).appendChild(s);
  }

  window.addEventListener("message", handleMessage);
  injectBridge();
})();
