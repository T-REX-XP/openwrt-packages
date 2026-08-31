---
name: mcu-display-cm5
description: >-
  CM5 MCU display host stack: Go mcudd, luci-app-mcu-display, RDCP UART on
  ttyS2, LuCI active-page sidecar. Use when deploying mcudd, debugging swipe vs
  LuCI page, link test, or editing luci-app-mcu-display / mcudd (not OLED).
---

# MCU display on CM5 (host)

Panel firmware lives in **esp32-smartdisplay-demo**. This skill is the **router** side.

Live daemon: **Go** `feeds/packages/mcudd` installed as `/usr/sbin/mcudd`.

**Page sync:** `evt screen` → `/tmp/mcud_active_screen` → LuCI. Do not restore `evt input`. Do not echo `cmd screen` on swipe. Do not change LuCI sidecar reads.

## Ownership

| Concern | Package | LuCI |
|---------|---------|------|
| Display, pages, splash, UART daemon | **luci-app-mcu-display** + **mcudd** | **Services → MCU Display** |
| Fan / IR / I2C scan | **luci-app-peripherals** | **System → Peripherals** |
| Physical buttons | **cm5-button-scripts** | SSH `/etc/rc.button/` |

## UART

| Item | Value |
|------|--------|
| Device | `/dev/ttyS2` @ 115200 8N1 |
| ESP32 | UART2 GPIO3 RX / GPIO1 TX (P1 JST) |
| Sidecar | `/tmp/mcud_active_screen` |
| FIFO | `/var/run/mcudd.fifo` (dummy write fd required — no `POLLHUP` spin) |

CM5 bootscript must **not** put a runtime console on `ttyS2`.

Direct COM (stop `mcudd` first): **picocom** / **screen** / **socat** — skill **`cm5-mcu-serial`**, [docs/mcu-uart-serial.md](../../../docs/mcu-uart-serial.md). While `mcudd` is running, do not open `ttyS2`; use `mcud-link-test.sh` / `mcud-event.sh`.

## Deploy Go mcudd (macOS → aarch64)

CM5 image includes `openssh-sftp-server` (Dropbear subsystem at `/usr/libexec/sftp-server`). Use host `scp`/`sftp`:

```sh
cd /Users/t-rex-xp/Documents/openwrt-packages/feeds/packages/mcudd
GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -trimpath -ldflags '-s -w' -o mcudd-linux-arm64 ./cmd/mcudd

ssh -i ~/.ssh/id_ed25519_openwrt_mcp root@192.168.8.1 '/etc/init.d/mcudd stop'
scp -i ~/.ssh/id_ed25519_openwrt_mcp mcudd-linux-arm64 root@192.168.8.1:/tmp/mcudd.new
ssh -i ~/.ssh/id_ed25519_openwrt_mcp root@192.168.8.1 'chmod 755 /tmp/mcudd.new && mv /tmp/mcudd.new /usr/sbin/mcudd && /etc/init.d/mcudd start'
```

CLI: `mcudd -V` and `mcudd -version-json` (LuCI). FIFO tool: `/usr/lib/mcud/mcud-event.sh` (`help`, `prev`, `next`, `screen`, `ping`, `echo`). Tests: `feeds/packages/mcudd/scripts/run-tests.sh`.

Command table, expected syslog, and prev/next debug recipe: **[docs/mcudd-commands.md](../../../docs/mcudd-commands.md)**.

## Debug

```sh
/usr/lib/mcud/mcud-event.sh help
logread -e mcudd -e mcud-event | tail -40   # want: fifo:, nav, cmd screen, screen evt
cat /tmp/mcud_active_screen
grep '^2:' /proc/tty/driver/serial          # rx must climb
/usr/lib/mcud/mcud-link-test.sh
/usr/lib/mcud/mcud-event.sh next            # then check sidecar + logs
```

Stuck `router_boot` + no `uart rx:` → leftover `screen`/`picocom` on `ttyS2` (steals `evt screen`, LuCI goes stale), USB still on GPIO1/3, or tap panel RST after unplug. `ps w | grep ttyS2` — kill extras, keep only `mcudd`.

**ESP32 USB flash:** stop mcudd first; skill `esp32-cm5-router-fw` in the firmware repo.

## Do not

- Echo `cmd screen` from swipe handling (yanks the panel; LuCI desyncs)
- Restore `evt input` (v1 has no gesture opcode)
- Change LuCI `read_active_screen` / `get_status` page fields for this feature
