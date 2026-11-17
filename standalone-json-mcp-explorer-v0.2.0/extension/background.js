"use strict";

chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL("explorer.html");
  const tabs = await chrome.tabs.query({ url });
  if (tabs.length && tabs[0].id != null) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    if (tabs[0].windowId != null) await chrome.windows.update(tabs[0].windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url, active: true });
  }
});
