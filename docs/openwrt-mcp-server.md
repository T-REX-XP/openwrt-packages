# OpenWrt MCP Server (host-side)

[openwrt-mcp-server](https://github.com/T-REX-XP/openwrt-mcp-server/tree/main/packages/openwrt-mcp-server) is a **Model Context Protocol (MCP)** server that runs on your **Mac/PC** (Cursor, Claude Desktop, VS Code) and manages an ImmortalWrt router over **SSH**. It is **not** installed on the router itself.

## CM5 defaults

| Setting | Value |
|---------|--------|
| Router IP | `192.168.8.1` (CM5 LAN) |
| SSH user | `root` |
| SSH key | `~/.ssh/id_ed25519` (or set `OPENWRT_KEY_PATH`) |

## One-time setup

From this repo root:

```sh
./scripts/setup-openwrt-mcp.sh
```

This clones `tools/openwrt-mcp-server`, runs `npm ci && npm run build`, and writes `.cursor/mcp.json` with the CM5 LAN address.

Override router address or key:

```sh
OPENWRT_HOST=192.168.8.1 OPENWRT_KEY_PATH=~/.ssh/id_ed25519 ./scripts/setup-openwrt-mcp.sh
```

Restart Cursor (or reload MCP) after setup.

## Tools exposed (24)

SSH-backed MCP tools for ImmortalWrt **25.x** / **APK**:

- **System** — connection test, system info, logs, reboot
- **UCI** — get/set/delete/add, changes, commit with auto-rollback, revert, confirm
- **Network** — interfaces, Wi-Fi stations, ping, traceroute, DNS lookup
- **Firewall** — status, add port forward (firewall4/nftables)
- **Packages** — list/install/remove APK packages, update index, package info

See upstream [README](https://github.com/T-REX-XP/openwrt-mcp-server/blob/main/packages/openwrt-mcp-server/README.md) for full tool list and safety (UCI validation + rollback timer).

## Manual install (without script)

```sh
git clone --depth 1 https://github.com/T-REX-XP/openwrt-mcp-server.git tools/openwrt-mcp-server
cd tools/openwrt-mcp-server/packages/openwrt-mcp-server
npm ci && npm run build
node dist/bin/openwrt-mcp.js   # STDIO — for MCP clients only
```

## Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "openwrt": {
      "command": "node",
      "args": ["/absolute/path/to/openwrt-packages/tools/openwrt-mcp-server/packages/openwrt-mcp-server/dist/bin/openwrt-mcp.js"],
      "env": {
        "OPENWRT_HOST": "192.168.8.1",
        "OPENWRT_USER": "root",
        "OPENWRT_KEY_PATH": "/Users/you/.ssh/id_ed25519"
      }
    }
  }
}
```

## Requirements

- Node.js 20+ on the **host**
- SSH access to the router (`ssh root@192.168.8.1`)
- Router running ImmortalWrt 25.x with `apk` (not legacy opkg-only images)

## Update

```sh
cd tools/openwrt-mcp-server && git pull && cd packages/openwrt-mcp-server && npm ci && npm run build
```

Or re-run `./scripts/setup-openwrt-mcp.sh` (re-clones only if missing; run `git -C tools/openwrt-mcp-server pull` first for updates).
