// ==UserScript==
// @name         Copy links / Download selection 1.9  (Right-click on selection)
// @namespace    local.copy-links-in-selection
// @version      1.9
// @description  Right-click on a selection: copy links, plain text, or download the selection as HTML or Markdown. Stores selection early so single-line selections work.
// @match        *://*/*
// @run-at       document-end
// @grant        none
// ==/UserScript==





//this is ok , now summary why the past version fails to copy text   ?9:01 PMWhy the earlier version failedThe old check was:JavaScriptconst hasSel = !!(window.getSelection && String(window.getSelection()).trim());This fails on many pages (especially YouTube) for two reasons:
//Timing

//On contextmenu the browser or the site has often already cleared or collapsed the selection.

//By the time your listener runs, window.getSelection() is empty even though you just highlighted text.
//String(selection) is unreliable

//String(window.getSelection()) does not always return the selected text.

//On some sites / shadow-DOM / custom elements it returns "" even when a real range exists.

//So a perfectly valid single-line selection looked like “nothing selected”.
//The v1.3 fix stores the selection on mouseup / selectionchange (while it is still alive) and re-uses those saved ranges when the right-click happens. That is why it now works.


(function () {
  "use strict";

  const MENU_ID = "__copy_links_menu__";
  const BAR_ID = "__copy_links_bar__";

  // Store the last non-collapsed selection so contextmenu can still see it
  let lastSelectionText = "";
  let lastRanges = [];

  function captureSelection() {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
      lastSelectionText = String(sel);
      lastRanges = [];
      for (let i = 0; i < sel.rangeCount; i++) {
        lastRanges.push(sel.getRangeAt(i).cloneRange());
      }
    }
  }

  // Capture as early as possible
  document.addEventListener("selectionchange", captureSelection, true);
  document.addEventListener("mouseup", captureSelection, true);
  document.addEventListener("keyup", captureSelection, true);

  function hasRealSelection() {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && !sel.isCollapsed) return true;
    // fallback to the stored one
    return lastRanges.length > 0 && lastSelectionText.trim().length > 0;
  }

  function getEffectiveSelection() {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
      return { text: String(sel), ranges: Array.from({length: sel.rangeCount}, (_, i) => sel.getRangeAt(i)) };
    }
    return { text: lastSelectionText, ranges: lastRanges };
  }

  function absUrl(href) {
    try {
      return new URL(href, location.href).href;
    } catch {
      return "";
    }
  }

  function closestLink(node) {
    while (node && node !== document && node !== document.documentElement) {
      if (node.nodeType === 1 && node.tagName === "A" && node.hasAttribute("href")) {
        return node;
      }
      node = node.parentNode || node.parentElement;
    }
    return null;
  }

  function linksInSelection() {
    const { ranges } = getEffectiveSelection();
    const urls = [];
    const seen = new Set();

    function add(href) {
      const u = absUrl(href);
      if (!u || seen.has(u)) return;
      seen.add(u);
      urls.push(u);
    }

    if (!ranges.length) return urls;

    for (const range of ranges) {
      const frag = range.cloneContents();
      frag.querySelectorAll("a[href]").forEach((a) => add(a.getAttribute("href")));
      add(closestLink(range.startContainer)?.getAttribute?.("href"));
      add(closestLink(range.endContainer)?.getAttribute?.("href"));
      add(closestLink(range.commonAncestorContainer)?.getAttribute?.("href"));
    }
    return urls;
  }






  function selectionFragment_original() {
    const { ranges } = getEffectiveSelection();
    if (!ranges.length) return null;
    const frag = document.createDocumentFragment();
    for (const range of ranges) {
      frag.appendChild(range.cloneContents());
    }
    return frag;
  }

  function fragmentToHtml_original(frag) {
    if (!frag) return "";
    const div = document.createElement("div");
    div.appendChild(frag.cloneNode(true));
    div.querySelectorAll("a[href]").forEach((a) => {
      const abs = absUrl(a.getAttribute("href"));
      if (abs) a.setAttribute("href", abs);
    });
    div.querySelectorAll("img[src]").forEach((img) => {
      const abs = absUrl(img.getAttribute("src"));
      if (abs) img.setAttribute("src", abs);
    });
    return div.innerHTML;
  }
const STYLE_PROPS = [
  "color", "background-color", "font-family", "font-size", "font-weight",
  "font-style", "text-decoration", "line-height", "letter-spacing",
  "text-align", "white-space", "display", "margin", "padding",
  "border", "border-radius"
];

function getInlineCss(el) {
  const cs = window.getComputedStyle(el);
  const rules = [];
  // Only Gemini gets layout-style filtering; keep the original behavior elsewhere.
  const isGeminiPage = /^gemini\.google\.com$/i.test(location.hostname);
  const props = isGeminiPage
    ? STYLE_PROPS.filter(prop => !["white-space", "display", "margin", "padding"].includes(prop))
    : STYLE_PROPS;
  for (const prop of props) {
    const val = cs.getPropertyValue(prop);
    // Skip transparent backgrounds to avoid ugly overlapping boxes
    if (prop === "background-color" && (val === "rgba(0, 0, 0, 0)" || val === "transparent")) {
      continue;
    }
    if (val) rules.push(`${prop}:${val}`);
  }
  return rules.join(";");
}

function selectionFragment(withStyles = false) {
  const { ranges } = getEffectiveSelection();
  if (!ranges.length) return null;

  const tagged = [];
  if (withStyles) {
    for (const range of ranges) {
      const root = range.commonAncestorContainer.nodeType === 1
        ? range.commonAncestorContainer
        : range.commonAncestorContainer.parentElement;
      if (!root) continue;

      // Tag the ancestor + all descendants that intersect the selection
      const candidates = [root, ...root.querySelectorAll("*")];
      for (const el of candidates) {
        try {
          if (range.intersectsNode(el) && !el.hasAttribute("data-saved-style")) {
            el.setAttribute("data-saved-style", getInlineCss(el));
            tagged.push(el);
          }
        } catch {}
      }
    }
  }

  const frag = document.createDocumentFragment();
  for (const range of ranges) {
    frag.appendChild(range.cloneContents());
  }

  // Clean up temporary attributes from the live page immediately
  for (const el of tagged) {
    el.removeAttribute("data-saved-style");
  }

  return frag;
}

function fragmentToHtml(frag) {
  if (!frag) return "";
  const div = document.createElement("div");
  div.appendChild(frag.cloneNode(true));

  // Promote captured typography/visual styles to real inline styles.
  div.querySelectorAll("[data-saved-style]").forEach((el) => {
    const saved = el.getAttribute("data-saved-style");
    const existing = el.getAttribute("style") || "";
    el.setAttribute("style", existing ? `${saved};${existing}` : saved);
    el.removeAttribute("data-saved-style");
  });

  const isGemini = /^gemini\.google\.com$/i.test(location.hostname);
  if (isGemini) {
    // Rebuild the page from its meaningful panes. This deliberately keeps
    // sidebar + main content (and other semantic panes), but discards the
    // Gemini application shell and its viewport-dependent layout.
    const appRoot = div.querySelector("#app-root") || div;
    const sidebar = appRoot.querySelector(".sidenav-with-history-container");
    const mainPane = appRoot.querySelector("#xap-skip-link-target");

    if (sidebar || mainPane) {
      const layout = document.createElement("div");
      layout.className = "gemini-export-layout";
      const used = new Set();

      function addPane(source, className, heading) {
        if (!source || used.has(source)) return;
        used.add(source);
        const pane = document.createElement("section");
        pane.className = `gemini-export-pane ${className}`;
        const label = document.createElement("div");
        label.className = "gemini-export-pane-title";
        label.textContent = heading;
        pane.appendChild(label);
        pane.appendChild(source.cloneNode(true));
        layout.appendChild(pane);
      }

      addPane(sidebar, "gemini-export-sidebar", "Navigation");
      addPane(mainPane, "gemini-export-main", "Main content");

      // Preserve additional independent panes where Gemini exposes them
      // through standard semantic containers or accessibility roles.
      const extras = Array.from(appRoot.querySelectorAll(
        "aside, [role='complementary'], [role='region']"
      )).filter(el => {
        if (used.has(el)) return false;
        for (const pane of used) {
          if (pane.contains(el) || el.contains(pane)) return false;
        }
        return true;
      });
      extras.forEach((el, i) => addPane(el, "gemini-export-extra", `Additional content ${i + 1}`));

      // Keep any meaningful residual content not contained in the panes above.
      // This catches app-level notices/toolbars that are outside the main roots.
      const residual = appRoot.cloneNode(true);
      residual.querySelectorAll(
        ".sidenav-with-history-container, #xap-skip-link-target, aside, [role='complementary'], [role='region']"
      ).forEach(el => el.remove());
      if (residual.textContent.trim() || residual.querySelector("img, video, canvas, svg")) {
        addPane(residual, "gemini-export-extra", "Other page content");
      }

      div.replaceChildren(layout);
    }

    // Strip geometry copied from Gemini's live inline styles. Keep typography,
    // colors, borders and other visual hints. The export stylesheet owns layout.
    const layoutProps = [
      "display", "position", "top", "right", "bottom", "left", "inset",
      "width", "min-width", "max-width", "height", "min-height", "max-height",
      "flex", "flex-basis", "flex-grow", "flex-shrink", "flex-flow",
      "align-items", "align-self", "justify-content", "justify-self",
      "order", "grid", "grid-area", "grid-template-columns", "grid-template-rows",
      "grid-column", "grid-row", "gap", "column-gap", "row-gap",
      "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
      "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
      "overflow", "overflow-x", "overflow-y", "transform", "translate",
      "z-index", "contain", "float", "box-sizing", "white-space"
    ];
    div.querySelectorAll("[style]").forEach(el => {
      layoutProps.forEach(prop => el.style.removeProperty(prop));
      if (!el.getAttribute("style").trim()) el.removeAttribute("style");
    });
  }

  div.querySelectorAll("a[href]").forEach((a) => {
    const abs = absUrl(a.getAttribute("href"));
    if (abs) a.setAttribute("href", abs);
  });
  div.querySelectorAll("img[src]").forEach((img) => {
    const abs = absUrl(img.getAttribute("src"));
    if (abs) img.setAttribute("src", abs);
  });
  return div.innerHTML;
}
  function fragmentToMarkdown(frag) {
    if (!frag) return "";
    const div = document.createElement("div");
    div.appendChild(frag.cloneNode(true));

    function walk(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        return (node.nodeValue || "")
          .replace(/[ \t]+/g, " ")
          .replace(/\r\n/g, "\n")
          .replace(/\r/g, "\n");
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return "";

      const tag = node.tagName;
      const children = Array.from(node.childNodes).map(walk).join("");

      if (tag === "BR") return "\n";
      if (tag === "P" || tag === "DIV" || tag === "ARTICLE" || tag === "SECTION") {
        const trimmed = children.replace(/^\s+|\s+$/g, "");
        return trimmed ? trimmed + "\n\n" : "";
      }
      if (/^H[1-6]$/.test(tag)) {
        const level = Number(tag[1]);
        return "#".repeat(level) + " " + children.trim() + "\n\n";
      }
      if (tag === "STRONG" || tag === "B") return "**" + children.trim() + "**";
      if (tag === "EM" || tag === "I") return "*" + children.trim() + "*";
      if (tag === "CODE") return "`" + children.trim() + "`";
      if (tag === "PRE") return "```\n" + children.replace(/^\s+|\s+$/g, "") + "\n```\n\n";
      if (tag === "A") {
        const href = absUrl(node.getAttribute("href")) || node.getAttribute("href") || "";
        const text = children.trim() || href;
        return href ? `[${text}](${href})` : text;
      }
      if (tag === "IMG") {
        const src = absUrl(node.getAttribute("src")) || node.getAttribute("src") || "";
        const alt = node.getAttribute("alt") || "";
        return src ? `![${alt}](${src})` : "";
      }
      if (tag === "LI") return "- " + children.trim() + "\n";
      if (tag === "UL" || tag === "OL") return children + "\n";
      if (tag === "BLOCKQUOTE") {
        return children.trim().split("\n").map(line => "> " + line).join("\n") + "\n\n";
      }
      return children;
    }

    return walk(div).replace(/\n{3,}/g, "\n\n").trim() + "\n";
  }

  function ensureBar() {
    let bar = document.getElementById(BAR_ID);
    if (bar) return bar;
    bar = document.createElement("div");
    bar.id = BAR_ID;
    bar.style.cssText = [
      "position:fixed","top:8px","left:50%","transform:translateX(-50%)",
      "z-index:2147483647","max-width:min(90vw,720px)","padding:8px 14px",
      "border-radius:10px","background:rgba(12,12,12,.75)","color:#f3f3f3",
      "font:12px/1.35 Segoe UI,system-ui,sans-serif","pointer-events:none",
      "box-shadow:0 4px 18px rgba(0,0,0,.28)"
    ].join(";");
    document.documentElement.appendChild(bar);
    return bar;
  }

  function toast(main, detail) {
    const bar = ensureBar();
    bar.innerHTML =
      `<div style="font-weight:700;font-size:13px">${escapeHtml(main)}</div>` +
      (detail ? `<div style="opacity:.8;margin-top:2px;word-break:break-all">${escapeHtml(detail)}</div>` : "");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { if (bar.parentNode) bar.remove(); }, 3500);
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g,"&").replace(/</g,"<").replace(/>/g,">").replace(/"/g,"");
  }

  function filenameBase() {
    const title = (document.title || "page").replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").replace(/[. ]+$/g, "").trim().slice(0, 80) || "page";
    const now = new Date();
    const pad = n => String(n).padStart(2, "0");
    const stamp = now.getFullYear() + pad(now.getMonth()+1) + pad(now.getDate()) + "-" + pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds());
    return `${title} - ${stamp}`;
  }

  function downloadBlob(content, mime, ext) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filenameBase() + ext;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1500);
    toast(`downloaded ${ext}`, a.download);
  }

  async function copyUrls(urls) {
    const text = urls.join("\n");
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {}
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;left:-9999px;top:0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }

  async function doCopyLinks() {
    const urls = linksInSelection();
    if (!urls.length) {
      toast("no links in selection", "highlight text that contains <a> links, then try again");
      return;
    }
    const ok = await copyUrls(urls);
    toast(ok ? `copied ${urls.length} link${urls.length === 1 ? "" : "s"}` : "copy failed",
          urls.slice(0, 6).join("  ·  ") + (urls.length > 6 ? " …" : ""));
  }

  function doDownloadHtml(codeTheme = "original") {
    const frag = selectionFragment(true);
    if (!frag) {
      toast("nothing selected", "highlight some content first");
      return;
    }
    const body = fragmentToHtml(frag);
    const themeClass = codeTheme === "dark"
      ? "gemini-code-theme-dark"
      : codeTheme === "light"
        ? "gemini-code-theme-light"
        : "gemini-code-theme-original";
    const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(document.title || "selection")}</title>
<style>
  :root{--export-min-width:900px}
  *{box-sizing:border-box}
  html{min-width:var(--export-min-width)}
  body{font:14px/1.55 system-ui,sans-serif;margin:0;padding:24px;color:#202124;background:#fff;min-width:var(--export-min-width);max-width:none}
  img,video,canvas,svg{max-width:100%;height:auto}
  pre,code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
  pre{max-width:100%;overflow-x:auto;white-space:pre-wrap;overflow-wrap:anywhere}
  :not(pre)>code{white-space:pre-wrap;overflow-wrap:anywhere}
  table{display:block;max-width:100%;overflow-x:auto;border-collapse:collapse}
  blockquote{margin:0 0 1em 1em;padding-left:1em;border-left:3px solid #ddd;color:#444}
  /* The body owns the overall minimum width; panes share it proportionally. */
  .gemini-export-layout{display:grid;grid-template-columns:minmax(0,250fr) minmax(0,850fr);gap:18px;width:100%;max-width:none;margin:0;align-items:start}
  .gemini-export-pane{min-width:0;max-width:100%;overflow-wrap:anywhere;border:1px solid #dadce0;border-radius:10px;padding:12px;background:#fff}
  .gemini-export-pane-title{font-size:12px;font-weight:700;color:#5f6368;text-transform:uppercase;letter-spacing:.04em;border-bottom:1px solid #e8eaed;padding-bottom:7px;margin-bottom:10px}
  .gemini-export-sidebar{font-size:13px}
  .gemini-export-main{font-size:14px}
  .gemini-export-extra{grid-column:1/-1}
  .gemini-export-pane user-query,.gemini-export-pane model-response,.gemini-export-pane .conversation-container{display:block;max-width:100%;min-width:0}
  .gemini-export-pane p{margin:.55em 0}

  /* Important: never paint an opaque light background on PRE.
     Gemini's actual code background is on its ancestor container. */
  .gemini-export-pane pre{background:transparent;padding:10px;border-radius:6px}
  .gemini-export-pane code{background:transparent}

  /* Alternate 1: force a readable dark code surface. Syntax-highlighted
     child spans keep their own inline colors; only the base CODE color changes. */
  body.gemini-code-theme-dark code-block.enable-luminous-code-block .formatted-code-block-internal-container{
    background:#202124!important;color:#f1f3f4!important;border-radius:8px!important
  }
  body.gemini-code-theme-dark code-block.enable-luminous-code-block pre{background:transparent!important}
  body.gemini-code-theme-dark code-block.enable-luminous-code-block code.code-container.formatted{
    color:#f1f3f4!important;background:transparent!important
  }

  /* Alternate 2: force a readable light code surface. */
  body.gemini-code-theme-light code-block.enable-luminous-code-block .formatted-code-block-internal-container{
    background:#f1f3f4!important;color:#202124!important;border-radius:8px!important
  }
  body.gemini-code-theme-light code-block.enable-luminous-code-block pre{background:transparent!important}
  body.gemini-code-theme-light code-block.enable-luminous-code-block code.code-container.formatted{
    color:#202124!important;background:transparent!important
  }

  /* Intentionally no narrow-screen stacking: preserve the two-pane ratio. */
</style>
</head>
<body class="${themeClass}">
${body}
</body>
</html>`;
    downloadBlob(html, "text/html;charset=utf-8", ".html");
  }
  function doDownloadMd() {
    const frag = selectionFragment();
    if (!frag) {
      toast("nothing selected", "highlight some content first");
      return;
    }
    const md = fragmentToMarkdown(frag);
    downloadBlob(md, "text/markdown;charset=utf-8", ".md");
  }

  async function doCopyMd() {
    const frag = selectionFragment();
    if (!frag) {
      toast("nothing selected", "highlight some content first");
      return;
    }
    const md = fragmentToMarkdown(frag);
    const ok = await copyUrls([md]);
    toast(ok ? "copied Markdown" : "copy failed", md.slice(0, 80).replace(/\n/g, " "));
  }

  async function doCopyPlainText() {
    const { text } = getEffectiveSelection();
    if (!text || !text.trim()) {
      toast("nothing selected", "highlight some content first");
      return;
    }
    const ok = await copyUrls([text]);
    toast(ok ? "copied plain text" : "copy failed", text.slice(0, 80).replace(/\n/g, " "));
  }

  function hideMenu() {
    document.getElementById(MENU_ID)?.remove();
  }

  function showMenu(x, y) {
    hideMenu();
    const urls = linksInSelection();
    const hasSel = hasRealSelection();

    const menu = document.createElement("div");
    menu.id = MENU_ID;
    menu.style.cssText = [
      "position:fixed",
      `left:${Math.min(x, window.innerWidth - 280)}px`,
      `top:${Math.min(y, window.innerHeight - 140)}px`,
      "z-index:2147483647","min-width:240px","background:#fff","color:#111",
      "border:1px solid #d0d0d0","border-radius:8px","box-shadow:0 8px 24px rgba(0,0,0,.18)",
      "font:13px/1.4 Segoe UI,system-ui,sans-serif","overflow:hidden"
    ].join(";");

    const items = [
{ label: "Copy plain text", enabled: hasSel, action: doCopyPlainText },
      {
        label: urls.length ? `Copy ${urls.length} link${urls.length === 1 ? "" : "s"} in selection` : "Copy links in selection (none found)",
        enabled: urls.length > 0,
        action: doCopyLinks,
      },
      { label: "Download selection as HTML", enabled: hasSel, action: doDownloadHtml },
      { label: "Download HTML — original code colors", enabled: hasSel, action: () => doDownloadHtml("original") },
      { label: "Download HTML — dark code blocks", enabled: hasSel, action: () => doDownloadHtml("dark") },
      { label: "Download HTML — light code blocks", enabled: hasSel, action: () => doDownloadHtml("light") },
      { label: "Download selection as Markdown", enabled: hasSel, action: doDownloadMd },
      { label: "Copy Markdown to clipboard", enabled: hasSel, action: doCopyMd },
      { label: "Copy plain text", enabled: hasSel, action: doCopyPlainText },
    ];

    for (const it of items) {
      const item = document.createElement("div");
      item.textContent = it.label;
      item.style.cssText = "padding:9px 12px;cursor:" + (it.enabled ? "pointer" : "default") + ";" + (it.enabled ? "" : "opacity:.45;");
      if (it.enabled) {
        item.onmouseenter = () => { item.style.background = "#f0f4ff"; };
        item.onmouseleave = () => { item.style.background = "transparent"; };
        item.onmousedown = (e) => { e.preventDefault(); e.stopPropagation(); };
        item.onclick = async (e) => {
          e.preventDefault();
          e.stopPropagation();
          hideMenu();
          await it.action();
        };
      }
      menu.appendChild(item);
    }

    document.documentElement.appendChild(menu);
  }

  document.addEventListener("contextmenu", (e) => {
    // Re-capture just in case
    captureSelection();

    if (!hasRealSelection()) {
      hideMenu();
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    showMenu(e.clientX + 4, e.clientY + 4);
  }, true);

  document.addEventListener("click", hideMenu, true);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideMenu();
  });
  window.addEventListener("scroll", hideMenu, true);

  console.log("%c[CopyLinks] v1.3 loaded — selection is captured early", "color:#0a0");
})();
