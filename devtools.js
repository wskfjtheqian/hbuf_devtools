const tabId = chrome.devtools.inspectedWindow.tabId;
chrome.devtools.panels.create("HRPC", "", "panel.html?tabId=" + tabId);
