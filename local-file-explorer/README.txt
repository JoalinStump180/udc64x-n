Local File Explorer (MCP)
=========================

Lists files in a local folder via @j0hanz/filesystem-mcp.

1. Bridge (Node 24+):
   cd bridge
   npm install
   npm start
   Listens on 127.0.0.1:3212

2. Extension:
   chrome://extensions -> Developer mode -> Load unpacked
   Select the extension folder.

3. Use:
   Browse (Windows folder dialog) or type a path, then List.
   Files come from the MCP find_files + stat tools (read-only).
