import http from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs/promises";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const HOST = "127.0.0.1";
const PORT = Number(process.env.MCP_BRIDGE_PORT || 3211);
const TOKEN = process.env.MCP_BRIDGE_TOKEN || "17927e46d1da300120fb0c122f681870b8dfc64dcb057c3a";
const MAX_BODY = 64 * 1024;
const MAX_RESULTS = 3000;
const MAX_JSON_BYTES = 20 * 1024 * 1024;

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
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > MAX_BODY) throw new Error("Request body too large.");
  }
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

function normalizeMatches(data, result) {
  const arr = Array.isArray(data.matches) ? data.matches
    : Array.isArray(data.results) ? data.results
    : Array.isArray(data.items) ? data.items : [];
  const matches = arr.map(match => ({
    filePath: String(match.filePath ?? match.path ?? match.file ?? match.uri ?? ""),
    line: Number(match.line ?? match.lineNumber ?? match.line_number ?? match.startLine ?? 1),
    column: Number.isFinite(Number(match.column ?? match.columnOffset ?? match.offset))
      ? Number(match.column ?? match.columnOffset ?? match.offset) : null,
    lineText: String(match.lineText ?? match.text ?? match.content ?? match.match ?? match.snippet ?? "")
  }));
  return {
    total: data.total ?? data.totalMatches ?? data.matchCount ?? matches.length,
    truncated: Boolean(data.truncated || data.hasMore || data.nextCursor),
    matches,
    warnings: Array.isArray(data.warnings) ? data.warnings : [],
    message: data.message ?? null,
    isError: Boolean(result?.isError)
  };
}

function setIfPresent(target, schema, names, value) {
  for (const name of names) {
    if (schema.properties?.[name]) target[name] = value;
  }
}

function createTransport(rootPath) {
  const args = ["-y", "@j0hanz/filesystem-mcp@2.13.0", "--read-only", "--max-file-size", String(MAX_JSON_BYTES), rootPath];
  if (process.platform === "win32") {
    // cmd.exe is needed to launch npx.cmd on Windows. The selected folder is
    // quoted as one argument; Windows paths cannot contain a double quote.
    const commandLine = `npx ${args.map(arg => /[\\s&()^]/.test(arg) ? `"${arg.replaceAll('"', '""')}"` : arg).join(" ")}`;
    return new StdioClientTransport({
      command: process.env.ComSpec || "cmd.exe",
      args: ["/d", "/s", "/c", commandLine],
      cwd: rootPath,
      env: { ...process.env }
    });
  }
  return new StdioClientTransport({
    command: "npx",
    args,
    cwd: rootPath,
    env: { ...process.env }
  });
}

async function withFilesystemClient(rootInput, action) {
  if (!rootInput) throw new Error("rootPath is required.");
  const rootPath = path.resolve(String(rootInput));
  const stat = await fs.stat(rootPath);
  if (!stat.isDirectory()) throw new Error("rootPath is not a directory.");

  const client = new Client(
    { name: "standalone-json-mcp-explorer", version: "0.2.0" },
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

async function runFilesystemSearch(input) {
  const searchPattern = String(input.searchPattern || "");
  if (!searchPattern.trim()) throw new Error("searchPattern is required.");
  return withFilesystemClient(input.rootPath, async (client, tools) => {
    const tool = tools.find(item => item.name === "search_text");
    if (!tool) throw new Error("Filesystem MCP does not expose search_text.");
    const schema = tool.inputSchema || { properties: {} };
    const args = {};
    setIfPresent(args, schema, ["searchPattern"], searchPattern);
    setIfPresent(args, schema, ["isRegex"], Boolean(input.isRegex));
    setIfPresent(args, schema, ["caseSensitive"], Boolean(input.caseSensitive));
    setIfPresent(args, schema, ["pattern"], String(input.pattern || "**/*.json"));
    setIfPresent(args, schema, ["maxResults"], Math.min(MAX_RESULTS, Math.max(1, Number(input.maxResults) || MAX_RESULTS)));
    setIfPresent(args, schema, ["context"], 0);
    const missing = (schema.required || []).filter(key => !(key in args));
    if (missing.length) throw new Error("Unsupported search_text schema; unmapped required fields: " + missing.join(", "));
    const result = await client.callTool({ name: "search_text", arguments: args });
    if (result?.isError) throw new Error((result.content || []).map(item => item.text || "").join("\n") || "Filesystem MCP search_text failed.");
    return normalizeMatches(extractStructured(result), result);
  });
}

async function validateJsonPath(rootInput, fileInput) {
  const rootPath = await fs.realpath(path.resolve(String(rootInput || "")));
  const supplied = String(fileInput || "");
  if (!supplied) throw new Error("filePath is required.");
  const candidate = path.isAbsolute(supplied) ? path.resolve(supplied) : path.resolve(rootPath, supplied);
  const realFile = await fs.realpath(candidate);
  const relative = path.relative(rootPath, realFile);
  if (!relative || relative.startsWith(".." + path.sep) || relative === ".." || path.isAbsolute(relative)) {
    throw new Error("The requested file is outside the selected directory.");
  }
  if (path.extname(realFile).toLowerCase() !== ".json") throw new Error("Only .json files can be opened in this viewer.");
  const stat = await fs.stat(realFile);
  if (!stat.isFile()) throw new Error("The requested path is not a file.");
  if (stat.size > MAX_JSON_BYTES) throw new Error(`JSON file is too large (${stat.size} bytes). Limit: ${MAX_JSON_BYTES} bytes.`);
  return relative.split(path.sep).join("/");
}

async function readJsonThroughMcp(input) {
  const relativePath = await validateJsonPath(input.rootPath, input.filePath);
  return withFilesystemClient(input.rootPath, async (client, tools) => {
    const tool = tools.find(item => item.name === "read");
    if (!tool) throw new Error("Filesystem MCP does not expose read.");
    const result = await client.callTool({ name: "read", arguments: { path: relativePath } });
    if (result?.isError) throw new Error((result.content || []).map(item => item.text || "").join("\n") || "Filesystem MCP read failed.");
    const textBlocks = (result.content || []).filter(item => item.type === "text" && typeof item.text === "string");
    if (!textBlocks.length) throw new Error("Filesystem MCP read returned no text content.");
    const content = textBlocks.map(item => item.text).join("\n");
    if (Buffer.byteLength(content, "utf8") > MAX_JSON_BYTES) throw new Error("Returned JSON content exceeds the viewer size limit.");
    return { filePath: relativePath, content };
  });
}

function browseWindowsFolder() {
  return new Promise((resolve, reject) => {
    if (process.platform !== "win32") return reject(new Error("Browse is currently implemented for Windows only."));
    const ps = [
      "[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding; Add-Type -AssemblyName System.Windows.Forms;",
      "$d = New-Object System.Windows.Forms.FolderBrowserDialog;",
      "$d.Description = 'Select the folder to search';",
      "$d.ShowNewFolderButton = $false;",
      "if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Write($d.SelectedPath) }"
    ].join(" ");
    const child = spawn("powershell.exe", ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-Command", ps], {
      windowsHide: false, stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "", errorOutput = "";
    child.stdout.setEncoding("utf8").on("data", chunk => output += chunk);
    child.stderr.setEncoding("utf8").on("data", chunk => errorOutput += chunk);
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve(output.trim()) : reject(new Error(errorOutput || `Folder picker exited with code ${code}.`)));
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    const allowed = cors(req);
    if (!allowed) {
      res.writeHead(403);
      return res.end();
    }
    res.writeHead(204, allowed);
    return res.end();
  }
  if (!cors(req)) return send(req, res, 403, { error: "Origin not allowed." });
  if (!auth(req)) return send(req, res, 401, { error: "Unauthorized: missing or invalid bridge token." });

  try {
    const url = new URL(req.url, `http://${HOST}:${PORT}`);
    if (req.method === "GET" && url.pathname === "/api/health") {
      return send(req, res, 200, { ok: true, service: "standalone-json-mcp-explorer-bridge", version: "0.2.0" });
    }
    if (req.method === "GET" && url.pathname === "/api/browse") {
      const selected = await browseWindowsFolder();
      return send(req, res, 200, { path: selected || null, cancelled: !selected });
    }
    if (req.method === "POST" && url.pathname === "/api/search") {
      const input = await readJson(req);
      if (input.provider !== "filesystem") throw new Error("Unknown provider: " + input.provider);
      return send(req, res, 200, await runFilesystemSearch(input));
    }
    if (req.method === "POST" && url.pathname === "/api/read") {
      const input = await readJson(req);
      return send(req, res, 200, await readJsonThroughMcp(input));
    }
    return send(req, res, 404, { error: "Not found." });
  } catch (error) {
    return send(req, res, 500, { error: error?.message || String(error) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Standalone JSON MCP bridge listening at http://${HOST}:${PORT}`);
  console.log("Bridge token:", TOKEN);
  console.log("MCP server starts on demand in read-only mode for each search/read request.");
});
