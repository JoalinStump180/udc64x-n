Standalone JSON MCP Explorer v0.2.0
==================================

This is a standalone Chrome/Edge extension plus a separate local Node.js bridge.
It is NOT an AI Chat Logger add-on and does not use the logger's IndexedDB,
db.js, or explorer.js.

UI source basis
---------------
The layout and visual style were adapted from the latest Explorer HTML found
in the supplied Library: explorer(20261031-163405)-chatmeta.html. Logger-specific
controls and database dependencies were removed. The resulting extension has
its own manifest, background service worker, HTML, CSS, and JavaScript.

What it does
------------
1. Global search calls Filesystem MCP search_text, with **/*.json as the default
   file pattern.
2. The left thpane groups concise matching-line results by JSON filename.
3. Every matching line has a Jump button. The file heading also has an Open
   button.
4. One canonical file path creates at most one open document tab in the top
   banner. Jumping to another hit in that file reuses the same tab.
5. Each document tab has its own Global Hit previous/next controls and
   currhit/totalhit counter.
6. Each document tab also has its own KW2 search value, previous/next controls,
   and currkw2hit/totalkw2hit counter. The search is limited to currently
   rendered JSON tree nodes: the root and branches the user has expanded.
   It does not automatically expand collapsed branches. Expanding/collapsing
   recalculates the visible-node matches.
7. Switching document tabs preserves each document's tree expansion, global-hit
   position, local search keyword, and local-hit position in memory.
8. Global hit navigation maps MCP's source line/column to a JSON node using a
   source-position-aware JSON parser, expands its ancestors, scrolls to it, and
   highlights it.
9. File content is read through the Filesystem MCP read tool, not direct browser
   filesystem access. The bridge launches the MCP server in --read-only mode.

Requirements
------------
- Windows 10/11 (Browse uses Windows PowerShell FolderBrowserDialog).
- Node.js 24 or later. The current Filesystem MCP package requires Node 24+.
- Chrome or Microsoft Edge supporting Manifest V3 extensions.

Install the local bridge
------------------------
1. Extract this ZIP somewhere permanent, for example:
     D:\Tools\standalone-json-mcp-explorer-v0.2.0\

2. Open CMD and enter the bridge folder:
     cd /d D:\Tools\standalone-json-mcp-explorer-v0.2.0\bridge

3. Install dependencies:
     npm install

4. Start the bridge:
     npm start

5. Keep that terminal window open while using the extension. The bridge listens
   only on 127.0.0.1:3211.

Install the Chrome/Edge extension
---------------------------------
1. Open one of these pages:
     Chrome: edge://extensions/ or chrome://extensions/
     Edge:   edge://extensions/

2. Turn on Developer mode.
3. Click Load unpacked.
4. Select the "extension" folder inside the extracted package, NOT the package
   root and NOT the bridge folder.
5. Click the extension toolbar icon. It opens a full browser tab. Clicking the
   icon again focuses the existing Explorer tab if it is already open.

Use it
------
1. Start the bridge first (npm start).
2. Open the extension.
3. Enter a directory, or click Browse.
4. Enter a global search term. The default file pattern is **/*.json.
5. Click Search.
6. Results are grouped by JSON file in the left thpane. Click Open to open a
   document without selecting a hit, or Jump beside a matching line.
7. Each JSON file has one document tab. Use its Global Hit ◀/▶ controls to move
   among the current global-search hits in that document.
8. Expand JSON branches in the tree. Enter a KW2 term in the document toolbar.
   KW2 searches only the nodes currently rendered in that document's tree.
   Use its ◀/▶ controls to navigate local matches.

Bridge token
------------
The same local token is present in bridge/server.mjs and extension/explorer.js:
  17927e46d1da300120fb0c122f681870b8dfc64dcb057c3a
If you change it, update both files to the same value. The bridge binds to
127.0.0.1 and accepts browser requests only from Chromium extension origins.

Limits and caveats
------------------
- JSON files larger than 20 MiB are rejected by the bridge.
- Search is grep-style literal/RE2 regex search, not semantic or natural-language
  search. Regex follows RE2 limitations.
- The first version displays matching lines returned by search_text. A single
  returned line corresponds to one global hit; if several matches occur on one
  line, Filesystem MCP may report that line as one result.
- KW2 is case-insensitive literal substring matching over each currently
  rendered node's key/type/value preview. It is not a recursive whole-file
  search. Expand a branch to include its children in KW2's searchable scope.
- Open tabs and their per-tab state are kept in memory for the lifetime of the
  Explorer page. Closing a document tab discards that tab's state.
- Stop aborts the browser's request. The bridge/MCP child process may finish its
  in-progress operation before it exits.
- Node.js 24+ is required by the current package. The authoring environment used
  for static syntax checks had Node.js 22.16.0, so npm install and a live MCP
  search/read were NOT executed here. Please perform the first runtime test on
  your Windows machine.

Package layout
--------------
extension\manifest.json   Standalone Manifest V3 extension manifest
extension\background.js   Opens/focuses the full-page Explorer tab
extension\explorer.html   UI shell
extension\explorer.css    Styling adapted from the uploaded Explorer HTML
extension\explorer.js     Global search, per-file tabs, JSON tree, KW2 search
bridge\package.json       Node dependencies and start command
bridge\server.mjs         Local HTTP-to-MCP bridge
