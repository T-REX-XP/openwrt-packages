---
name: openwrt-mcp-ssh
description: >-
  Operate ImmortalWrt/OpenWrt 25.x on Orange Pi CM5 (or any SSH router) via the
  host openwrt-mcp-server (Cursor namespace user-openwrt) or direct SSH fallbacks.
  Use when debugging live router state, UCI/apk changes, mcudd/blocky/DNS, link
  tests, logs, network diagnostics, or post-flash validation — not for firmware builds.
---

# OpenWrt MCP + SSH (host → router)

Host-side [openwrt-mcp-server](https://github.com/T-REX-XP/openwrt-mcp-server) runs in Cursor as namespace **`user-openwrt`**. It executes commands on the router over SSH. It is **not** installed on the router.

## When to use what

| Task | Prefer |
|------|--------|
| Read/set UCI, apk install, firewall, ping, logs, reboot | **MCP** (`user-openwrt`) |
| Deploy `mcudd-bin`, read `/tmp/mcud_*.json`, run link test script | **SSH** (no MCP tool yet) |
| Flash ESP32 firmware, serial monitor | **Host USB** (not router SSH) |
| Build packages / firmware | **Docker build** (`build_immortalwrt`) — see other skills |

## Setup (once per machine)

From `openwrt-packages` repo root:

```sh
./scripts/setup-openwrt-mcp.sh
# Optional overrides:
OPENWRT_HOST=192.168.8.1 OPENWRT_KEY_PATH=~/.ssh/id_ed25519 ./scripts/setup-openwrt-mcp.sh
```

Restart Cursor or reload MCP after setup. Docs: [docs/openwrt-mcp-server.md](../../../docs/openwrt-mcp-server.md).

### CM5 defaults

| Setting | Value |
|---------|--------|
| LAN IP | `192.168.8.1` |
| SSH user | `root` |
| SSH key | `~/.ssh/id_ed25519_openwrt_mcp` (setup script) or `~/.ssh/id_ed25519` |
| Package manager | **`apk`** (ImmortalWrt 25.x) — not `opkg` |

Verify from Mac: `ssh -i ~/.ssh/id_ed25519_openwrt_mcp root@192.168.8.1 uname -a`

## MCP invocation pattern (Cursor agent)

1. **`GetDynamicTools`** — `{"namespace":"user-openwrt"}` or search `{"pattern":"openwrt"}`.
2. **`openwrt_test_connection`** — always first when live router work is requested.
3. **`CallDynamicTool`** — namespace `user-openwrt`, tool name + args from schema.
4. If namespace status is **`needsAuth`**, call `mcp_auth` for that namespace, then retry.

Never guess tool parameters; always read the schema first.

## UCI workflow (safety-first)

ImmortalWrt changes can lock you out of the network. Use MCP’s staged commit + rollback:

```text
openwrt_uci_get        → read current value
openwrt_uci_set        → stage change (not live until commit)
openwrt_uci_changes    → review pending
openwrt_uci_commit     → apply (safety=true by default, ~60s rollback timer)
  → verify connectivity / service still works
openwrt_uci_confirm    → pass sessionId from commit to keep change
  OR wait for auto-revert if broken
openwrt_uci_revert     → discard uncommitted staging
```

**Rules:**

- Commit **one package at a time** (`network`, `firewall`, `dhcp`, …).
- For risky edits (`network`, `wireless`, `firewall`): commit with safety, verify, then confirm.
- Do **not** chain multiple package commits without verification between them.
- Ask the user before **`openwrt_reboot`** unless they explicitly requested it.

## APK workflow

```text
openwrt_list_packages / openwrt_package_info   → inspect
openwrt_update_package_index                  → refresh indexes
openwrt_install_package (simulate=true first) → dry-run
openwrt_install_package                       → install
openwrt_remove_package (simulate=true)        → preview removal
```

Custom feed packages (`blocky`, `luci-app-mcu-display`, …) may not be on ImmortalWrt snapshots CDN. Install from [GitHub Pages feed](https://t-rex-xp.github.io/openwrt-packages/immortalwrt-25.12/aarch64_generic/) or ship in firmware — do not assume `apk update` alone fixes missing packages.

If `apk update` fails on `openwrt_packages` or `awgopenwrt` feeds (empty/broken index on CDN), disable or repoint those feeds in `/etc/apk/repositories` rather than blocking on upstream.

## Network & DNS diagnostics

| Goal | MCP tool |
|------|----------|
| Interface addresses, up/down | `openwrt_list_interfaces` |
| Wi-Fi clients | `openwrt_get_wifi_stations` |
| Reachability | `openwrt_ping`, `openwrt_traceroute` |
| DNS from router | `openwrt_dns_lookup` |
| Firewall overview | `openwrt_get_firewall_status` |
| Port forward | `openwrt_add_port_forward` |
| Recent logs | `openwrt_get_logs` (filter by subsystem when supported) |

Blocky on CM5: clients → dnsmasq `:53` → Blocky `127.0.0.1:5353`; API `127.0.0.1:4000`. See **`blocky-dns-cm5`** skill in `build_immortalwrt`.

## SSH fallbacks (MCP gaps)

Use host **`ssh root@192.168.8.1 '…'`** (with key) when MCP has no tool or output is a local file on router:

### mcudd / ESP32 UART (CM5)

| Path / command | Purpose |
|----------------|---------|
| `/usr/sbin/mcudd` | Display daemon (RDCP over `/dev/ttyS2` or UCI `mcud.@main[0].device`) |
| `/etc/init.d/mcudd` | `{start\|stop\|restart\|status}` |
| `/usr/lib/mcud/mcud-link-test.sh` | Ping+echo RDCP test → `/tmp/mcud_link_test.json` |
| `/tmp/mcud_link_test.json` | `ping_ok` + `echo_ok` must be true |
| `logread -e mcudd` | UART / protocol errors |

**Deploy rebuilt binary** (after `make package/luci-app-mcu-display/compile` in Docker):

```sh
MCUDD=/path/to/feeds/packages/mcudd-old/src/mcudd-bin
ssh root@192.168.8.1 "cat > /usr/sbin/mcudd" < "$MCUDD"
ssh root@192.168.8.1 "chmod 755 /usr/sbin/mcudd && /etc/init.d/mcudd restart"
```

**Link test:**

```sh
ssh root@192.168.8.1 /usr/lib/mcud/mcud-link-test.sh
```

**Hardware note:** CM5 debug UART (`ttyS2`) conflicts with USB serial flashing on ESP32 — unplug USB after flash; use JST UART for mcudd.

### Other common SSH one-liners

```sh
ssh root@192.168.8.1 ubus call system board
ssh root@192.168.8.1 ps w | grep -E 'blocky|mcudd|dnsmasq'
ssh root@192.168.8.1 wget -qO- http://127.0.0.1:4000/api/blocking/status
ssh root@192.168.8.1 i2cdetect -y 7    # FPC I2C on CM5
```

## Agent behavior

- **Prefer MCP** over ad-hoc SSH when a tool exists — structured output, shared safety semantics.
- **Read before write** — `uci_get` / `list_interfaces` before changing config.
- **Minimize live changes** — fix in repo + rebuild when the issue is default config or missing files.
- **No destructive git** on router; no `rm -rf` on `/overlay` unless user explicitly asks.
- **Report clearly** — show UCI paths, package names, and whether changes were confirmed or rolled back.

## Related skills

| Skill | Repo | Use with MCP for… |
|-------|------|-------------------|
| `oled-peripherals-cm5` | openwrt-packages | mcudd, peripherals, link test |
| `blocky-dns-cm5` | build_immortalwrt | DNS/adblock validation |
| `cm5-base-files` | immortalwrt | Expected LAN/UCI defaults |
| `cm5-device-image` | build_immortalwrt | Post-flash package checklist |

## Reference

Full MCP tool catalog and task→tool mapping: [reference.md](reference.md)

CM5 validation checklists: [cm5-recipes.md](cm5-recipes.md)
