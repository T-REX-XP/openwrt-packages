# CM5 live validation recipes

Run on router at **`192.168.8.1`** after flash or package change. Prefer MCP where noted; SSH where no tool exists.

## Post-flash smoke test (MCP)

1. `openwrt_test_connection`
2. `openwrt_get_system_info` — expect ImmortalWrt 25.x, aarch64
3. `openwrt_list_interfaces` — `br-lan` on `eth1`/`eth2`, WAN on `eth0`
4. `openwrt_uci_get` `network.lan.ipaddr` → `192.168.8.1`
5. `openwrt_ping` `1.1.1.1` — WAN up
6. `openwrt_list_packages` pattern `mcudd` — package present if in image

## mcudd + ESP32 display stack

**Preconditions:** ESP32 flashed with matching RDCP release; JST UART connected; USB serial unplugged. **Swipe → LuCI active page is frozen** — do not change `handle_gesture` or sidecar reads (skill `mcu-display-cm5`).

```sh
# SSH
ssh root@192.168.8.1 '/etc/init.d/mcudd status'
ssh root@192.168.8.1 'pgrep -a mcudd'
ssh root@192.168.8.1 '/usr/lib/mcud/mcud-link-test.sh'
```

Success: JSON with `"ping_ok":true,"echo_ok":true` and script prints `link test OK`.

On failure:

```sh
ssh root@192.168.8.1 'logread -e mcudd | tail -30'
ssh root@192.168.8.1 'uci show mcud'
```

MCP checks (no link-test tool):

- `openwrt_uci_get` paths under `mcud.`
- `openwrt_get_logs` filtered to mcudd if supported

LuCI: **Services → MCU Display** — page sync, splash, button mapping.

Physical buttons: **cm5-button-scripts** → `hotplug-call button`; cross-check with LuCI menu actions.

## Blocky / DNS (MCP + SSH)

MCP:

1. `openwrt_uci_get` `blocky.main.enabled`
2. `openwrt_ping` external host
3. `openwrt_dns_lookup` `example.com`

SSH:

```sh
ssh root@192.168.8.1 'pgrep blocky && netstat -ln | grep -E ":5353|:4000"'
ssh root@192.168.8.1 'uci get dhcp.@dnsmasq[0].server'
```

Client symptom “IP works, names don’t” → see **`blocky-dns-cm5`** skill.

## Peripherals (SSH-heavy)

```sh
ssh root@192.168.8.1 'i2cdetect -y 7'
ssh root@192.168.8.1 'cat /sys/class/hwmon/hwmon*/fan*_input 2>/dev/null | head'
ssh root@192.168.8.1 'ls /sys/class/pwm/'
```

LuCI: **System → Peripherals** (read-only diagnostics + fan/IR UCI).

## Package install from custom feed (MCP)

When image lacks a feed-only package:

1. `openwrt_update_package_index` (may warn on broken feeds — OK if target feed works)
2. Or SSH: add GitHub Pages line to `/etc/apk/repositories`
3. `openwrt_install_package` with `simulate=true`, then install

Feed URL: `https://t-rex-xp.github.io/openwrt-packages/immortalwrt-25.12/aarch64_generic/`

## Safe UCI experiment template

Example: toggle mcudd without permanent lockout:

```text
openwrt_uci_get     mcud.@main[0].enabled
openwrt_uci_set     mcud.@main[0].enabled 0
openwrt_uci_commit  mcud  (safety=true)
# verify router still reachable
openwrt_uci_confirm sessionId
# or let rollback revert if mcudd stop broke something unexpected
```
