(() => {
  "use strict";

  const BRIDGE = "http://127.0.0.1:3211";
  const BRIDGE_TOKEN = "17927e46d1da300120fb0c122f681870b8dfc64dcb057c3a";
  const $ = id => document.getElementById(id);

  const rootBox = $("rootPath");
  const queryBox = $("globalQuery");
  const patternBox = $("filePattern");
  const regexBox = $("globalRegex");
  const caseBox = $("globalCase");
  const resultsBox = $("globalResults");
  const tabsBox = $("documentTabs");
  const treeBox = $("jsonTree");

  let searchController = null;
  let globalGroups = [];
  const openDocs = new Map();
  let activeDocKey = "";

  function setStatus(text) { $("statusBar").textContent = String(text || ""); }
  function setGlobalStatus(text) { $("globalStatus").textContent = String(text || ""); }
  function canonicalPath(value) {
    return String(value || "").replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
  }
  function basename(value) {
    const parts = String(value || "").replaceAll("\\", "/").split("/");
    return parts[parts.length - 1] || value || "(unknown JSON)";
  }
  function hitKey(hit) { return `${hit.line ?? ""}|${hit.column ?? ""}|${hit.lineText || ""}`; }

  async function bridgeFetch(route, options = {}) {
    const headers = Object.assign({}, options.headers || {}, { "X-Bridge-Token": BRIDGE_TOKEN });
    const response = await fetch(BRIDGE + route, Object.assign({}, options, { headers }));
    let data;
    try { data = await response.json(); }
    catch { throw new Error(`Bridge returned non-JSON response (HTTP ${response.status}).`); }
    if (!response.ok) throw new Error(data.error || `Bridge HTTP ${response.status}`);
    return data;
  }

  function setBridgeState(online, message) {
    const el = $("bridgeStatus");
    el.textContent = message;
    el.classList.toggle("online", !!online);
  }

  async function checkBridge() {
    try {
      await bridgeFetch("/api/health");
      setBridgeState(true, "Local MCP bridge connected");
      setStatus("Bridge ready. Node.js bridge must remain running while this extension is used.");
    } catch (error) {
      setBridgeState(false, "Local MCP bridge offline");
      setStatus("Cannot reach localhost:3211. Start the bridge with `npm start`. " + error.message);
    }
  }

  function addEmpty(parent, text) {
    const div = document.createElement("div");
    div.className = "empty-state";
    div.textContent = text;
    parent.replaceChildren(div);
  }

  function groupMatches(matches) {
    const map = new Map();
    for (const raw of matches || []) {
      const filePath = String(raw.filePath || raw.path || "");
      if (!filePath || !filePath.toLowerCase().endsWith(".json")) continue;
      const key = canonicalPath(filePath);
      if (!map.has(key)) map.set(key, { key, filePath, hits: [] });
      map.get(key).hits.push({
        filePath,
        line: Number(raw.line) || 1,
        column: Number.isFinite(Number(raw.column)) ? Number(raw.column) : null,
        lineText: String(raw.lineText || raw.text || "")
      });
    }
    return Array.from(map.values());
  }

  function renderGlobalResults() {
    resultsBox.replaceChildren();
    const totalHits = globalGroups.reduce((sum, group) => sum + group.hits.length, 0);
    $("resultSummary").textContent = `${globalGroups.length} files · ${totalHits} hits`;
    if (!globalGroups.length) {
      addEmpty(resultsBox, "No JSON matches. Check the directory, search term, and **/*.json file pattern.");
      return;
    }

    for (const group of globalGroups) {
      const section = document.createElement("section");
      section.className = "result-file";

      const head = document.createElement("div");
      head.className = "result-file-head";
      const name = document.createElement("strong");
      name.textContent = basename(group.filePath);
      name.title = group.filePath;
      const count = document.createElement("small");
      count.textContent = `${group.hits.length} hit${group.hits.length === 1 ? "" : "s"}`;
      const open = document.createElement("button");
      open.type = "button";
      open.className = "open-file-btn";
      open.textContent = "Open";
      open.addEventListener("click", () => openDocument(group.filePath, null));
      head.append(name, count, open);

      const path = document.createElement("div");
      path.className = "result-file-path";
      path.textContent = group.filePath;
      section.append(head, path);

      group.hits.forEach((hit, index) => {
        const row = document.createElement("div");
        row.className = "result-hit";
        const content = document.createElement("div");
        content.className = "result-hit-text";
        const meta = document.createElement("div");
        meta.className = "result-hit-meta";
        meta.textContent = `Hit ${index + 1} · line ${hit.line}${hit.column == null ? "" : ` · col ${hit.column}`}`;
        const snippet = document.createElement("div");
        snippet.className = "result-hit-snippet";
        snippet.textContent = hit.lineText;
        content.append(meta, snippet);
        const jump = document.createElement("button");
        jump.type = "button";
        jump.className = "jump-btn";
        jump.textContent = "Jump";
        jump.title = "Open this JSON document if needed, then jump to this hit";
        jump.addEventListener("click", () => openDocument(group.filePath, hit));
        row.append(content, jump);
        section.appendChild(row);
      });
      resultsBox.appendChild(section);
    }
  }

  function updateOpenDocumentsWithGlobalResults() {
    const byKey = new Map(globalGroups.map(group => [group.key, group]));
    for (const [key, doc] of openDocs) {
      const nextHits = byKey.get(key)?.hits || [];
      const oldCurrent = doc.globalHits[doc.globalHitIndex];
      const oldKey = oldCurrent ? hitKey(oldCurrent) : "";
      doc.globalHits = nextHits.slice();
      const retained = oldKey ? doc.globalHits.findIndex(hit => hitKey(hit) === oldKey) : -1;
      doc.globalHitIndex = retained;
      doc.globalCurrentPath = "";
      if (activeDocKey === key) renderDocumentToolbar(doc);
    }
  }

  async function runGlobalSearch() {
    const rootPath = rootBox.value.trim();
    const searchPattern = queryBox.value;
    if (!rootPath) { setGlobalStatus("Enter a directory first."); rootBox.focus(); return; }
    if (!searchPattern.trim()) { setGlobalStatus("Enter a global search term."); queryBox.focus(); return; }

    if (searchController) searchController.abort();
    const controller = new AbortController();
    searchController = controller;
    $("searchBtn").disabled = true;
    $("stopBtn").disabled = false;
    addEmpty(resultsBox, "Searching JSON files through Filesystem MCP…");
    setGlobalStatus("Searching…");
    setStatus("Calling search_text through the local MCP bridge.");

    try {
      const data = await bridgeFetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "filesystem",
          rootPath,
          searchPattern,
          isRegex: regexBox.checked,
          caseSensitive: caseBox.checked,
          pattern: patternBox.value.trim() || "**/*.json",
          maxResults: 3000
        }),
        signal: controller.signal
      });
      globalGroups = groupMatches(data.matches);
      renderGlobalResults();
      updateOpenDocumentsWithGlobalResults();
      const hitCount = globalGroups.reduce((sum, group) => sum + group.hits.length, 0);
      const warningText = Array.isArray(data.warnings) && data.warnings.length ? ` · ${data.warnings.join("; ")}` : "";
      setGlobalStatus(`${globalGroups.length} JSON files · ${hitCount} matching lines${data.truncated ? " · result limit reached" : ""}${warningText}`);
      setStatus(`Global search complete: ${hitCount} matching lines in ${globalGroups.length} JSON files.`);
      try { await chrome.storage.local.set({ lastRootPath: rootPath, lastPattern: patternBox.value }); } catch (_) {}
    } catch (error) {
      if (error.name === "AbortError") {
        setGlobalStatus("Search cancelled.");
        addEmpty(resultsBox, "Search request cancelled. The local MCP operation may finish in the bridge.");
      } else {
        setGlobalStatus("Global search failed.");
        addEmpty(resultsBox, error.message);
        setStatus("Search failed: " + error.message);
      }
    } finally {
      if (searchController === controller) {
        searchController = null;
        $("searchBtn").disabled = false;
        $("stopBtn").disabled = true;
      }
    }
  }

  // Parse JSON while retaining source offsets, so a grep line/column can map
  // back to a concrete node in the navigable JSON tree.
  function parseJsonWithRanges(source) {
    const hadBom = source.charCodeAt(0) === 0xFEFF;
    if (hadBom) source = source.slice(1);
    JSON.parse(source); // Validate the complete document before building source ranges.
    let i = 0;
    const lineStarts = [0];
    for (let p = 0; p < source.length; p++) if (source[p] === "\n") lineStarts.push(p + 1);

    function lineAt(offset) {
      let lo = 0, hi = lineStarts.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (lineStarts[mid] <= offset) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    }
    function ws() { while (i < source.length && /\s/.test(source[i])) i++; }
    function parseStringToken() {
      const start = i;
      if (source[i] !== '"') throw new Error(`Expected JSON string at character ${i}.`);
      i++;
      let escaped = false;
      while (i < source.length) {
        const ch = source[i++];
        if (escaped) { escaped = false; continue; }
        if (ch === "\\") { escaped = true; continue; }
        if (ch === '"') break;
      }
      if (source[i - 1] !== '"') throw new Error("Unterminated JSON string.");
      return { value: JSON.parse(source.slice(start, i)), start, end: i };
    }
    function childPath(parent, key, isIndex) {
      if (isIndex) return `${parent}[${key}]`;
      return /^[A-Za-z_$][\w$]*$/.test(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`;
    }
    function parseValue(path, keyToken = null) {
      ws();
      const start = i;
      let type, value, children = [];
      if (source[i] === "{") {
        type = "object"; i++; ws();
        if (source[i] === "}") i++;
        else {
          while (i < source.length) {
            ws();
            const key = parseStringToken();
            ws();
            if (source[i] !== ":") throw new Error(`Expected ':' after object key at character ${i}.`);
            i++; ws();
            const child = parseValue(childPath(path, key.value, false), key);
            children.push(child);
            ws();
            if (source[i] === "}") { i++; break; }
            if (source[i] !== ",") throw new Error(`Expected ',' or '}' at character ${i}.`);
            i++;
          }
        }
        value = null;
      } else if (source[i] === "[") {
        type = "array"; i++; ws();
        if (source[i] === "]") i++;
        else {
          let index = 0;
          while (i < source.length) {
            children.push(parseValue(childPath(path, index, true), null));
            index++; ws();
            if (source[i] === "]") { i++; break; }
            if (source[i] !== ",") throw new Error(`Expected ',' or ']' at character ${i}.`);
            i++;
          }
        }
        value = null;
      } else if (source[i] === '"') {
        type = "string";
        const token = parseStringToken();
        value = token.value;
      } else {
        const tokenStart = i;
        while (i < source.length && !/[\s,}\]]/.test(source[i])) i++;
        if (tokenStart === i) throw new Error(`Unexpected token at character ${i}.`);
        const raw = source.slice(tokenStart, i);
        value = JSON.parse(raw);
        type = value === null ? "null" : typeof value;
      }
      const end = i;
      return {
        path, key: keyToken ? keyToken.value : null, keyStart: keyToken ? keyToken.start : null,
        keyEnd: keyToken ? keyToken.end : null, type, value, children,
        start, end, startLine: lineAt(start), endLine: lineAt(Math.max(start, end - 1))
      };
    }

    const root = parseValue("$");
    ws();
    if (i !== source.length) throw new Error(`Unexpected trailing content at character ${i}.`);
    const allNodes = [];
    (function visit(node) { allNodes.push(node); node.children.forEach(visit); })(root);
    return { root, allNodes, lineStarts, lineAt, hadBom };
  }

  function findNodeForHit(parsed, hit) {
    const line = Math.max(1, Number(hit.line) || 1);
    const lineStart = parsed.lineStarts[line - 1] ?? 0;
    const bomAdjust = parsed.hadBom && line === 1 ? 1 : 0;
    const offset = hit.column == null ? null : lineStart + Math.max(0, hit.column - bomAdjust);
    let candidates;
    if (offset != null) {
      candidates = parsed.allNodes.filter(node =>
        (node.keyStart != null && offset >= node.keyStart && offset < node.keyEnd) ||
        (offset >= node.start && offset < node.end)
      );
    }
    if (!candidates || !candidates.length) {
      candidates = parsed.allNodes.filter(node => node.startLine <= line && node.endLine >= line);
    }
    candidates.sort((a, b) => {
      const aSpan = a.end - a.start, bSpan = b.end - b.start;
      if (aSpan !== bSpan) return aSpan - bSpan;
      const aLeaf = a.children.length === 0 ? 0 : 1;
      const bLeaf = b.children.length === 0 ? 0 : 1;
      return aLeaf - bLeaf;
    });
    return candidates[0] || parsed.root;
  }

  function nodePreview(node) {
    if (node.type === "object") return `{ object · ${node.children.length} ${node.children.length === 1 ? "key" : "keys"} }`;
    if (node.type === "array") return `[ array · ${node.children.length} ${node.children.length === 1 ? "item" : "items"} ]`;
    if (node.type === "string") {
      const s = JSON.stringify(node.value);
      return s.length > 180 ? s.slice(0, 177) + "…\"" : s;
    }
    return String(node.value);
  }

  function makeNodeElement(node, doc) {
    const wrap = document.createElement("div");
    wrap.className = "json-node";
    wrap.dataset.path = node.path;
    wrap.dataset.startLine = String(node.startLine);
    wrap.dataset.endLine = String(node.endLine);

    const head = document.createElement("div");
    head.className = "json-node-head";
    head.dataset.path = node.path;

    const expandable = node.children.length > 0;
    const expanded = doc.expandedPaths.has(node.path);
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = expandable ? "json-toggle" : "json-toggle spacer";
    toggle.textContent = expandable ? (expanded ? "−" : "+") : "·";
    toggle.disabled = !expandable;
    toggle.dataset.action = "toggle-node";
    toggle.dataset.path = node.path;

    const key = document.createElement("span");
    key.className = node.path === "$" ? "json-key json-root-label" : "json-key";
    key.textContent = node.path === "$" ? "$" : `${JSON.stringify(node.key)}:`;

    const type = document.createElement("span");
    type.className = "json-type";
    type.textContent = node.type;

    const preview = document.createElement("span");
    preview.className = `json-preview ${node.type}`;
    preview.textContent = nodePreview(node);

    head.append(toggle, key, type, preview);
    wrap.appendChild(head);

    if (expandable && expanded) {
      const kids = document.createElement("div");
      kids.className = "json-kids";
      node.children.forEach(child => kids.appendChild(makeNodeElement(child, doc)));
      wrap.appendChild(kids);
    }
    return wrap;
  }

  function renderTree(doc, preserveLocalPath = "") {
    treeBox.replaceChildren();
    treeBox.appendChild(makeNodeElement(doc.parsed.root, doc));
    updateLocalSearch(doc, preserveLocalPath);
    if (doc.globalCurrentPath) paintGlobalCurrent(doc);
  }

  function paintGlobalCurrent(doc) {
    treeBox.querySelectorAll(".json-node-head.global-current").forEach(el => el.classList.remove("global-current"));
    if (!doc.globalCurrentPath) return;
    const head = Array.from(treeBox.querySelectorAll(".json-node-head")).find(el => el.dataset.path === doc.globalCurrentPath);
    if (head) head.classList.add("global-current");
  }

  function paintLocalCurrent(doc) {
    treeBox.querySelectorAll(".json-node-head.local-current").forEach(el => el.classList.remove("local-current"));
    const path = doc.localMatches[doc.localHitIndex];
    if (!path) return;
    const head = Array.from(treeBox.querySelectorAll(".json-node-head")).find(el => el.dataset.path === path);
    if (head) head.classList.add("local-current");
  }

  function updateLocalSearch(doc, preservePath = "") {
    const query = String(doc.localQuery || "").trim().toLocaleLowerCase();
    const rows = Array.from(treeBox.querySelectorAll(".json-node-head"));
    const matches = query ? rows.filter(row => row.textContent.toLocaleLowerCase().includes(query)).map(row => row.dataset.path) : [];
    doc.localMatches = matches;
    if (!matches.length) doc.localHitIndex = -1;
    else if (preservePath && matches.includes(preservePath)) doc.localHitIndex = matches.indexOf(preservePath);
    else doc.localHitIndex = 0;
    renderDocumentToolbar(doc);
    paintLocalCurrent(doc);
  }

  function renderDocumentToolbar(doc) {
    $("globalHitCounter").textContent = `${doc.globalHitIndex >= 0 ? doc.globalHitIndex + 1 : 0} / ${doc.globalHits.length}`;
    $("localHitCounter").textContent = `${doc.localHitIndex >= 0 ? doc.localHitIndex + 1 : 0} / ${doc.localMatches.length}`;
    $("prevGlobalHit").disabled = !doc.globalHits.length;
    $("nextGlobalHit").disabled = !doc.globalHits.length;
    $("prevLocalHit").disabled = !doc.localMatches.length;
    $("nextLocalHit").disabled = !doc.localMatches.length;
  }

  function renderTabs() {
    tabsBox.replaceChildren();
    if (!openDocs.size) {
      const empty = document.createElement("span");
      empty.className = "tabs-empty";
      empty.textContent = "No JSON documents open";
      tabsBox.appendChild(empty);
      return;
    }
    for (const [key, doc] of openDocs) {
      const tab = document.createElement("div");
      tab.className = "doc-tab" + (key === activeDocKey ? " active" : "");
      tab.dataset.key = key;
      const name = document.createElement("span");
      name.className = "doc-tab-name";
      name.textContent = basename(doc.filePath);
      name.title = doc.filePath;
      const close = document.createElement("button");
      close.type = "button";
      close.className = "doc-tab-close";
      close.dataset.action = "close-tab";
      close.dataset.key = key;
      close.textContent = "×";
      close.title = "Close document tab";
      tab.append(name, close);
      tab.addEventListener("click", event => {
        if (event.target.closest("[data-action='close-tab']")) return;
        activateDocument(key);
      });
      tabsBox.appendChild(tab);
    }
  }

  function activateDocument(key) {
    if (!openDocs.has(key)) return;
    activeDocKey = key;
    const doc = openDocs.get(key);
    $("noDocument").hidden = true;
    $("documentView").hidden = false;
    $("activeDocumentName").textContent = basename(doc.filePath);
    $("activeDocumentPath").textContent = doc.filePath;
    $("localQuery").value = doc.localQuery;
    $("documentMessage").textContent = doc.parseMessage || `${doc.parsed.allNodes.length} JSON nodes · ${doc.source.split(/\r\n|\n|\r/).length} source lines`;
    renderTree(doc, doc.localMatches[doc.localHitIndex] || "");
    renderTabs();
    renderDocumentToolbar(doc);
    setStatus(`Active document: ${doc.filePath}`);
  }

  async function openDocument(filePath, hit) {
    const key = canonicalPath(filePath);
    if (openDocs.has(key)) {
      activateDocument(key);
      if (hit) navigateGlobalHit(openDocs.get(key), hit);
      return;
    }

    setStatus(`Reading ${filePath} through Filesystem MCP…`);
    try {
      const data = await bridgeFetch("/api/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rootPath: rootBox.value.trim(), filePath })
      });
      const source = String(data.content ?? "");
      const parsed = parseJsonWithRanges(source);
      attachParents(parsed.root);
      const group = globalGroups.find(item => item.key === key);
      const doc = {
        key, filePath, source, parsed,
        globalHits: group ? group.hits.slice() : [],
        globalHitIndex: -1,
        globalCurrentPath: "",
        localQuery: "",
        localMatches: [],
        localHitIndex: -1,
        expandedPaths: new Set(["$"]),
        parseMessage: ""
      };
      openDocs.set(key, doc);
      activateDocument(key);
      if (hit) navigateGlobalHit(doc, hit);
      else setStatus(`Opened ${filePath}. Expand JSON branches to inspect their contents.`);
    } catch (error) {
      setStatus(`Could not open ${filePath}: ${error.message}`);
    }
  }

  function navigateGlobalHit(doc, hitOrIndex) {
    if (!doc.globalHits.length) return;
    let index;
    if (typeof hitOrIndex === "number") index = hitOrIndex;
    else {
      const wanted = hitKey(hitOrIndex);
      index = doc.globalHits.findIndex(hit => hitKey(hit) === wanted);
      if (index < 0) index = doc.globalHits.findIndex(hit => hit.line === hitOrIndex.line && hit.lineText === hitOrIndex.lineText);
      if (index < 0) return;
    }
    index = (index + doc.globalHits.length) % doc.globalHits.length;
    doc.globalHitIndex = index;
    const hit = doc.globalHits[index];
    const target = findNodeForHit(doc.parsed, hit);
    const ancestors = [];
    for (let node = target; node; node = node.parent) ancestors.push(node.path);
    // The parsed nodes are immutable apart from this parent link, assigned below.
    ancestors.forEach(path => doc.expandedPaths.add(path));
    doc.globalCurrentPath = target.path;
    if (activeDocKey !== doc.key) activateDocument(doc.key);
    else renderTree(doc, doc.localMatches[doc.localHitIndex] || "");
    const row = Array.from(treeBox.querySelectorAll(".json-node-head")).find(el => el.dataset.path === target.path);
    if (row) row.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
    renderDocumentToolbar(doc);
    setStatus(`Global hit ${index + 1}/${doc.globalHits.length} · line ${hit.line} · ${target.path}`);
  }

  function navigateLocalHit(doc, delta) {
    if (!doc.localMatches.length) return;
    let next = doc.localHitIndex;
    if (next < 0) next = delta > 0 ? 0 : doc.localMatches.length - 1;
    else next = (next + delta + doc.localMatches.length) % doc.localMatches.length;
    doc.localHitIndex = next;
    paintLocalCurrent(doc);
    const path = doc.localMatches[next];
    const row = Array.from(treeBox.querySelectorAll(".json-node-head")).find(el => el.dataset.path === path);
    if (row) row.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
    renderDocumentToolbar(doc);
    setStatus(`KW2 hit ${next + 1}/${doc.localMatches.length} · ${path}`);
  }

  // Attach parent links after parsing. Kept out of JSON values to avoid cycles in rendering.
  function attachParents(node, parent = null) {
    node.parent = parent;
    node.children.forEach(child => attachParents(child, node));
  }

  treeBox.addEventListener("click", event => {
    const toggle = event.target.closest("button[data-action='toggle-node']");
    if (!toggle || !activeDocKey) return;
    const doc = openDocs.get(activeDocKey);
    const path = toggle.dataset.path;
    const currentLocalPath = doc.localMatches[doc.localHitIndex] || "";
    if (doc.expandedPaths.has(path)) doc.expandedPaths.delete(path);
    else doc.expandedPaths.add(path);
    renderTree(doc, currentLocalPath);
    setStatus(`Tree ${doc.expandedPaths.has(path) ? "expanded" : "collapsed"}: ${path}`);
  });

  tabsBox.addEventListener("click", event => {
    const close = event.target.closest("[data-action='close-tab']");
    if (!close) return;
    event.stopPropagation();
    const key = close.dataset.key;
    openDocs.delete(key);
    if (activeDocKey === key) {
      activeDocKey = "";
      const remaining = Array.from(openDocs.keys());
      if (remaining.length) activateDocument(remaining[remaining.length - 1]);
      else {
        $("documentView").hidden = true;
        $("noDocument").hidden = false;
        renderTabs();
      }
    } else renderTabs();
    setStatus(`Closed ${basename(key)}.`);
  });

  $("prevGlobalHit").addEventListener("click", () => {
    const doc = openDocs.get(activeDocKey);
    if (doc) navigateGlobalHit(doc, doc.globalHitIndex < 0 ? doc.globalHits.length - 1 : doc.globalHitIndex - 1);
  });
  $("nextGlobalHit").addEventListener("click", () => {
    const doc = openDocs.get(activeDocKey);
    if (doc) navigateGlobalHit(doc, doc.globalHitIndex < 0 ? 0 : doc.globalHitIndex + 1);
  });
  $("prevLocalHit").addEventListener("click", () => {
    const doc = openDocs.get(activeDocKey);
    if (doc) navigateLocalHit(doc, -1);
  });
  $("nextLocalHit").addEventListener("click", () => {
    const doc = openDocs.get(activeDocKey);
    if (doc) navigateLocalHit(doc, 1);
  });
  $("localQuery").addEventListener("input", () => {
    const doc = openDocs.get(activeDocKey);
    if (!doc) return;
    doc.localQuery = $("localQuery").value;
    doc.localHitIndex = -1;
    updateLocalSearch(doc);
    if (doc.localMatches.length) navigateLocalHit(doc, 0);
    else setStatus("KW2: no match among currently rendered/expanded JSON nodes.");
  });
  $("localQuery").addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      const doc = openDocs.get(activeDocKey);
      if (doc) navigateLocalHit(doc, event.shiftKey ? -1 : 1);
    }
  });

  $("searchBtn").addEventListener("click", runGlobalSearch);
  queryBox.addEventListener("keydown", event => { if (event.key === "Enter") runGlobalSearch(); });
  $("stopBtn").addEventListener("click", () => searchController?.abort());
  $("browseBtn").addEventListener("click", async () => {
    try {
      const data = await bridgeFetch("/api/browse");
      if (data.path) rootBox.value = data.path;
      setStatus(data.path ? `Directory selected: ${data.path}` : "Folder selection cancelled.");
    } catch (error) { setStatus("Browse failed: " + error.message); }
  });

  (async function init() {
    try {
      const saved = await chrome.storage.local.get(["lastRootPath", "lastPattern"]);
      if (saved.lastRootPath) rootBox.value = saved.lastRootPath;
      if (saved.lastPattern) patternBox.value = saved.lastPattern;
    } catch (_) {}
    await checkBridge();
  })();

  // Expose a tiny test hook for the standalone parser, not application state.
  window.JsonMcpExplorerTest = { parseJsonWithRanges, findNodeForHit };
})();
