# MCP Configuration

Terminal can forward a Claude Code MCP configuration file to every AI run. Set `TERMINAL_MCP_CONFIG` to the JSON file path before starting the daemon. The daemon passes it to Claude as `--mcp-config <path>`.

Optional global tool filters can be provided with comma-separated env vars:

```bash
export TERMINAL_MCP_CONFIG=/home/user/.config/terminal/mcp.json
export TERMINAL_ALLOWED_TOOLS=Read,Edit,mcp__github__search
export TERMINAL_DISALLOWED_TOOLS=Bash
```

Example MCP config:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/user/project"]
    }
  }
}
```

The path is global daemon configuration today. Workspace-level editing is represented in the shared `Workspace` model and can be wired into the settings UI later.
