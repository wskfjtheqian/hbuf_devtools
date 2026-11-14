// ISOLATED world: injects the MAIN world bridge script into the page (<script src=chrome.runtime.getURL("bridge.js")>),
// and forwards the logs the bridge sends back to the background.
// Note: if the page CSP allows the extension origin (script-src contains chrome-extension://<extension-id>/),
// <script src> injection works; inline scripts (textContent) are blocked by script-src and cannot be used.
(() => {
  // After the extension is reloaded, the content script context on old pages becomes
  // invalid (all chrome APIs throw "Extension context invalidated"). The bridge keeps
  // sending messages, and warning every time would spam the console, so warn only once
  // and stop forwarding; refresh the page to resume log collection.
  let dead = false;

  function fail(e) {
    if (dead) return;
    dead = true;
    window.removeEventListener("message", handleMessage);
    console.warn("[HBuf RPC Inspector] The extension was updated and the context is invalid. Refresh the page and try again:", e);
  }

  function handleMessage(event) {
    if (event.source !== window || !event.data || event.data.type !== "HBUF_LOG") return;
    if (!Array.isArray(event.data.entries)) return;
    if (dead) return; // context is invalid; silently drop
    try {
      // MV3 sendMessage returns a Promise: async rejection must be handled with .catch
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
      console.warn("[HBuf RPC Inspector] Failed to inject bridge.js: the page CSP does not allow the extension origin. Add chrome-extension://" + chrome.runtime.id + "/ to script-src");
    };
    (document.head || document.documentElement).appendChild(s);
  }

  window.addEventListener("message", handleMessage);
  injectBridge();
})();
