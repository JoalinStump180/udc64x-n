# Blob Page Downloader

A small Chrome/Edge Manifest V3 extension. When you are viewing a generated
`blob:` HTML page, click the extension toolbar icon. It reads the currently
rendered DOM and downloads it as an `.html` file using the page title as the
filename.

## Install (Chrome or Edge)

1. Extract this ZIP to a permanent folder.
2. Open `chrome://extensions` in Chrome, or `edge://extensions` in Edge.
3. Turn on **Developer mode**.
4. Click **Load unpacked**.
5. Select the extracted `blob-page-downloader` folder.
6. Open the target `blob:` page and click the extension's toolbar icon.
   If the icon is hidden, pin the extension first.

The download goes to the browser's normal Downloads folder. The filename is
based on `document.title`, with unsafe filename characters replaced.

## Important limitations

- This downloads the current DOM (`document.documentElement.outerHTML`), not
  the original bytes used to create the Blob URL.
- The extension uses `activeTab` and `scripting`; clicking the toolbar icon
  grants temporary access to the active tab.
- Some browser-internal pages cannot be scripted. If injection into a particular
  `blob:` page is blocked, check the extension service-worker console at
  `chrome://extensions` / `edge://extensions` → this extension → **service worker**.
- This first version uses a `data:` download URL. Very large pages may exceed
  browser or platform URL limits. For large exports, a follow-up version can
  use an offscreen document to create an extension-owned Blob URL.
- The page's inline scripts and styles are retained in the saved HTML. External
  resources remain external references and may still require network access.
