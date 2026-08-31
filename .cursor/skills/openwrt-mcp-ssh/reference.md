# OpenWrt MCP tool reference

Namespace: **`user-openwrt`** (Cursor). Server env from `.cursor/mcp.json` (`OPENWRT_HOST`, `OPENWRT_KEY_PATH`, `OPENWRT_TIMEOUT_MS`).

Discover at runtime: `GetDynamicTools {"namespace":"user-openwrt"}`.

## System

| Tool | Args | Notes |
|------|------|-------|
| `openwrt_test_connection` | — | Run first; confirms SSH + MCP transport |
| `openwrt_get_system_info` | — | Board, uptime, memory, version |
| `openwrt_get_logs` | optional filter/lines | `logread`-style |
| `openwrt_reboot` | — | **Destructive** — ask user unless they requested reboot |

## UCI

| Tool | Args | Notes |
|------|------|-------|
| `openwrt_uci_get` | `path` | e.g. `network.lan.ipaddr` |
| `openwrt_uci_set` | `path`, `value` | Staged until commit |
| `openwrt_uci_delete` | `path` | Section or option |
| `openwrt_uci_add` | `package`, `type` | Anonymous section |
| `openwrt_uci_changes` | optional `package` | Pending diff |
| `openwrt_uci_commit` | `package`, optional `safety`, `timeoutSeconds` | Default safety rollback |
| `openwrt_uci_confirm` | `sessionId` | After successful verify |
| `openwrt_uci_revert` | `package` | Drop unstaged |

Path format: `package.section.option` (no leading `/etc/config/`).

Common CM5 paths:

```text
network.lan.ipaddr          → 192.168.8.1
network.wan.device          → eth0
mcud.@main[0].device        → /dev/ttyS2
mcud.@main[0].enabled       → 1
blocky.main.enabled         → 1
dhcp.@dnsmasq[0].server     → 127.0.0.1#5353 (when blocky forwarded)
```

## Network

| Tool | Args |
|------|------|
| `openwrt_list_interfaces` | — |
| `openwrt_get_wifi_stations` | optional interface |
| `openwrt_ping` | `target`, optional `count` (1–10) |
| `openwrt_traceroute` | `target` |
| `openwrt_dns_lookup` | hostname |

## Firewall

| Tool | Args |
|------|------|
| `openwrt_get_firewall_status` | — |
| `openwrt_add_port_forward` | name, proto, ext/port, int/port, optional target |

Uses firewall4 / nftables on ImmortalWrt 25.x.

## Packages (APK)

| Tool | Args |
|------|------|
| `openwrt_list_packages` | optional pattern |
| `openwrt_package_info` | `package` |
| `openwrt_update_package_index` | — |
| `openwrt_install_package` | `packages[]`, optional `simulate` |
| `openwrt_remove_package` | `packages[]`, optional `simulate` |

## Not covered by MCP — use SSH

| Task | SSH command |
|------|-------------|
| mcudd binary deploy | `GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -o mcudd-linux-arm64 ./cmd/mcudd` then `scp` to `/usr/sbin/mcudd` (`feeds/packages/mcudd`) |
| RDCP link test | `ssh root@HOST /usr/lib/mcud/mcud-link-test.sh` |
| Read link JSON | `ssh root@HOST cat /tmp/mcud_link_test.json` |
| Blocky HTTP body | `ssh root@HOST wget -qO- http://127.0.0.1:4000/api/…` |
| I2C scan | `ssh root@HOST i2cdetect -y 7` |
| gpiod / sysfs | `ssh root@HOST gpioinfo` or direct sysfs |
| Kernel dmesg tail | `ssh root@HOST dmesg \| tail` |
| Init script not in procd | `ssh root@HOST /etc/init.d/SERVICE status` |

## Troubleshooting MCP

| Symptom | Fix |
|---------|-----|
| Namespace missing | Run `./scripts/setup-openwrt-mcp.sh`; restart Cursor |
| Connection timeout | Ping `192.168.8.1`; check LAN cable/Wi-Fi; verify key `ssh -i KEY root@HOST` |
| `Permission denied (publickey)` | Copy pubkey to router or set `OPENWRT_KEY_PATH` |
| Tool call fails mid-session | Re-run `openwrt_test_connection`; check router load |
| Stale MCP after server update | `git -C tools/openwrt-mcp-server pull && npm ci && npm run build` in pkg dir |

## Environment variables (mcp.json)

| Variable | Default (setup script) |
|----------|------------------------|
| `OPENWRT_TRANSPORT` | `ssh` |
| `OPENWRT_HOST` | `192.168.8.1` |
| `OPENWRT_USER` | `root` |
| `OPENWRT_KEY_PATH` | `~/.ssh/id_ed25519_openwrt_mcp` |
| `OPENWRT_TIMEOUT_MS` | `15000` |
