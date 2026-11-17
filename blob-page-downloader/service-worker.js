// Blob Page Downloader — Manifest V3
// Click the extension toolbar icon while the target blob: page is active.

function cleanFilename(value) {
  return String(value || "page")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 150) || "page";
}

function buildFilename(title) {
  let name = cleanFilename(title || "blob-page");
  if (!/\.html?$/i.test(name)) name += ".html";
  return name;
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || typeof tab.id !== "number") return;

  try {
    // activeTab is granted by the user's toolbar click. Read the live DOM
    // from the active tab, rather than trying to fetch its blob: URL.
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const title = document.title || "blob-page";
        const html = "<!doctype html>\n" + document.documentElement.outerHTML;
        return { title, html, href: location.href };
      }
    });

    const payload = results && results[0] && results[0].result;
    if (!payload || typeof payload.html !== "string") {
      throw new Error("Could not read the active page.");
    }

    // A data: URL avoids cross-context blob: URL ownership problems.
    const dataUrl = "data:text/html;charset=utf-8," + encodeURIComponent(payload.html);
    const downloadId = await chrome.downloads.download({
      url: dataUrl,
      filename: buildFilename(payload.title),
      saveAs: false,
      conflictAction: "uniquify"
    });

    await chrome.action.setBadgeText({ tabId: tab.id, text: "OK" });
    await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: "#15803D" });
    console.info("Blob Page Downloader: download started", downloadId, payload.href);
  } catch (error) {
    console.error("Blob Page Downloader:", error);
    await chrome.action.setBadgeText({ tabId: tab.id, text: "ERR" });
    await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: "#B91C1C" });
  }
});