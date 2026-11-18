import http from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const HOST = "127.0.0.1";
const PORT = Number(process.env.MCP_BRIDGE_PORT || 3212);
const TOKEN = process.env.MCP_BRIDGE_TOKEN || "local-file-explorer-token";
const MAX_FILES = 5000;

function cors(req) {
  const origin = String(req.headers.origin || "");
  if (origin && !/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) return null;
  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Bridge-Token",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin"
  };
  if (origin) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}
function send(req, res, status, value) {
  const allowed = cors(req);
  if (!allowed) {
    res.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ error: "Origin not allowed." }));
  }
  const body = JSON.stringify(value);
  res.writeHead(status, {
    ...allowed,
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}
async function readJson(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  return body ? JSON.parse(body) : {};
}
function auth(req) {
  return req.headers["x-bridge-token"] === TOKEN;
}
function extractStructured(result) {
  if (result?._meta && typeof result._meta === "object") return result._meta;
  if (result?.structuredContent && typeof result.structuredContent === "object") return result.structuredContent;
  for (const item of result?.content || []) {
    if (item.type === "text" && typeof item.text === "string") {
      try { return JSON.parse(item.text); } catch {}
    }
  }
  return {};
}
function createTransport(rootPath) {
  const args = ["-y", "@j0hanz/filesystem-mcp@2.13.0", "--read-only", rootPath];
  // Spawn npx directly so Windows does not add extra quotes around the package name.
  return new StdioClientTransport({
    command: process.platform === "win32" ? "npx.cmd" : "npx",
    args,
    cwd: rootPath,
    env: { ...process.env }
  });
}
async function withClient(rootPath, action) {
  const client = new Client(
    { name: "local-file-explorer-bridge", version: "0.1.0" },
    { capabilities: {}, versionNegotiation: { mode: "auto" } }
  );
  const transport = createTransport(rootPath);
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    return await action(client, listed.tools || []);
  } finally {
    await client.close().catch(() => {});
  }
}
function toolArgs(schema, pairs) {
  const args = {};
  const props = schema?.properties || {};
  for (const [names, value] of pairs) {
    for (const name of names) {
      if (props[name]) { args[name] = value; break; }
    }
  }
  return args;
}
async function listFiles(rootPath, pattern) {
  return withClient(rootPath, async (client, tools) => {
    const find = tools.find(t => t.name === "find_files" || t.name === "find");
    if (!find) throw new Error("Filesystem MCP has no find_files tool. Tools: " + tools.map(t => t.name).join(", "));
    const findArgs = toolArgs(find.inputSchema, [
      [["pattern"], pattern || "**/*"],
      [["path", "root"], rootPath],
      [["maxResults", "max_results"], MAX_FILES],
      [["includeIgnored"], true]
    ]);
    console.log("find_files args", findArgs);
    const found = await client.callTool({ name: find.name, arguments: findArgs });
    if (found?.isError) {
      const msg = (found.content || []).map(i => i.text || "").join("\n");
      throw new Error("find_files failed: " + msg);
    }
    const data = extractStructured(found);
    const raw = data.results || data.files || data.matches || data.items || data.entries || [];
    const paths = raw.map(item => {
      if (typeof item === "string") return item;
      return item.path || item.filePath || item.file || item.name || "";
    }).filter(Boolean).slice(0, MAX_FILES);

    const files = paths.map(p => {
      const abs = path.isAbsolute(p) ? p : path.join(rootPath, p);
      return {
        name: path.basename(abs),
        path: path.relative(rootPath, abs) || path.basename(abs),
        size: 0,
        modified: 0,
        type: "file"
      };
    });
    console.log("found", files.length, "files");
    return { root: rootPath, count: files.length, files, debug: { tool: find.name, args: findArgs, rawKeys: Object.keys(data) } };
  });
}
function browseWindowsFolder() {
  const ps = `
    Add-Type -AssemblyName System.Windows.Forms
    $d = New-Object System.Windows.Forms.FolderBrowserDialog
    $d.Description = "Select a folder"
    if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $d.SelectedPath }
  `;
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-STA", "-Command", ps], { windowsHide: false });
    let out = "";
    child.stdout.setEncoding("utf8").on("data", c => out += c);
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve(out.trim()) : resolve(""));
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    const allowed = cors(req);
    if (!allowed) { res.writeHead(403); return res.end(); }
    res.writeHead(204, allowed);
    return res.end();
  }
  if (!cors(req)) return send(req, res, 403, { error: "Origin not allowed." });
  if (!auth(req)) return send(req, res, 401, { error: "Unauthorized." });
  try {
    const url = new URL(req.url, `http://${HOST}:${PORT}`);
    if (req.method === "GET" && url.pathname === "/api/health") {
      return send(req, res, 200, { ok: true, service: "local-file-explorer-bridge" });
    }
    if (req.method === "GET" && url.pathname === "/api/browse") {
      const selected = await browseWindowsFolder();
      return send(req, res, 200, { path: selected || null });
    }
    if (req.method === "POST" && url.pathname === "/api/list") {
      const input = await readJson(req);
      if (!input.rootPath) throw new Error("rootPath is required");
      return send(req, res, 200, await listFiles(input.rootPath, input.pattern || "**/*"));
    }
    return send(req, res, 404, { error: "Not found" });
  } catch (error) {
    return send(req, res, 500, { error: error?.message || String(error) });
  }
});
server.listen(PORT, HOST, () => {
  console.log(`Local file explorer bridge at http://${HOST}:${PORT}`);
  console.log("Uses @j0hanz/filesystem-mcp via npx (read-only).");
});
