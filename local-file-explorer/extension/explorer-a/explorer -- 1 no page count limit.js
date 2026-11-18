const $ = (id) => document.getElementById(id);
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
let sortKey = "name";
let sortDir = 1;
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
    const nameA = tr.querySelector("td.file a");
    const pathA = tr.querySelector("td.pathdata a");
    if (!nameA) return;
    const textOf = (sel) => {
      const el = tr.querySelector(sel);
      return el ? el.textContent.replace(/\s+/g, " ").trim() : "";
    };
    rows.push({
      name: nameA.textContent.trim(),
      path: pathA ? pathA.textContent.trim() : "",
      size: textOf("td.sizedata"),
      modified: textOf("td.modifieddata"),
      href: nameA.getAttribute("href") || "",
      type: "file"
    });
  });
  const num = (doc.querySelector(".numresults") || {}).textContent || "";
  const m = num.match(/of\s+(\d+)/i);
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
async function fetchEverything(search) {
  LFE_LOG("fetchEverything start", { search, endpoint: EVERYTHING, pageSize: EV_PAGE });
  const all = [];
  let offset = 0;
  let total = Infinity;
  while (offset < total) {
    const url = EVERYTHING + "/?search=" + encodeURIComponent(search) + "&offset=" + offset;
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
    offset += EV_PAGE;
  }
  LFE_LOG("fetchEverything complete", { search, count: all.length });
  return all;
}
function applyFilter() {
  const q = $("q").value.trim().toLowerCase();
  LFE_LOG("applyFilter", { filter: q, sourceCount: allFiles.length });
  shown = !q ? allFiles.slice() : allFiles.filter((r) =>
    r.name.toLowerCase().includes(q) || r.path.toLowerCase().includes(q));
  shown.sort((a, b) => {
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
  if (!isEverythingQuery(q)) {
    LFE_WARN("query rejected: wildcard * or ? required", { query: q });
    $("status").textContent = "Use an Everything query with * or ?, e.g. v:\\downloads\\*.mp4";
    return;
  }
  allFiles = await fetchEverything(q);
  LFE_LOG("loadQuery fetched files", { count: allFiles.length });
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
    if (sortKey === key) sortDir = -sortDir; else { sortKey = key; sortDir = 1; }
    applyFilter();
  });
});
$("status").textContent = "Enter an Everything query, e.g. v:\\downloads\\*.mp4";
LFE_LOG("UI initialized", {
  pathInput: !!$("pathInput"), goBtn: !!$("goBtn"), tbody: !!$("tbody"),
  status: !!$("status"), filterInput: !!$("q"), tableHeaders: document.querySelectorAll("thead th").length
});
