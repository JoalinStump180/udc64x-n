const $ = (id) => document.getElementById(id);

const RECENT_KEY = "lfe-recent-kw";
const RECENT_MAX = 40;
function loadRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); }
  catch { return []; }
}
function saveRecent(list) {
  localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX)));
}
function addRecent(kw) {
  kw = String(kw || "").trim();
  if (!kw) return;
  let list = loadRecent().filter(x => x !== kw);
  list.unshift(kw);
  saveRecent(list);
  renderRecent();
}
function renderRecent() {
  const sel = $("recentKw");
  if (!sel) return;
  const list = loadRecent();
  sel.innerHTML = '<option value="">Recent…</option>' +
    list.map(k => `<option value="${esc(k)}">${esc(k)}</option>`).join("");
}
const LFE_LOG = (...args) => console.log("[LFE]", ...args);
const LFE_WARN = (...args) => console.warn("[LFE]", ...args);
const LFE_ERROR = (...args) => console.error("[LFE]", ...args);

LFE_LOG("explorer.js loaded", {
  url: location.href,
  readyState: document.readyState,
  userAgent: navigator.userAgent
});
window.addEventListener("error", (event) => {
  LFE_ERROR("window error", event.message, event.filename, event.lineno, event.colno, event.error);
});
window.addEventListener("unhandledrejection", (event) => {
  LFE_ERROR("unhandled promise rejection", event.reason);
});
const EVERYTHING = "http://localhost:9090";
const EV_PAGE = 32;
const UI_PAGE = 200;

let allFiles = [];
let shown = [];
let sortKey = "modified";
let sortDir = -1;
let page = 0;

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function isEverythingQuery(q) {
  return /[*?]/.test(q);
}
function parseEverythingHtml(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const rows = [];
  doc.querySelectorAll("tr.trdata1, tr.trdata2").forEach((tr) => {
    const nameA = tr.querySelector("td.file a, td.folder a");
    const pathA = tr.querySelector("td.pathdata a");
    if (!nameA) return;
    const textOf = (sel) => {
      const el = tr.querySelector(sel);
      return el ? el.textContent.replace(/\s+/g, " ").trim() : "";
    };
    rows.push({
      name: nameA.textContent.trim(),
      path: textOf("td.pathdata"),
      //path: pathA ? pathA.textContent.trim() : "",
      size: textOf("td.sizedata"),
      modified: textOf("td.modifieddata"),
      href: nameA.getAttribute("href") || "",
      type: tr.querySelector("td.folder") ? "folder" : "file"
    });
  });
  const num = (doc.querySelector(".numresults") || {}).textContent || "";
  const m = num.replace(/,/g, "").match(/of\s+(\d+)/i);
  const result = { rows, total: m ? Number(m[1]) : rows.length };
  LFE_LOG("parseEverythingHtml", {
    htmlLength: html.length,
    parsedRows: rows.length,
    numresultsText: num.trim(),
    total: result.total,
    firstRow: rows[0] || null
  });
  return result;
}
const MAX_PAGES = 50;
async function fetchEverything(search) {
  LFE_LOG("fetchEverything start", { search, endpoint: EVERYTHING, pageSize: EV_PAGE, maxPages: MAX_PAGES });
  const all = [];
  let offset = 0;
  let total = Infinity;
  let pages = 0;
  while (offset < total && pages < MAX_PAGES) {
    const url = EVERYTHING + "/?search=" + encodeURIComponent(search) + "&offset=" + offset + "&sort=date_modified&ascending=0";
    LFE_LOG("requesting Everything page", { offset, url, collected: all.length, expectedTotal: total });
    $("status").textContent = "Everything " + all.length + " / " + (total === Infinity ? "?" : total);
    const res = await chrome.runtime.sendMessage({ type: "everything-fetch", url });
    LFE_LOG("Everything response received", {
      offset,
      hasResponse: !!res,
      ok: res && res.ok,
      status: res && res.status,
      textLength: res && res.text ? res.text.length : 0,
      error: res && res.error,
      preview: res && res.text ? res.text.slice(0, 180).replace(/\s+/g, " ") : ""
    });
    if (!res || !res.ok) throw new Error(res && res.error ? res.error : ("Everything HTTP " + (res && res.status)));
    if (!res.text || res.text.length < 20) throw new Error("Empty Everything response");
    const pageData = parseEverythingHtml(res.text);
    if (!pageData.rows.length && offset === 0) {
      throw new Error("No rows parsed. First bytes: " + res.text.slice(0, 80).replace(/\s+/g, " "));
    }
    total = pageData.total;
    all.push(...pageData.rows);
    LFE_LOG("page accumulated", { offset, pageRows: pageData.rows.length, collected: all.length, total });
    if (!pageData.rows.length) break;
    pages++;
    offset += EV_PAGE;
  }
  if (pages >= MAX_PAGES && offset < total) {
    LFE_WARN("stopped at page limit", { pages, collected: all.length, total });
  }
  LFE_LOG("fetchEverything complete", { search, count: all.length, pages });
  return all;
}
function normDate(s) {
  // "2026/9/7 12:00" → "2026/09/07 12:00" so string sort is chronological
  return String(s || "").replace(/(\d{4})\/(\d{1,2})\/(\d{1,2})/, (_, y, m, d) =>
    `${y}/${m.padStart(2,"0")}/${d.padStart(2,"0")}`);
}
function applyFilter() {
  const q = $("q").value.trim().toLowerCase();
  LFE_LOG("applyFilter", { filter: q, sourceCount: allFiles.length });
  shown = !q ? allFiles.slice() : allFiles.filter((r) =>
    r.name.toLowerCase().includes(q) || r.path.toLowerCase().includes(q));
  shown.sort((a, b) => {
    if (sortKey === "modified") {
      return normDate(a.modified).localeCompare(normDate(b.modified)) * sortDir;
    }
    const va = a[sortKey], vb = b[sortKey];
    if (typeof va === "string") return va.localeCompare(vb) * sortDir;
    return (va - vb) * sortDir;
  });
  page = 0;
  LFE_LOG("filter complete", { shownCount: shown.length, sortKey, sortDir });
  render();
}
function render() {
  const start = page * UI_PAGE;
  const slice = shown.slice(start, start + UI_PAGE);
  $("tbody").innerHTML = slice.map((r) =>
    "<tr><td title=\"" + esc(r.name) + "\">" + esc(r.name) + "</td>" +
    "<td title=\"" + esc(r.path) + "\">" + esc(r.path) + "</td>" +
    "<td>" + esc(r.size) + "</td>" +
    "<td>" + esc(r.modified) + "</td>" +
    "<td>" + esc(r.type || "") + "</td></tr>"
  ).join("");
  $("empty").hidden = shown.length > 0;
  const pages = Math.max(1, Math.ceil(shown.length / UI_PAGE));
  $("status").textContent = shown.length + " files · page " + (page + 1) + "/" + pages + " (200/page)";
  LFE_LOG("render", { page, start, renderedRows: slice.length, shownCount: shown.length, empty: shown.length === 0 });
  $("prevBtn").disabled = page <= 0;
  $("nextBtn").disabled = start + UI_PAGE >= shown.length;
}
async function loadQuery(q) {
  q = String(q || "").trim();
  LFE_LOG("loadQuery", { rawQuery: q });
  if (!q) {
    LFE_WARN("loadQuery ignored: empty query");
    return;
  }
  $("rootPath").textContent = q;
  if (0 && !isEverythingQuery(q)) {
    LFE_WARN("query rejected: wildcard * or ? required", { query: q });
    $("status").textContent = "Use an Everything query with * or ?, e.g. v:\\downloads\\*.mp4";
    return;
  }
  allFiles = await fetchEverything(q);
  LFE_LOG("loadQuery fetched files", { count: allFiles.length });
  addRecent(q);
  applyFilter();
}
$("goBtn").addEventListener("click", async () => {
  const query = $("pathInput").value;
  LFE_LOG("List button clicked", { query });
  try { await loadQuery(query); }
  catch (err) {
    LFE_ERROR("List operation failed", err);
    $("status").textContent = "List failed: " + err.message;
  }
});
$("pathInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    LFE_LOG("Enter pressed in query input");
    $("goBtn").click();
  }
});
$("q").addEventListener("input", applyFilter);
$("prevBtn").addEventListener("click", () => { if (page > 0) { page--; render(); } });
$("nextBtn").addEventListener("click", () => {
  if ((page + 1) * UI_PAGE < shown.length) { page++; render(); }
});
document.querySelectorAll("thead th").forEach((th) => {
  th.addEventListener("click", () => {
    const key = th.dataset.sort;
    LFE_LOG("sort header clicked", { key, previousSortKey: sortKey, previousSortDir: sortDir });
    if (sortKey === key) sortDir = -sortDir; else { sortKey = key; sortDir = (key === "modified") ? -1 : 1; }
    applyFilter();
  });
});
$("status").textContent = "Enter an Everything query, e.g. v:\\downloads\\*.mp4";
renderRecent();
$("recentKw").addEventListener("change", () => {
  const v = $("recentKw").value;
  if (v) {
    $("pathInput").value = v;
    $("goBtn").click();
  }
});
LFE_LOG("UI initialized", {
  pathInput: !!$("pathInput"), goBtn: !!$("goBtn"), tbody: !!$("tbody"),
  status: !!$("status"), filterInput: !!$("q"), tableHeaders: document.querySelectorAll("thead th").length
});

// --- Clear / Export buttons ---
function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 100);
}

$("clearBtn").addEventListener("click", () => {
  LFE_LOG("Clear clicked");
  allFiles = [];
  shown = [];
  page = 0;
  sortKey = "name";
  sortDir = 1;
  $("tbody").innerHTML = "";
  $("empty").hidden = false;
  $("empty").textContent = "Cleared. Enter a new Everything query.";
  $("status").textContent = "0 files";
  $("rootPath").textContent = "(no query)";
  $("q").value = "";
  $("prevBtn").disabled = true;
  $("nextBtn").disabled = true;
});

$("exportHtmlBtn").addEventListener("click", () => {
  if (!shown.length) {
    $("status").textContent = "Nothing to export";
    return;
  }
  const rows = shown.map(r =>
    `<tr><td>${esc(r.name)}</td><td>${esc(r.path)}</td><td>${esc(r.size)}</td><td>${esc(r.modified)}</td><td>${esc(r.type||"")}</td></tr>`
  ).join("");
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Everything export</title>
<style>body{font:13px Segoe UI,sans-serif}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:4px 8px;text-align:left}th{background:#f5f5f5}</style>
</head><body>
<p>${shown.length} files · query: ${esc($("rootPath").textContent)}</p>
<table><thead><tr><th>Name</th><th>Path</th><th>Size</th><th>Modified</th><th>Type</th></tr></thead>
<tbody>${rows}</tbody></table></body></html>`;
  const stamp = new Date().toISOString().slice(0,19).replace(/[:T]/g,"-");
  download(`everything-${stamp}.html`, html, "text/html");
  $("status").textContent = `Exported ${shown.length} items to HTML`;
  LFE_LOG("exported HTML", { count: shown.length });
});

$("exportJsonBtn").addEventListener("click", () => {
  if (!shown.length) {
    $("status").textContent = "Nothing to export";
    return;
  }
  const data = {
    query: $("rootPath").textContent,
    exportedAt: new Date().toISOString(),
    count: shown.length,
    items: shown
  };
  const stamp = new Date().toISOString().slice(0,19).replace(/[:T]/g,"-");
  download(`everything-${stamp}.json`, JSON.stringify(data, null, 2), "application/json");
  $("status").textContent = `Exported ${shown.length} items to JSON`;
  LFE_LOG("exported JSON", { count: shown.length });
});
