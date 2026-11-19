// ==UserScript==
// @name         Copy links / Download selection 1.5  (Right-click on selection)
// @namespace    local.copy-links-in-selection
// @version      1.5.1
// @description  Right-click on a selection: copy links, plain text, or download the selection as HTML or Markdown. Stores selection early so single-line selections work.
// @match        *://*/*
// @run-at       document-end
// @grant        none
// ==/UserScript==

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
    return lastRanges.length > 0 && lastSelectionText.trim().length > 0;
  }

  function getEffectiveSelection() {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
      return {
        text: String(sel),
        ranges: Array.from({ length: sel.rangeCount }, (_, i) => sel.getRangeAt(i))
      };
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

  const STYLE_PROPS = [
    "color", "background-color", "font-family", "font-size", "font-weight",
    "font-style", "text-decoration", "line-height", "letter-spacing",
    "text-align", "white-space", "display", "margin", "padding",
    "border", "border-radius"
  ];

  function getInlineCss(el) {
    const cs = window.getComputedStyle(el);
    const rules = [];
    for (const prop of STYLE_PROPS) {
      let val = cs.getPropertyValue(prop);

      // Skip transparent backgrounds to avoid ugly overlapping boxes
      if (prop === "background-color" && (val === "rgba(0, 0, 0, 0)" || val === "transparent")) {
        continue;
      }

      // Prevent nowrap from forcing wide horizontal lines in standalone HTML
      if (prop === "white-space" && val === "nowrap") {
        val = "normal";
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

    for (const el of tagged) {
      el.removeAttribute("data-saved-style");
    }

    return frag;
  }

  function fragmentToHtml(frag) {
    if (!frag) return "";
    const div = document.createElement("div");
    div.appendChild(frag.cloneNode(true));

    div.querySelectorAll("[data-saved-style]").forEach((el) => {
      const saved = el.getAttribute("data-saved-style");
      const existing = el.getAttribute("style") || "";
      el.setAttribute("style", existing ? `${saved};${existing}` : saved);
      el.removeAttribute("data-saved-style");
    });

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
      "position:fixed", "top:8px", "left:50%", "transform:translateX(-50%)",
      "z-index:2147483647", "max-width:min(90vw,720px)", "padding:8px 14px",
      "border-radius:10px", "background:rgba(12,12,12,.75)", "color:#f3f3f3",
      "font:12px/1.35 Segoe UI,system-ui,sans-serif", "pointer-events:none",
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
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function filenameBase() {
    const title = (document.title || "page")
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
      .replace(/[. ]+$/g, "")
      .trim()
      .slice(0, 80) || "page";
    const now = new Date();
    const pad = n => String(n).padStart(2, "0");
    const stamp = now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) + "-" + pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds());
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
    toast(
      ok ? `copied ${urls.length} link${urls.length === 1 ? "" : "s"}` : "copy failed",
      urls.slice(0, 6).join("  ·  ") + (urls.length > 6 ? " …" : "")
    );
  }

  function doDownloadHtml() {
    const frag = selectionFragment(true);
    if (!frag) {
      toast("nothing selected", "highlight some content first");
      return;
    }
    const body = fragmentToHtml(frag);
    const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(document.title || "selection")}</title>
<style>
  html, body { max-width: 100%; overflow-x: clip; }
  body { font: 14px/1.5 system-ui, sans-serif; margin: 24px auto; max-width: 760px; color: #111; background: #fff; overflow-wrap: anywhere; }
  * { box-sizing: border-box; max-width: 100%; }
  img { height: auto; }
  pre { white-space: pre-wrap; word-break: break-word; }
  code { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; word-break: break-word; }
  blockquote { margin: 0 0 0 1em; padding-left: 1em; border-left: 3px solid #ddd; color: #444; }
</style>
</head>
<body>
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
      `top:${Math.min(y, window.innerHeight - 160)}px`,
      "z-index:2147483647", "min-width:240px", "background:#fff", "color:#111",
      "border:1px solid #d0d0d0", "border-radius:8px", "box-shadow:0 8px 24px rgba(0,0,0,.18)",
      "font:13px/1.4 Segoe UI,system-ui,sans-serif", "overflow:hidden"
    ].join(";");

    const items = [
      { label: "Copy plain text", enabled: hasSel, action: doCopyPlainText },
      {
        label: urls.length ? `Copy ${urls.length} link${urls.length === 1 ? "" : "s"} in selection` : "Copy links in selection (none found)",
        enabled: urls.length > 0,
        action: doCopyLinks,
      },
      { label: "Download selection as HTML", enabled: hasSel, action: doDownloadHtml },
      { label: "Download selection as Markdown", enabled: hasSel, action: doDownloadMd },
      { label: "Copy Markdown to clipboard", enabled: hasSel, action: doCopyMd },
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

  console.log("%c[CopyLinks] v1.5.1 loaded — selection is captured early", "color:#0a0");
})();