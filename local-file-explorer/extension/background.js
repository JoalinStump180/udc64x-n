chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL("explorer.html") });
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "everything-fetch") return;
  fetch(msg.url)
    .then((res) => res.text().then((text) => sendResponse({ ok: res.ok, status: res.status, text })))
    .catch((err) => sendResponse({ ok: false, status: 0, error: err.message }));
  return true;
});
