const tabId = chrome.devtools.inspectedWindow.tabId;
chrome.devtools.panels.create("HBuf RPC", "", "panel.html?tabId=" + tabId);
