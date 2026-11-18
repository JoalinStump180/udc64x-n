// Fetch Everything HTTP pages and collect name/path/size/modified into an array.
const EVERYTHING = "http://localhost:9090";
const PAGE = 32;

function parseEverythingHtml(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const rows = [];
  doc.querySelectorAll("tr.trdata1, tr.trdata2").forEach((tr) => {
    const nameA = tr.querySelector("td.file a");
    const pathA = tr.querySelector("td.pathdata a");
    const size = (tr.querySelector("td.sizedata") || {}).textContent || "";
    const modified = (tr.querySelector("td.modifieddata") || {}).textContent || "";
    if (!nameA) return;
    rows.push({
      name: nameA.textContent.trim(),
      path: pathA ? pathA.textContent.trim() : "",
      size: size.replace(/\s+/g, " ").trim(),
      modified: modified.replace(/\s+/g, " ").trim(),
      href: nameA.getAttribute("href") || ""
    });
  });
  const num = (doc.querySelector(".numresults") || {}).textContent || "";
  const m = num.match(/of\s+(\d+)/i);
  return { rows, total: m ? Number(m[1]) : rows.length };
}

async function fetchEverything(search, onPage) {
  const all = [];
  let offset = 0;
  let total = Infinity;
  while (offset < total) {
    const url = EVERYTHING + "/?search=" + encodeURIComponent(search) + "&offset=" + offset;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Everything HTTP " + res.status);
    const html = await res.text();
    const page = parseEverythingHtml(html);
    total = page.total;
    all.push(...page.rows);
    if (onPage) onPage(all, total);
    if (!page.rows.length) break;
    offset += PAGE;
  }
  return all;
}

// example:
// const files = await fetchEverything("v:\\downloads\\*.mp4");
