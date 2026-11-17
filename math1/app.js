const DB = "mathNoteTest";
const STORE = "notes";
const MAX = 40;
const $ = (id) => document.getElementById(id);

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: "title" });
        os.createIndex("byUpdated", "updatedAt");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function firstLine(text) {
  const line = String(text || "").split(/\r?\n/).find((s) => s.trim());
  return (line || "untitled").trim().slice(0, 120);
}

function renderMath(src) {
  const box = $("render");
  const frag = document.createDocumentFragment();
  const pushText = (s) => {
    if (!s) return;
    const p = document.createElement("p");
    p.textContent = s;
    frag.appendChild(p);
  };
  const re = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\$([^$\n]+?)\$/g;
  let last = 0;
  let m;
  const canMath = typeof katex !== "undefined" && katex && typeof katex.render === "function";
  while ((m = re.exec(src))) {
    pushText(src.slice(last, m.index));
    const tex = m[1] || m[2] || m[3] || m[4] || "";
    const display = Boolean(m[1] || m[2]);
    const span = document.createElement("span");
    if (!canMath) span.textContent = tex;
    else {
      try { katex.render(tex, span, { throwOnError: false, displayMode: display }); }
      catch (_) { span.textContent = tex; }
    }
    frag.appendChild(span);
    last = m.index + m[0].length;
  }
  pushText(src.slice(last));
  if (!frag.childNodes.length) pushText(src);
  box.replaceChildren(frag);
}

async function allNotes() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
    req.onsuccess = () => resolve((req.result || []).sort((a, b) => b.updatedAt - a.updatedAt));
    req.onerror = () => reject(req.error);
  });
}

async function paintHist(selectTitle) {
  const notes = await allNotes();
  const sel = $("hist");
  const opt = document.createElement("option");
  sel.replaceChildren(opt);
  opt.value = "";
  opt.textContent = "40 history";
  notes.slice(0, MAX).forEach(function (n) {
    const o = document.createElement("option");
    o.value = n.title;
    o.textContent = n.title;
    sel.appendChild(o);
  });
  if (selectTitle) sel.value = selectTitle;
}

async function save() {
  const text = $("src").value;
  const title = ($("title").value || firstLine(text)).trim();
  $("title").value = title;
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ title, text, updatedAt: Date.now() });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  const notes = await allNotes();
  if (notes.length > MAX) {
    const drop = notes.slice(MAX);
    const db2 = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db2.transaction(STORE, "readwrite");
      drop.forEach((n) => tx.objectStore(STORE).delete(n.title));
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }
  await paintHist(title);
}

$("renderBtn").addEventListener("click", () => renderMath($("src").value));
$("pdf").addEventListener("click", () => { renderMath($("src").value); window.print(); });
$("save").addEventListener("click", () => save().catch((err) => alert(String(err))));
$("hist").addEventListener("change", async () => {
  const title = $("hist").value;
  if (!title) return;
  const db = await openDb();
  const row = await new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).get(title);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  if (!row) return;
  $("title").value = row.title;
  $("src").value = row.text || "";
  renderMath(row.text || "");
});
paintHist();
